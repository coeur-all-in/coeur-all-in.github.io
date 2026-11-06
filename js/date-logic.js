// Règles partagées par les deux modes (solo et Supabase) : lieu retenu, objectifs, etc.
import { BET_POINTS, GAME_BANK, OBJECTIVE_POINTS, OBJECTIVES, fallbackPlace, fill, forms } from './content.js';

export function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Deux objectifs différents, tirés au sort de façon stable pour un date donné.
export function pickObjectives(dateId, a, b) {
  const i = hash(dateId) % OBJECTIVES.length;
  let j = hash(dateId + 'b') % OBJECTIVES.length;
  if (j === i) j = (j + 1) % OBJECTIVES.length;
  return { [a]: OBJECTIVES[i].id, [b]: OBJECTIVES[j].id };
}

export function objectiveFor(date, uid, partnerGender) {
  const id = date.objectives?.[uid];
  const o = OBJECTIVES.find((x) => x.id === id) || OBJECTIVES[0];
  return { ...o, text: fill(o.text, forms(partnerGender)) };
}

// Le lieu retenu : une proposition l'emporte sur « je te laisse choisir ».
// Deux propositions → tirage stable. Aucune → un point de rendez-vous public dans la ville.
export function resolvePlace(date, city) {
  const props = [date.a, date.b]
    .map((u) => ({ u, p: date.answers?.[u]?.place }))
    .filter((x) => x.p && !x.p.leave && x.p.name);
  if (props.length === 0) return { ...fallbackPlace(city), by: null };
  const pick = props.length === 1 ? props[0] : props[hash(date.id) % 2];
  return { ...pick.p, by: pick.u };
}

export function partnerOf(date, me) {
  return date.a === me ? date.b : date.a;
}

// ---------- Jeux de la soirée ----------
// Les 4 jeux d'un date : « Deux vérités », « Yeux fermés », puis deux jeux du niveau le plus doux des deux profils.
export function gamesFor(date, pa, pb) {
  const lvl = Math.max(1, Math.min(3, Math.min(Number(pa?.play) || 2, Number(pb?.play) || 2)));
  const fixed = GAME_BANK.filter((g) => g.fixed).sort((x, y) => x.fixed - y.fixed);
  const pool = GAME_BANK.filter((g) => !g.fixed && g.level === lvl)
    .sort((x, y) => hash(date.id + x.id) - hash(date.id + y.id));
  return [...fixed, ...pool.slice(0, 2)].map((g, i) => ({ ...g, slot: i + 1, key: `jeu${i + 1}` }));
}

// Qui commence ce jeu : même tirage sur les deux téléphones.
export function starterOf(date, game) {
  return hash(`${date.id}:${game.id}:start`) % 2 === 0 ? date.a : date.b;
}

// Points d'un jeu pour chacun, à partir des résultats déclarés (réponse `g1`… `g4`).
export function gamePoints(date, game) {
  const out = { [date.a]: 0, [date.b]: 0 };
  for (const u of [date.a, date.b]) {
    const r = date.answers?.[u]?.[`g${game.slot}`];
    if (!r) continue;
    const other = partnerOf(date, u);
    if (game.type === 'count') out[u] += Math.max(0, Math.min(game.max || 3, Number(r.n) || 0)) * game.pts;
    else if (game.type === 'dare') out[u] += r.ok ? game.pts : 0;
    else if (r.ok) out[u] += game.pts;      // guess / duel : gagné → pour soi
    else out[other] += game.pts;            //                perdu → pour l'autre
  }
  return out;
}

// Objectif secret : le premier à le réussir prend 3 points, le second 1 ; deviné par l'autre → 0.
export function objectivePoints(date) {
  const A = (u) => date.answers?.[u] || {};
  const done = [date.a, date.b].filter((u) => typeof A(u).done === 'number').sort((x, y) => A(x).done - A(y).done);
  const out = { [date.a]: 0, [date.b]: 0 };
  done.forEach((u, i) => {
    const caught = A(partnerOf(date, u)).guessed === true;
    out[u] = caught ? 0 : (i === 0 ? OBJECTIVE_POINTS.first : OBJECTIVE_POINTS.second);
  });
  return out;
}

// Tableau des scores complet : { total: {a, b}, lines: [{ label, pts: {a, b} }] }
export function scoreBoard(date, games) {
  const lines = games.map((g) => ({ label: g.title, pts: gamePoints(date, g), done: [date.a, date.b].map((u) => !!date.answers?.[u]?.[`g${g.slot}`]) }));
  lines.push({ label: 'Objectif secret', pts: objectivePoints(date) });
  const bet = { [date.a]: 0, [date.b]: 0 };
  for (const u of [date.a, date.b]) if (date.answers?.[partnerOf(date, u)]?.betVerdict === true) bet[u] = BET_POINTS;
  lines.push({ label: 'Le pari', pts: bet });
  const total = { [date.a]: 0, [date.b]: 0 };
  for (const l of lines) for (const u of [date.a, date.b]) total[u] += l.pts[u] || 0;
  return { total, lines };
}
