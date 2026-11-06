// Mode solo : tout est stocké sur le téléphone, la personne en face est simulée.
import { BOTS } from './bots.js';
import { bestMatch, compatible, score } from '../matching.js';
import { clock, moments, nextDateSlot } from '../timeline.js';
import { gamesFor } from '../date-logic.js';
import { pickObjectives } from '../date-logic.js';

const KEY = 'cai.local.v1';
const MIN = 60e3;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage plein ou bloqué */ }
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

export function createLocalStore() {
  let s = load();

  // En solo, les profils fictifs « habitent » dans ta ville pour que le test fonctionne partout.
  function pool(me) {
    return BOTS.map((b) => ({ ...b, city: me.city || b.city, lat: me.lat ?? b.lat, lng: me.lng ?? b.lng, maxKm: 100 }));
  }

  function botFor(id) {
    const me = s.profile || {};
    return pool(me).find((b) => b.id === id);
  }

  // Réponses de la personne simulée, révélées au fil de l'horloge.
  function simulate(date) {
    const bot = botFor(date.b);
    if (!bot) return date;
    const now = clock.now();
    const isParis = /paris/i.test(s.profile?.city || '');
    const sc = score(s.profile || {}, bot);
    // La personne simulée arrive 3 minutes avant l'heure.
    const arrivedAt = date.dateAt - 3 * MIN;
    const withArrival = { ...date, answers: { ...date.answers, [date.b]: arrivedAt <= now ? { arrived: arrivedAt } : {} } };
    const t = Object.fromEntries(moments(withArrival, date.a).map((m) => [m.key, m.at]));
    const games = gamesFor(date, s.profile, bot);
    const about = {
      likes: bot.interests?.[0] ? `${bot.interests[0]}, sans hésiter` : 'Les longues marches',
      said: bot.portrait?.people || 'Qu’on ne s’ennuie jamais avec moi',
      hates: bot.portrait?.unforgivable || 'Les gens pressés',
      free: bot.script.phrase,
    };
    const result = (g, i) => (g.type === 'count' ? { n: Math.min(g.max || 3, (sc + i) % ((g.max || 3) + 1)) } : { ok: (sc + i) % 2 === 0 });
    const plan = [
      ['accept', date.createdAt + 4000, true],
      ['confirm', date.createdAt + 8000, true],
      ['place', t.tonTour + 2 * MIN, isParis ? bot.script.place : { leave: true }],
      ['about', t.tonTour + 2 * MIN, about],
      ['bet', t.lieu + 5 * MIN, bot.script.bet],
      ['lookout', t.lieu + 6 * MIN, bot.distinctive || 'Une veste en jean, près de l’entrée.'],
      ['rules', t.regles + MIN, true],
      ['objectiveSeen', t.objectif + MIN, true],
      ['arrived', arrivedAt, arrivedAt],
      ...games.map((g, i) => [`g${g.slot}`, t[`jeu${g.slot}`] + 12 * MIN, result(g, i)]),
      ['done', t.jeu1 + bot.script.doneMin * MIN, t.jeu1 + bot.script.doneMin * MIN],
      ['betVerdict', t.pari + 2 * MIN, sc % 2 === 0],
      ['guessed', t.reveal + 2 * MIN, false],
      ['again', t.apres + MIN, bot.script.again && sc >= 45],
      ['note', t.apres + MIN, bot.script.again && sc >= 45 ? undefined : 'Merci pour la soirée, vraiment. Je n’ai juste pas senti l’étincelle, mais j’ai adoré tes réponses aux jeux.'],
    ];
    const ans = {};
    for (const [k, when, v] of plan) if (when != null && when <= now && v !== undefined) ans[k] = v;
    return { ...date, answers: { ...date.answers, [date.b]: ans } };
  }

  return {
    mode: 'solo',
    async init() {
      if (!s.userId) { s.userId = 'me-' + uid(); s.dates = []; save(s); }
      return { userId: s.userId };
    },
    async getProfile() { return s.profile ? { ...s.profile, verified: !!s.verif?.ok, gender: s.verif?.sex || s.profile.gender || null } : null; },
    // Vérification d'identité simulée (mode solo) : validée tout de suite.
    async getVerification() { return s.verif?.ok ? { status: 'approved' } : { status: 'none' }; },
    async submitVerification(doc, selfie, sex) { s.verif = { ok: true, sex: sex || 'homme' }; save(s); return { status: 'approved' }; },
    async adminVerifications() { return []; },
    async presence() {},
    subscribe() {},
    async isAdmin() { return true; }, // en solo, tout est permis (tests)
    async adminListUsers() {
      return BOTS.map((b) => ({ id: b.id, name: b.firstName, email: 'profil fictif', city: s.profile?.city || b.city, busy: false }));
    },
    async adminMatchWith(id) {
      for (const d of s.dates || []) if (d.status === 'active') d.status = 'closed';
      const bot = pool(s.profile || {}).find((b) => b.id === id);
      const createdAt = clock.now();
      const dateId = 'd-' + uid();
      s.dates = [...(s.dates || []), {
        id: dateId, a: s.userId, b: id, createdAt, status: 'active', score: score(s.profile || {}, bot),
        dateAt: nextDateSlot(createdAt, s.profile?.availability, bot.availability),
        objectives: pickObjectives(dateId, s.userId, id), answers: { [s.userId]: {} },
      }];
      save(s);
    },
    async saveProfile(p) { s.profile = { ...p, id: s.userId }; save(s); return s.profile; },

    async findMatch() {
      if (!s.verif?.ok) return { search: { verify: 'none' } };
      const me = { ...s.profile, gender: s.verif.sex };
      const exclude = (s.dates || []).map((d) => d.b);
      const candidates = pool(me);
      let best = bestMatch(me, candidates, exclude);
      // En solo on veut toujours pouvoir jouer : on relâche l'âge si besoin.
      // Puis, si aucun profil fictif ne cherche ton genre, on en adapte un (seul ton choix compte).
      const open = (list) => list.map((c) => ({ ...c, ageMin: 18, ageMax: 99, seeking: [...new Set([...(c.seeking || []), me.gender])] }));
      const relaxedMe = { ...me, ageMin: 18, ageMax: 99 };
      if (!best) best = bestMatch(relaxedMe, candidates.map((c) => ({ ...c, ageMin: 18, ageMax: 99 })), exclude);
      if (!best) best = bestMatch(relaxedMe, open(candidates), exclude);
      // Tous déjà rencontrés : on recommence la liste.
      if (!best) best = bestMatch(relaxedMe, open(candidates), []);
      if (!best) return { search: {} };
      const createdAt = clock.now();
      const id = 'd-' + uid();
      const date = {
        id, a: s.userId, b: best.profile.id, createdAt, status: 'active', score: best.score,
        dateAt: nextDateSlot(createdAt, me.availability, best.profile.availability),
        objectives: pickObjectives(id, s.userId, best.profile.id),
        answers: { [s.userId]: {} },
      };
      s.dates = [...(s.dates || []), date];
      save(s);
      return { date };
    },

    async getDate() {
      const d = (s.dates || []).find((x) => x.status === 'active');
      if (!d) return null;
      const date = simulate(d);
      const p = botFor(d.b);
      const partner = p && { ...p, script: undefined };
      return { date, partner };
    },

    async answer(key, value) {
      const d = (s.dates || []).find((x) => x.status === 'active');
      if (!d) return;
      d.answers[s.userId] = { ...(d.answers[s.userId] || {}), [key]: value };
      save(s);
    },


    async closeDate() {
      const d = (s.dates || []).find((x) => x.status === 'active');
      if (d) { d.status = 'closed'; save(s); }
    },

    // Discussion (solo) : la personne simulée répond quelques secondes après.
    async getMessages() {
      const d = (s.dates || []).find((x) => x.status === 'active');
      if (!d) return [];
      const list = d.messages || [];
      const now = clock.now();
      const replies = ['Haha, j’ai hâte de voir ça.', 'Je garde mes questions pour le jour J 😌', 'Tu triches un peu là, non ?', 'D’accord. Mais je ne dis rien de plus.', 'On verra bien sur place.'];
      const out = [];
      list.forEach((m, i) => {
        out.push(m);
        if (m.from === s.userId && now - m.at > 3500) out.push({ id: `r${i}`, from: d.b, body: replies[i % replies.length], at: m.at + 3500 });
      });
      return out;
    },
    async getPastChats() {
      return (s.dates || []).filter((d) => d.status !== 'active' && d.messages?.length).reverse().map((d) => ({
        dateId: d.id, dateAt: d.dateAt, name: botFor(d.b)?.firstName || 'Ancien date', messages: d.messages,
      }));
    },
    async sendMessage(body) {
      const d = (s.dates || []).find((x) => x.status === 'active');
      if (!d) return;
      d.messages = [...(d.messages || []), { id: `m${Date.now()}`, from: s.userId, body, at: clock.now() }];
      save(s);
    },

    async report(reason) {
      s.reports = [...(s.reports || []), { at: Date.now(), reason }];
      save(s);
    },

    async resetAll() {
      try { localStorage.removeItem(KEY); } catch { /* rien */ }
      s = {};
      clock.reset();
    },

    // Utilisé par les tests : compatibilité stricte.
    _compatible: compatible,
  };
}
