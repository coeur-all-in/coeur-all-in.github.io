// Algorithme de matching (utilisé en mode solo ; supabase/schema.sql en contient l'équivalent SQL).
//
// 1. Filtres stricts (les deux sens) : genre recherché, tranche d'âge, distance.
// 2. Score sur 100 = 65 % « ce que chacun recherche chez l'autre » (style, silhouette, taille,
//    caractère, valeurs…, dans les deux sens) + 35 % affinités générales :
//    - intention (sérieux / léger…)        20
//    - valeurs communes                    20
//    - centres d'intérêt communs           15
//    - caractère (curseurs proches)        15
//    - ambitions communes                  10
//    - enfants compatibles                 10
//    - habitudes (tabac, alcool)           10

export function age(birthdate, now = Date.now()) {
  const b = new Date(birthdate);
  const n = new Date(now);
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

export function distanceKm(p, q) {
  if (p.lat == null || q.lat == null) return sameCity(p, q) ? 0 : null;
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(q.lat - p.lat);
  const dLng = toR(q.lng - p.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(p.lat)) * Math.cos(toR(q.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function sameCity(p, q) {
  const n = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return n(p.city) && n(p.city) === n(q.city);
}

function wants(p, q) {
  if (!p.seeking?.includes(q.gender)) return false;
  const a = age(q.birthdate);
  if (a < (p.ageMin || 18) || a > (p.ageMax || 99)) return false;
  return true;
}

export function compatible(p, q) {
  if (p.id === q.id) return false;
  if (!wants(p, q) || !wants(q, p)) return false;
  const d = distanceKm(p, q);
  if (d === null) return false;
  const max = Math.min(p.maxKm || 30, q.maxKm || 30);
  return d <= max;
}

const overlap = (a = [], b = []) => a.filter((x) => b.includes(x)).length;

// À quel point q correspond à ce que p recherche (0 → 1). Ce qui est laissé vide compte comme « peu importe ».
export function desire(p, q) {
  const w = p.want || {};
  const parts = [];
  if (w.styles?.length) { const o = overlap(w.styles, q.style); parts.push([0.25, o ? 0.6 + 0.4 * Math.min(o, 2) / 2 : 0.15]); }
  if (w.builds?.length) parts.push([0.15, w.builds.includes(q.build) ? 1 : 0.25]);
  if (w.heightMin && w.heightMax && q.height) {
    const d = q.height < w.heightMin ? w.heightMin - q.height : q.height > w.heightMax ? q.height - w.heightMax : 0;
    parts.push([0.15, Math.max(0, 1 - d / 12)]);
  }
  const tr = Object.entries(w.traits || {}).filter(([, v]) => v);
  if (tr.length) parts.push([0.2, tr.reduce((a, [k, v]) => a + (1 - Math.abs(v - (q.traits?.[k] ?? 3)) / 4), 0) / tr.length]);
  if (w.values?.length) parts.push([0.15, 0.25 + 0.75 * Math.min(overlap(w.values, q.values), 2) / 2]);
  if (w.interests?.length) parts.push([0.05, 0.4 + 0.6 * Math.min(overlap(w.interests, q.interests), 2) / 2]);
  if (w.smoke && w.smoke !== 'egal') parts.push([0.1, q.smoke === 'jamais' ? 1 : q.smoke === 'parfois' ? (w.smoke === 'plutot' ? 0.6 : 0.3) : (w.smoke === 'plutot' ? 0.3 : 0)]);
  const tot = parts.reduce((a, [wt]) => a + wt, 0);
  return tot ? parts.reduce((a, [wt, v]) => a + wt * v, 0) / tot : 0.7;
}

// Score final sur 100 : 65 % « ce que chacun recherche » (dans les deux sens), 35 % affinités générales.
export function score(p, q) {
  const mutual = (desire(p, q) + desire(q, p)) / 2;
  return Math.round(65 * mutual + 0.35 * baseScore(p, q));
}

function baseScore(p, q) {
  let s = 0;
  // Intention
  if (p.intent === q.intent) s += 20;
  else if (p.intent === 'voir' || q.intent === 'voir') s += 12;
  // Valeurs (jusqu'à 3 en commun)
  s += Math.min(overlap(p.values, q.values), 3) / 3 * 20;
  // Centres d'intérêt
  s += Math.min(overlap(p.interests, q.interests), 3) / 3 * 15;
  // Caractère : curseurs 1-5, on récompense la proximité
  const traits = ['social', 'tempo', 'plan', 'talk'];
  let gap = 0;
  for (const t of traits) gap += Math.abs((p.traits?.[t] ?? 3) - (q.traits?.[t] ?? 3));
  s += (1 - gap / (traits.length * 4)) * 15;
  // Ambitions
  s += Math.min(overlap(p.ambitions, q.ambitions), 2) / 2 * 10;
  // Enfants
  const k = [p.kids, q.kids].sort().join('-');
  if (p.kids === q.kids) s += 10;
  else if (k.includes('peutetre')) s += 6;
  else if (k === 'non-veux') s += 0;
  else s += 4;
  // Habitudes
  const hab = (x, y) => (x === y ? 1 : x === 'parfois' || y === 'parfois' ? 0.6 : 0.1);
  s += hab(p.smoke, q.smoke) * 5 + hab(p.drink, q.drink) * 5;
  return Math.round(s);
}

// Meilleur candidat pour `me` parmi `pool`, hors personnes déjà rencontrées / refusées.
export function bestMatch(me, pool, exclude = []) {
  let best = null;
  for (const q of pool) {
    if (exclude.includes(q.id) || !compatible(me, q)) continue;
    const sc = score(me, q);
    if (!best || sc > best.score) best = { profile: q, score: sc };
  }
  return best;
}
