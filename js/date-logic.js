// Règles partagées par les deux modes (solo et Supabase) : lieu retenu, objectifs, etc.
import { OBJECTIVES, fallbackPlace, fill, forms } from './content.js';

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
