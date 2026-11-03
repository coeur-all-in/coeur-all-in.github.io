// Mode en ligne : Supabase (Postgres + comptes e-mail / mot de passe). Voir supabase/schema.sql.
import { CONFIG } from '../config.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm';

// Messages d'erreur Supabase → français.
export function frError(e) {
  const m = String(e?.message || e || '');
  if (/invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already been registered|user already exists/i.test(m)) return 'Un compte existe déjà avec cet e-mail. Connecte-toi.';
  if (/password should be|password.*(short|least)/i.test(m)) return 'Mot de passe trop court (8 caractères minimum).';
  if (/email not confirmed/i.test(m)) return 'Ton e-mail n’est pas encore confirmé : clique sur le lien reçu.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Trop de tentatives. Réessaie dans quelques minutes.';
  if (/invalid.*email|email.*invalid|unable to validate email/i.test(m)) return 'Adresse e-mail invalide.';
  if (/same.*password|different from the old/i.test(m)) return 'Choisis un mot de passe différent de l’ancien.';
  if (/failed to fetch|network/i.test(m)) return 'Pas de connexion. Vérifie ton réseau.';
  if (/signups not allowed|signup.*disabled/i.test(m)) return 'Les inscriptions sont fermées pour le moment.';
  return m || 'Une erreur est survenue.';
}

export async function createSupabaseStore() {
  const { createClient } = await import(SDK);
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cai.auth' },
  });
  let userId = null;
  let email = null;
  let currentDateId = null;
  let recovery = /type=recovery/.test(location.hash);
  const listeners = new Set();

  sb.auth.onAuthStateChange((event, session) => {
    userId = session?.user?.id || null;
    email = session?.user?.email || null;
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    listeners.forEach((fn) => fn(event, session));
  });

  const check = ({ data, error }) => {
    if (error) throw new Error(frError(error));
    return data;
  };

  function toDate(row, answers) {
    const byUser = { [row.a]: {}, [row.b]: {} };
    for (const r of answers) byUser[r.user_id][r.key] = r.value;
    return {
      id: row.id, a: row.a, b: row.b, score: row.score,
      createdAt: Date.parse(row.created_at), dateAt: Date.parse(row.date_at),
      objectives: row.objectives || {}, answers: byUser, status: 'active',
    };
  }

  return {
    mode: 'remote',
    needsAuth: true,
    get email() { return email; },
    get recovery() { return recovery; },
    onAuth(fn) { listeners.add(fn); },

    async init() {
      const { data: { session } } = await sb.auth.getSession();
      userId = session?.user?.id || null;
      email = session?.user?.email || null;
      // Ancienne session anonyme (avant les comptes) : on repart proprement.
      if (session?.user?.is_anonymous) { await sb.auth.signOut(); userId = null; }
      return { userId };
    },

    // ---------- Compte ----------
    async signUp(mail, password) {
      const data = check(await sb.auth.signUp({
        email: mail, password, options: { emailRedirectTo: location.origin + location.pathname },
      }));
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('Un compte existe déjà avec cet e-mail. Connecte-toi.');
      }
      userId = data.session?.user?.id || null;
      return { confirmEmail: !data.session };
    },
    async signIn(mail, password) {
      const data = check(await sb.auth.signInWithPassword({ email: mail, password }));
      userId = data.user.id;
      email = data.user.email;
      return { userId };
    },
    async resetPassword(mail) {
      check(await sb.auth.resetPasswordForEmail(mail, { redirectTo: location.origin + location.pathname }));
    },
    async updatePassword(password) {
      check(await sb.auth.updateUser({ password }));
      recovery = false;
      history.replaceState(null, '', location.pathname);
    },
    async signOut() {
      await sb.auth.signOut();
      userId = null;
      currentDateId = null;
    },

    // ---------- Profil ----------
    async getProfile() {
      const row = check(await sb.from('profiles').select('data, active').eq('id', userId).maybeSingle());
      if (!row) return null;
      const c = check(await sb.from('contacts').select('phone').eq('id', userId).maybeSingle());
      return { ...row.data, id: userId, phone: c?.phone || '', paused: row.active === false };
    },

    async saveProfile(p) {
      const { phone, ...data } = p;
      check(await sb.from('profiles').upsert({
        id: userId, data, gender: p.gender, seeking: p.seeking, birthdate: p.birthdate,
        age_min: p.ageMin, age_max: p.ageMax, city: p.city, lat: p.lat ?? null, lng: p.lng ?? null,
        max_km: p.maxKm, availability: p.availability, active: p.paused !== true, updated_at: new Date().toISOString(),
      }));
      check(await sb.from('contacts').upsert({ id: userId, phone: phone || null }));
      return { ...p, id: userId };
    },

    // ---------- Matching ----------
    // Renvoie { date } si un date existe / vient d'être créé, sinon { search } (état de la recherche).
    async findMatch() {
      const res = check(await sb.rpc('find_match'));
      if (res?.date_id) return { date: (await this.getDate())?.date };
      return { search: res || {} };
    },

    async getDate() {
      const since = new Date(Date.now() - 2 * 864e5).toISOString();
      const rows = check(await sb.from('dates').select('*')
        .or(`a.eq.${userId},b.eq.${userId}`).gt('date_at', since)
        .order('created_at', { ascending: false }).limit(5));
      const row = rows.find((r) => !(r.closed_by || []).includes(userId));
      if (!row) { currentDateId = null; return null; }
      currentDateId = row.id;
      const other = row.a === userId ? row.b : row.a;
      const [answers, prof] = await Promise.all([
        sb.from('answers').select('user_id,key,value').eq('date_id', row.id).then(check),
        sb.from('profiles').select('data').eq('id', other).maybeSingle().then(check),
      ]);
      return { date: toDate(row, answers), partner: prof ? { ...prof.data, id: other } : null };
    },

    async answer(key, value) {
      if (!currentDateId) await this.getDate();
      if (!currentDateId) return;
      check(await sb.from('answers').upsert({
        date_id: currentDateId, user_id: userId, key, value, updated_at: new Date().toISOString(),
      }));
    },

    async partnerPhone() {
      if (!currentDateId) return null;
      return check(await sb.rpc('partner_phone', { p_date: currentDateId }));
    },

    async closeDate() {
      if (!currentDateId) return;
      check(await sb.rpc('close_date', { p_date: currentDateId }));
      currentDateId = null;
    },

    async report(reason) {
      check(await sb.from('reports').insert({ date_id: currentDateId, reason }));
    },

    async resetAll() {
      check(await sb.rpc('delete_account'));
      await sb.auth.signOut();
      try { localStorage.clear(); } catch { /* rien */ }
    },
  };
}
