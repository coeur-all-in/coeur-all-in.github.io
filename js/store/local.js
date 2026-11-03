// Mode solo : tout est stocké sur le téléphone, la personne en face est simulée.
import { BOTS } from './bots.js';
import { bestMatch, compatible, score } from '../matching.js';
import { clock, moments, nextDateSlot } from '../timeline.js';
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
    const t = Object.fromEntries(moments(date, date.a).map((m) => [m.key, m.at]));
    const isParis = /paris/i.test(s.profile?.city || '');
    const sc = score(s.profile || {}, bot);
    const plan = [
      ['accept', date.createdAt + 4000, true],
      ['confirm', date.createdAt + 8000, true],
      ['place', t.tonTour + 2 * MIN, isParis ? bot.script.place : { leave: true }],
      ['phrase', t.tonTour + 2 * MIN, bot.script.phrase],
      ['bet', t.lieu + 5 * MIN, bot.script.bet],
      ['rules', t.regles + MIN, true],
      ['done', date.dateAt + bot.script.doneMin * MIN, date.dateAt + bot.script.doneMin * MIN],
      ['betVerdict', t.pari + 2 * MIN, sc % 2 === 0],
      ['again', t.apres + MIN, bot.script.again && sc >= 45],
    ];
    const ans = {};
    for (const [k, when, v] of plan) if (when <= now) ans[k] = v;
    return { ...date, answers: { ...date.answers, [date.b]: ans } };
  }

  return {
    mode: 'solo',
    async init() {
      if (!s.userId) { s.userId = 'me-' + uid(); s.dates = []; save(s); }
      return { userId: s.userId };
    },
    async getProfile() { return s.profile || null; },
    async saveProfile(p) { s.profile = { ...p, id: s.userId }; save(s); return s.profile; },

    async findMatch() {
      const me = s.profile;
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
      if (!best) return null;
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
      return date;
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

    async partnerPhone() {
      const d = (s.dates || []).find((x) => x.status === 'active');
      return d ? botFor(d.b)?.phone : null;
    },

    async closeDate() {
      const d = (s.dates || []).find((x) => x.status === 'active');
      if (d) { d.status = 'closed'; save(s); }
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
