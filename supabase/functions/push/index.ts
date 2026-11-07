// Cœur All In — fonction Edge « push »
// Appelée chaque minute par la base (pg_cron + pg_net). Envoie les notifications dues
// (match trouvé, puis chaque carte du date à son heure) à tous les téléphones abonnés.
//
// Déploiement : Supabase → Edge Functions → Deploy a new function → Via Editor,
// nom « push », coller ce fichier, Deploy. Puis, dans les réglages de la fonction,
// désactiver « Enforce JWT Verification » (la fonction vérifie elle-même un secret).
//
// Aucune dépendance : Web Push (RFC 8291 / 8292) est implémenté avec WebCrypto.

const enc = new TextEncoder();

// ---------- base64url ----------
export function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- Clés VAPID ----------
export async function generateVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: b64u(pub), privateJwk: jwk };
}

async function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// ---------- Chiffrement du message (aes128gcm, RFC 8291) ----------
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

export async function encryptPayload(sub, plaintext, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = concat(typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function sendPush(sub, message, vapid, subject = 'https://coeur-all-in.github.io') {
  const body = await encryptPayload(sub, JSON.stringify(message));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
    },
    body,
  });
  return res.status;
}

// ---------- Accès base (API REST avec la clé serveur) ----------
function db() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  return {
    config: async () => (await call('push_config?id=eq.1&select=*'))[0],
    saveVapid: (v) => call('push_config?id=eq.1', { method: 'PATCH', body: JSON.stringify({ vapid_public: v.publicKey, vapid_private_jwk: v.privateJwk }) }),
    due: () => call('rpc/due_pushes', { method: 'POST', body: '{}' }),
    mails: () => call('rpc/due_mails', { method: 'POST', body: '{}' }),
    subs: (ids) => call(`push_subscriptions?select=*&user_id=in.(${ids.join(',')})`),
    dropSub: (endpoint) => call(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: 'DELETE' }),
  };
}

async function handle(req) {
  const store = db();
  const cfg = await store.config();
  if (!cfg || req.headers.get('x-cron-secret') !== cfg.cron_secret) return new Response('Interdit', { status: 401 });

  let vapid = cfg.vapid_public && cfg.vapid_private_jwk ? { publicKey: cfg.vapid_public, privateJwk: cfg.vapid_private_jwk } : null;
  if (!vapid) {
    vapid = await generateVapid();
    await store.saveVapid(vapid);
  }

  const mailed = await sendMails(store);
  const due = (await store.due()) || [];
  if (!due.length) return Response.json({ sent: 0, mailed });
  const subs = await store.subs([...new Set(due.map((d) => d.user_id))]);
  let sent = 0;
  await Promise.all(due.flatMap((d) => subs.filter((s) => s.user_id === d.user_id).map(async (s) => {
    try {
      const status = await sendPush(s, { title: 'Cœur All In', body: d.body, tag: d.key }, vapid);
      if (status === 404 || status === 410) await store.dropSub(s.endpoint); // abonnement expiré
      else if (status < 300) sent++;
    } catch (e) {
      console.error('push', e);
    }
  })));
  return Response.json({ due: due.length, sent, mailed });
}

// ---------- E-mails (invitations « Je matche pour mon ami ») ----------
// Optionnel : avec un compte Brevo gratuit (300 e-mails/jour), ajoute dans Edge Functions → Secrets :
//   BREVO_API_KEY = ta clé API Brevo     MAIL_FROM = l'adresse d'envoi validée dans Brevo
// Sans ces secrets, aucun e-mail n'est envoyé : l'appli propose de partager le lien d'invitation.
async function sendMails(store) {
  const key = Deno.env.get('BREVO_API_KEY');
  const from = Deno.env.get('MAIL_FROM');
  if (!key || !from) return 0;
  const list = (await store.mails()) || [];
  let n = 0;
  for (const m of list) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: from, name: 'Cœur All In' }, to: [{ email: m.to_email }], subject: m.subject, htmlContent: m.html }),
      });
      if (r.ok) n++; else console.error('mail', r.status, await r.text());
    } catch (e) { console.error('mail', e); }
  }
  return n;
}

if (globalThis.Deno?.serve) {
  Deno.serve((req) => handle(req).catch((e) => {
    console.error(e);
    return new Response(String(e), { status: 500 });
  }));
}
