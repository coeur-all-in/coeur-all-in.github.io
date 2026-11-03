// Mode multi-utilisateurs : Supabase (Postgres + auth anonyme). Voir supabase/schema.sql.
import { CONFIG } from '../config.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm';

export async function createSupabaseStore() {
  const { createClient } = await import(SDK);
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cai.auth' },
  });
  let userId = null;
  let currentDateId = null;

  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
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
    async init() {
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const res = await sb.auth.signInAnonymously();
        if (res.error) throw new Error('Connexion impossible : ' + res.error.message);
        session = res.data.session;
      }
      userId = session.user.id;
      return { userId };
    },

    async getProfile() {
      const row = check(await sb.from('profiles').select('data').eq('id', userId).maybeSingle());
      if (!row) return null;
      const c = check(await sb.from('contacts').select('phone').eq('id', userId).maybeSingle());
      return { ...row.data, id: userId, phone: c?.phone || '' };
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

    async findMatch() {
      const id = check(await sb.rpc('find_match'));
      return id ? (await this.getDate())?.date : null;
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
      try { await sb.from('profiles').delete().eq('id', userId); } catch { /* on continue */ }
      await sb.auth.signOut();
      try { localStorage.clear(); } catch { /* rien */ }
    },
  };
}
