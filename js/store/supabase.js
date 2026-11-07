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
  let channel = null;
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
      objectives: row.objectives || {}, answers: byUser, status: 'active', demoOffset: row.demo_offset_ms ?? null,
      setupId: row.setup_id || null, fiches: row.fiches || {},
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
    async adminListUsers() {
      return check(await sb.rpc('admin_list_users')).map((u) => ({ id: u.id, name: u.first_name || '(sans prénom)', email: u.email, city: u.city, busy: u.busy }));
    },
    async adminMatchWith(id) {
      check(await sb.rpc('admin_match_with', { target: id }));
      return this.getDate();
    },
    async setDemoOffset(ms) {
      if (!currentDateId) await this.getDate();
      check(await sb.rpc('admin_set_demo_offset', { p_date: currentDateId, ms: ms == null ? null : Math.round(ms) }));
    },
    async adminDiagnostics() {
      return check(await sb.rpc('admin_diagnostics'));
    },
    async adminTestPush() {
      return check(await sb.rpc('admin_test_push'));
    },
    async adminSkipSearch() {
      check(await sb.rpc('admin_skip_search'));
    },
    async isAdmin() {
      try { return Boolean(check(await sb.rpc('is_admin'))); } catch { return false; }
    },

    // ---------- Notifications push ----------
    async pushKey() {
      return check(await sb.rpc('push_public_key'));
    },
    async savePush(sub) {
      const j = sub.toJSON();
      check(await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: userId, p256dh: j.keys.p256dh, auth: j.keys.auth }));
    },
    async removePush(endpoint) {
      await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
    },

    async signOut() {
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        if (sub) { await this.removePush(sub.endpoint); await sub.unsubscribe(); }
      } catch { /* rien */ }
      await sb.auth.signOut();
      userId = null;
      currentDateId = null;
    },

    // ---------- Profil ----------
    async getProfile() {
      const row = check(await sb.from('profiles').select('data, active, gender, verified').eq('id', userId).maybeSingle());
      if (!row) return null;
      const { phone, ...data } = row.data || {}; // anciens profils : on ignore le numéro
      return { ...data, gender: row.gender || data.gender || null, verified: !!row.verified, id: userId, paused: row.active === false };
    },

    async saveProfile(p) {
      const { phone, verified, paused, id, ...data } = p; // la vérification est gérée par le serveur
      check(await sb.from('profiles').upsert({
        id: userId, data, gender: p.gender || null, seeking: p.seeking, birthdate: p.birthdate,
        age_min: p.ageMin, age_max: p.ageMax, city: p.city, lat: p.lat ?? null, lng: p.lng ?? null,
        max_km: p.maxKm, availability: p.availability, active: p.paused !== true, updated_at: new Date().toISOString(),
      }));
      return { ...p, id: userId };
    },

    // ---------- Vérification du visage (rien n'est envoyé : seulement « réussi ») ----------
    async getVerification() {
      try { return check(await sb.rpc('my_verification')) || { status: 'none' }; } catch { return { status: 'none' }; }
    },
    async completeLiveness() { check(await sb.rpc('complete_liveness')); },

    // ---------- Amis ----------
    async friends() { return check(await sb.rpc('my_friends')) || []; },
    async addFriend(mail) { return check(await sb.rpc('friend_request', { p_email: mail })); },
    async respondFriend(id, ok) { check(await sb.rpc('friend_respond', { p_id: id, p_ok: ok })); },
    async removeFriend(id) { check(await sb.rpc('friend_remove', { p_id: id })); },
    async myFriendCode() { return check(await sb.rpc('my_friend_code')); },
    async friendCodeInfo(code) { try { return check(await sb.rpc('friend_code_info', { p_code: code })); } catch { return null; } },
    async addFriendByCode(code) { return check(await sb.rpc('friend_by_code', { p_code: code })); },

    // ---------- « Je matche pour mon ami » ----------
    async setups() { return check(await sb.rpc('my_setups')) || []; },
    async proposeSetup(friend) { return check(await sb.rpc('setup_propose', { p_friend: friend })); },
    async respondSetup(id, ok) { check(await sb.rpc('setup_respond', { p_id: id, p_ok: ok })); },
    async cancelSetup(id) { check(await sb.rpc('setup_cancel', { p_id: id })); },
    async inviteForSetup(id, mail) { return check(await sb.rpc('setup_invite', { p_id: id, p_email: mail })); },
    async saveFiche(id, fiche) { return check(await sb.rpc('setup_fiche', { p_id: id, p_fiche: fiche })); },
    async inviteInfo(token) { try { return check(await sb.rpc('invite_info', { p_token: token })); } catch { return null; } },
    async respondInvite(token, ok) { check(await sb.rpc('invite_respond', { p_token: token, p_ok: ok })); },
    async myInvites() { try { return check(await sb.rpc('my_invites')) || []; } catch { return []; } },

    // ---------- Supprimer une discussion (définitif) ----------
    async deleteChat(dateId) { check(await sb.rpc('delete_chat', { p_date: dateId })); },

    // ---------- Présence (pas de notification push quand l'appli est ouverte) ----------
    async presence(where) {
      try { await sb.rpc('set_presence', { p_where: where }); } catch { /* rien */ }
    },

    // ---------- Temps réel : messages, réponses et avance du temps, instantanément ----------
    subscribe(dateId, onEvent) {
      if (channel) { sb.removeChannel(channel); channel = null; }
      if (!dateId) return;
      channel = sb.channel(`date-${dateId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `date_id=eq.${dateId}` },
          (p) => onEvent({ table: 'messages', row: p.new }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `date_id=eq.${dateId}` },
          (p) => onEvent({ table: 'answers', row: p.new }))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dates', filter: `id=eq.${dateId}` },
          (p) => onEvent({ table: 'dates', row: p.new }))
        .subscribe();
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
        sb.from('profiles').select('data, gender').eq('id', other).maybeSingle().then(check),
      ]);
      return { date: toDate(row, answers), partner: prof ? { ...prof.data, gender: prof.gender || null, id: other } : null };
    },

    async answer(key, value) {
      if (!currentDateId) await this.getDate();
      if (!currentDateId) return;
      check(await sb.from('answers').upsert({
        date_id: currentDateId, user_id: userId, key, value, updated_at: new Date().toISOString(),
      }));
    },


    async closeDate() {
      if (!currentDateId) return;
      check(await sb.rpc('close_date', { p_date: currentDateId }));
      currentDateId = null;
    },

    // ---------- Discussion ----------
    async getMessages() {
      if (!currentDateId) return [];
      const rows = check(await sb.from('messages').select('id,user_id,body,created_at').eq('date_id', currentDateId).order('id', { ascending: true }).limit(500));
      return rows.map((r) => ({ id: r.id, from: r.user_id, body: r.body, at: Date.parse(r.created_at) }));
    },
    // Anciennes discussions : les dates passés ou refermés qui ont au moins un message.
    async getPastChats() {
      const dates = check(await sb.from('dates').select('id,a,b,date_at,chat_deleted_by').or(`a.eq.${userId},b.eq.${userId}`)
        .order('date_at', { ascending: false }).limit(50));
      const past = dates.filter((d) => d.id !== currentDateId && !(d.chat_deleted_by || []).includes(userId));
      if (!past.length) return [];
      const ids = past.map((d) => d.id);
      const others = [...new Set(past.map((d) => (d.a === userId ? d.b : d.a)))];
      const [msgs, profs] = await Promise.all([
        sb.from('messages').select('id,date_id,user_id,body,created_at').in('date_id', ids).order('id', { ascending: true }).limit(2000).then(check),
        sb.from('profiles').select('id,data').in('id', others).then(check),
      ]);
      const names = Object.fromEntries(profs.map((p) => [p.id, p.data?.firstName]));
      return past.map((d) => {
        const list = msgs.filter((m) => m.date_id === d.id).map((m) => ({ id: m.id, from: m.user_id, body: m.body, at: Date.parse(m.created_at) }));
        return { dateId: d.id, dateAt: Date.parse(d.date_at), name: names[d.a === userId ? d.b : d.a] || 'Ancien date', messages: list };
      }).filter((x) => x.messages.length);
    },
    async sendMessage(body) {
      if (!currentDateId) await this.getDate();
      check(await sb.from('messages').insert({ date_id: currentDateId, user_id: userId, body }));
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
