// Le déroulé d'un date : quelles cartes arrivent, à quel moment.
// Tout est calculé à partir de deux dates : la création du match et l'heure du rendez-vous (J à 20h).
import { CONFIG } from './config.js';

const H = 3600e3;
const DAY = 24 * H;

// ---------- Horloge (avec voyage dans le temps pour les tests) ----------
const OFFSET_KEY = 'cai.clockOffset';
export const clock = {
  offset: Number(safeGet(OFFSET_KEY) || 0),
  now() { return Date.now() + this.offset; },
  jumpTo(ts) { this.offset = Math.max(0, ts - Date.now()); safeSet(OFFSET_KEY, String(this.offset)); },
  reset() { this.offset = 0; safeSet(OFFSET_KEY, '0'); },
  // Mode démo partagé (en ligne) : l'avance du temps vient du date, identique pour les deux personnes.
  setShared(ms) { this.offset = Math.max(0, Number(ms) || 0); },
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }

// Un instant précis : `days` jours avant/après le jour J, à hh:mm (heure locale).
export function at(dateAt, days, hh, mm = 0) {
  const d = new Date(dateAt);
  d.setDate(d.getDate() + days);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

// Prochain créneau commun : un des jours préférés, au moins MIN_DAYS_BEFORE_DATE jours après le match.
export function nextDateSlot(fromTs, availA, availB) {
  const common = CONFIG.DATE_WEEKDAYS.filter((d) => (!availA?.length || availA.includes(d)) && (!availB?.length || availB.includes(d)));
  const days = common.length ? common : [6];
  const start = new Date(fromTs);
  start.setHours(CONFIG.DATE_HOUR, 0, 0, 0);
  for (let i = CONFIG.MIN_DAYS_BEFORE_DATE; i < CONFIG.MIN_DAYS_BEFORE_DATE + 14; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    if (days.includes(d.getDay())) return d.getTime();
  }
  return start.getTime() + 7 * DAY;
}

// La liste ordonnée des moments du date pour `me`.
// Chaque moment : { key, at, notif, ready(date) } — ready dit si les conditions sont réunies.
export function moments(date, me) {
  const other = date.a === me ? date.b : date.a;
  const A = (u) => date.answers?.[u] || {};
  const both = (k) => A(me)[k] !== undefined && A(other)[k] !== undefined;
  const bothAccepted = () => A(me).accept === true && A(other).accept === true;
  const D = date.dateAt;
  const created = date.createdAt;
  const tonTour = Math.max(created, at(D, -3, 10));
  const deadline = Math.max(tonTour + 2 * H, at(D, -2, 12));

  return [
    { key: 'invite', at: created, notif: 'Quelqu’un a pensé à toi.', ready: () => true },
    { key: 'cadrage', at: created, notif: 'C’est calé.', ready: bothAccepted },
    { key: 'tonTour', at: tonTour, deadline, notif: 'À ton tour. Réponse attendue avant demain midi.', ready: bothAccepted },
    { key: 'phrase', at: deadline, notif: 'Dans ses mots.', ready: bothAccepted },
    { key: 'lieu', at: at(D, -1, 20), notif: 'Le lieu est fixé.', ready: bothAccepted },
    { key: 'regles', at: at(D, 0, 10), notif: 'Les règles, avant ce soir.', ready: bothAccepted },
    { key: 'objectif', at: at(D, 0, 14), notif: 'Personne d’autre ne le sait.', ready: bothAccepted },
    { key: 'discussion', at: at(D, 0, 19), notif: 'La discussion est ouverte. Vous vous voyez dans une heure.', ready: bothAccepted },
    { key: 'jeu1', at: at(D, 0, 20, 30), notif: 'Premier jeu.', ready: bothAccepted },
    { key: 'jeu2', at: at(D, 0, 21, 0), notif: 'Deuxième jeu.', ready: bothAccepted },
    { key: 'jeu3', at: at(D, 0, 21, 30), notif: 'Troisième jeu. Et vous pouvez parler boulot.', ready: bothAccepted },
    { key: 'jeu4', at: at(D, 0, 22, 0), notif: 'Quatrième jeu.', ready: bothAccepted },
    { key: 'pari', at: at(D, 0, 22, 15), notif: 'On rouvre les paris.', ready: bothAccepted },
    { key: 'reveal', at: at(D, 0, 22, 40), notif: 'On révèle.', ready: bothAccepted },
    { key: 'apres', at: at(D, 1, 11), notif: 'Et maintenant ?', ready: bothAccepted },
    { key: 'verdict', at: at(D, 1, 11), notif: 'Vous avez répondu tous les deux.', ready: () => both('again') },
  ];
}

// Cartes visibles maintenant, dans l'ordre d'arrivée.
export function unlocked(date, me, now = clock.now()) {
  if (!date) return [];
  return moments(date, me).filter((m) => m.at <= now && m.ready(date));
}

// Prochain moment programmé (pour le compte à rebours et les notifications).
export function nextMoment(date, me, now = clock.now()) {
  if (!date) return null;
  return moments(date, me).find((m) => m.at > now && m.key !== 'verdict') || null;
}

// La soirée est-elle en cours ? (pour le bouton « fait » et le mode soirée)
export function isDuringDate(date, now = clock.now()) {
  return now >= at(date.dateAt, 0, 20) && now < at(date.dateAt, 1, 2);
}

// Pour le mode démo : prochain instant intéressant (moment suivant, ou +1 min).
export function nextJump(date, me, now = clock.now()) {
  const n = nextMoment(date, me, now);
  return n ? n.at : now + 60e3;
}
