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

// ---------- Arrivée et fin du date ----------
// Les jeux démarrent 30 min après l'arrivée des deux (bouton « Je suis là »).
// Si l'un des deux n'a pas appuyé à 20h45, on démarre quand même à 20h45.
export const FALLBACK_START = 45 * 60e3;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function arrivals(date) {
  const A = date.answers || {};
  return { [date.a]: num(A[date.a]?.arrived), [date.b]: num(A[date.b]?.arrived) };
}

export function startOf(date) {
  const fb = date.dateAt + FALLBACK_START;
  const r = arrivals(date);
  const x = r[date.a];
  const y = r[date.b];
  return x != null && y != null ? Math.min(Math.max(x, y), fb) : fb;
}

// Quelqu'un a mis fin au date ? { at, by, note }
export function endedOf(date) {
  const A = date.answers || {};
  const list = [date.a, date.b].map((u) => (A[u]?.ended?.at ? { ...A[u].ended, by: u } : null)).filter(Boolean);
  return list.sort((p, q) => p.at - q.at)[0] || null;
}

// Écarts des cartes de la soirée par rapport au début (en minutes).
export const GAME_STEP = 30;
const PARI_AT = 4 * GAME_STEP + 15;
const REVEAL_AT = 4 * GAME_STEP + 40;

// La liste ordonnée des moments du date pour `me`.
// Chaque moment : { key, at, notif, ready(date) } — ready dit si les conditions sont réunies.
// card: false → pas de carte, seulement une notification (ex. l'autre est arrivé).
export function moments(date, me) {
  const other = date.a === me ? date.b : date.a;
  const A = (u) => date.answers?.[u] || {};
  const both = (k) => A(me)[k] !== undefined && A(other)[k] !== undefined;
  const bothAccepted = () => A(me).accept === true && A(other).accept === true;
  const D = date.dateAt;
  const created = date.createdAt;
  const tonTour = Math.max(created, at(D, -3, 10));
  const deadline = Math.max(tonTour + 2 * H, at(D, -2, 12));
  const arr = arrivals(date);
  const bothHere = arr[me] != null && arr[other] != null;
  const st = startOf(date);
  const end = endedOf(date);
  const min = (n) => st + n * 60e3;

  const list = [
    { key: 'invite', at: created, notif: 'Quelqu’un a pensé à toi.', ready: () => true },
    { key: 'cadrage', at: created, notif: 'C’est calé.', ready: bothAccepted },
    { key: 'tonTour', at: tonTour, deadline, notif: 'À ton tour. Réponse attendue avant demain midi.', ready: bothAccepted },
    { key: 'phrase', at: deadline, notif: 'Dans ses mots.', ready: bothAccepted },
    { key: 'lieu', at: at(D, -1, 20), notif: 'Le lieu est fixé.', ready: bothAccepted },
    { key: 'regles', at: at(D, 0, 10), notif: 'Les règles, avant ce soir.', ready: bothAccepted },
    { key: 'objectif', at: at(D, 0, 14), notif: 'Personne d’autre ne le sait.', ready: bothAccepted },
    { key: 'discussion', at: D - H, notif: 'La discussion est ouverte. Vous vous voyez dans une heure.', ready: bothAccepted },
    { key: 'arrive', card: false, at: arr[other], notif: 'est là.', ready: () => bothAccepted() && arr[other] != null && arr[me] == null },
    { key: 'start', at: bothHere ? Math.max(arr[me], arr[other]) : null, notif: 'Vous êtes là tous les deux : le date commence.', ready: () => bothAccepted() && bothHere },
    { key: 'jeu1', at: min(GAME_STEP), notif: 'Premier jeu.', ready: bothAccepted },
    { key: 'jeu2', at: min(2 * GAME_STEP), notif: 'Deuxième jeu.', ready: bothAccepted },
    { key: 'jeu3', at: min(3 * GAME_STEP), notif: 'Troisième jeu. Et vous pouvez parler boulot.', ready: bothAccepted },
    { key: 'jeu4', at: min(4 * GAME_STEP), notif: 'Quatrième jeu.', ready: bothAccepted },
    { key: 'pari', at: min(PARI_AT), notif: 'On rouvre les paris.', ready: bothAccepted },
    { key: 'reveal', at: min(REVEAL_AT), notif: 'On révèle les objectifs.', ready: bothAccepted },
    { key: 'score', at: min(REVEAL_AT), notif: 'Les points sont comptés : qui a gagné ?', ready: () => bothAccepted() && both('guessed') },
    { key: 'fin', at: end?.at ?? null, notif: 'a mis fin au date.', ready: () => !!end && end.by === other },
    { key: 'apres', at: at(D, 1, 11), notif: 'Et maintenant ?', ready: bothAccepted },
    { key: 'verdict', at: at(D, 1, 11), notif: 'Vous avez répondu tous les deux.', ready: () => both('again') },
  ];
  return list.filter((m) => m.at != null && (!end || m.key === 'fin' || m.at <= end.at));
}

// Cartes visibles maintenant, dans l'ordre d'arrivée.
export function unlocked(date, me, now = clock.now()) {
  if (!date) return [];
  return moments(date, me).filter((m) => m.at <= now && m.ready(date));
}

// Prochain moment programmé (pour le compte à rebours et les notifications).
export function nextMoment(date, me, now = clock.now()) {
  if (!date) return null;
  return moments(date, me).find((m) => m.at > now && !['verdict', 'score', 'arrive', 'start', 'fin'].includes(m.key)) || null;
}

// La soirée est-elle en cours ? (pour le bouton « fait », les jeux et le mode soirée)
export function isDuringDate(date, now = clock.now()) {
  if (endedOf(date)) return false;
  return now >= date.dateAt - 30 * 60e3 && now < at(date.dateAt, 1, 4);
}

// Fenêtre du bouton « Je suis là » : dès l'ouverture de la discussion (1 h avant), jusqu'à 2 h après.
export function canArrive(date, now = clock.now()) {
  return !endedOf(date) && now >= date.dateAt - H && now < date.dateAt + 2 * H;
}

// Pour le mode démo : prochain instant intéressant (moment suivant, ou +1 min).
export function nextJump(date, me, now = clock.now()) {
  const n = nextMoment(date, me, now);
  return n ? n.at : now + 60e3;
}
