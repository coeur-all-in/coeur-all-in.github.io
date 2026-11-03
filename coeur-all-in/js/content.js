// Tout le contenu éditorial de l'appli : options du profil, jeux, objectifs secrets.
// Modifier ce fichier suffit pour changer les textes sans toucher à la logique.

export const GENDERS = [
  { id: 'homme', label: 'Un homme' },
  { id: 'femme', label: 'Une femme' },
  { id: 'nonbinaire', label: 'Non-binaire' },
];

export const SEEKING = [
  { id: 'homme', label: 'Des hommes' },
  { id: 'femme', label: 'Des femmes' },
  { id: 'nonbinaire', label: 'Des personnes non-binaires' },
];

export const BUILDS = ['Mince', 'Élancée', 'Sportive', 'Moyenne', 'Musclée', 'Ronde', 'Forte'];

export const ORIGINS = [
  'Européenne', 'Maghrébine', 'Afrique subsaharienne', 'Antillaise / Caribéenne',
  'Moyen-Orientale', 'Asie de l’Est', 'Asie du Sud', 'Latino-américaine', 'Métisse', 'Autre',
];

export const HAIR_COLORS = ['Bruns', 'Noirs', 'Châtains', 'Blonds', 'Roux', 'Gris / blancs', 'Colorés', 'Rasés / chauve'];
export const HAIR_LENGTHS = ['Très courts', 'Courts', 'Mi-longs', 'Longs', 'Bouclés / afro', 'Tressés / locks'];
export const EYES = ['Marron', 'Noirs', 'Noisette', 'Verts', 'Bleus', 'Gris'];

export const STYLES = [
  'Casual', 'Chic', 'Streetwear', 'Classique', 'Bohème', 'Sportswear',
  'Minimaliste', 'Rock', 'Vintage', 'Créatif', 'Workwear', 'Toujours en noir',
];

export const VALUES = [
  'Loyauté', 'Liberté', 'Humour', 'Curiosité', 'Ambition', 'Famille', 'Honnêteté',
  'Gentillesse', 'Aventure', 'Spiritualité', 'Engagement', 'Calme', 'Générosité', 'Indépendance',
];

export const INTERESTS = [
  'Cuisine', 'Voyages', 'Musique live', 'Cinéma', 'Lecture', 'Sport', 'Randonnée', 'Danse',
  'Art & expos', 'Jeux de société', 'Jeux vidéo', 'Mode', 'Photo', 'Tech', 'Engagement asso',
  'Théâtre', 'Mer & plage', 'Fête', 'Méditation / yoga', 'Écriture', 'Animaux', 'Food & restos',
];

export const AMBITIONS = [
  'Monter ma boîte', 'Évoluer dans mon métier', 'Changer de vie', 'Voyager longtemps',
  'Fonder une famille', 'Acheter un lieu à moi', 'Créer (art, musique, écriture…)',
  'Avoir du temps pour moi', 'M’engager pour une cause', 'Je verrai bien',
];

export const INTENTS = [
  { id: 'serieux', label: 'Une histoire sérieuse' },
  { id: 'voir', label: 'Je verrai bien sur place' },
  { id: 'leger', label: 'Quelque chose de léger' },
];

export const KIDS = [
  { id: 'veux', label: 'J’en veux un jour' },
  { id: 'ai', label: 'J’en ai déjà' },
  { id: 'peutetre', label: 'Peut-être' },
  { id: 'non', label: 'Je n’en veux pas' },
];

export const HABITS = [
  { id: 'jamais', label: 'Jamais' },
  { id: 'parfois', label: 'Parfois' },
  { id: 'souvent', label: 'Souvent' },
];

// Curseurs de caractère : [gauche, droite]
export const TRAITS = [
  { id: 'social', left: 'Réservé·e', right: 'Expansif·ve' },
  { id: 'tempo', left: 'Calme', right: 'Intense' },
  { id: 'plan', left: 'Spontané·e', right: 'Organisé·e' },
  { id: 'talk', left: 'J’écoute', right: 'Je raconte' },
];

export const WEEKDAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
  'septembre', 'octobre', 'novembre', 'décembre'];

// ---------- Pronoms et accords ----------
// Renvoie les formes à utiliser pour parler d'une personne.
export function forms(gender) {
  if (gender === 'femme') return { il: 'elle', Il: 'Elle', le: 'la', lui: 'elle', e: 'e', eur: 'euse', qu: 'qu’elle' };
  if (gender === 'nonbinaire') return { il: 'iel', Il: 'Iel', le: 'le·la', lui: 'iel', e: '·e', eur: 'eur·euse', qu: 'qu’iel' };
  return { il: 'il', Il: 'Il', le: 'le', lui: 'lui', e: '', eur: 'eur', qu: 'qu’il' };
}

// Le portrait écrit par la personne elle-même, à la 3e personne (carte « Quelqu'un a pensé à toi »).
export function portraitText(p) {
  const f = forms(p.gender);
  const parts = [];
  const pr = p.portrait || {};
  if (pr.first) parts.push(`${f.Il} est ${trimDot(pr.first)}.`);
  if (pr.people) parts.push(`${f.Il} ${trimDot(pr.people)}.`);
  if (pr.unforgivable) parts.push(`${f.Il} pardonne à peu près tout, sauf ${trimDot(pr.unforgivable)}.`);
  return parts.join(' ');
}

function trimDot(s) {
  return String(s).trim().replace(/[.\s]+$/, '');
}

// Description physique révélée la veille, pour se reconnaître.
export function recognitionLines(p) {
  const lines = [];
  if (p.height) lines.push(`${(p.height / 100).toFixed(2).replace('.', 'm')}`);
  const hair = [p.hairColor, p.hairLength].filter(Boolean).join(', ').toLowerCase();
  if (hair) lines.push(`Cheveux ${hair}`);
  if (p.eyes) lines.push(`Yeux ${p.eyes.toLowerCase()}`);
  if (p.build) lines.push(`Silhouette ${p.build.toLowerCase()}`);
  if (p.style?.length) lines.push(`Style ${p.style.slice(0, 2).join(' & ').toLowerCase()}`);
  if (p.distinctive) lines.push(p.distinctive);
  return lines;
}

// ---------- Les quatre messages de la soirée ----------
export const GAMES = [
  {
    id: 'jeu1',
    eyebrow: 'Premier jeu',
    title: 'Deux vérités',
    meta: 'Et un mensonge',
    body: ['Chacun dit trois choses sur lui : deux vraies, une fausse. L’autre désigne le mensonge dans la foulée.'],
    items: [
      'Deux minutes pour y penser, pas plus',
      'On répond tout de suite, et on dit pourquoi',
      'Celui qui se trompe répondra en premier au prochain jeu',
    ],
    foot: 'Prochain message à venir.',
  },
  {
    id: 'jeu2',
    eyebrow: 'Deuxième jeu',
    title: 'Yeux fermés',
    meta: 'Ce que tu as vraiment regardé',
    body: ['Fermez les yeux chacun votre tour. L’autre te pose trois questions sur ce qu’il porte, ou sur ce qui vous entoure.'],
    items: [
      'Trois questions, pas une de plus',
      'Celui qui ouvre les yeux a perdu',
      'Le perdant choisit la prochaine direction',
    ],
    foot: 'Prochain message à venir.',
  },
  {
    id: 'jeu3',
    eyebrow: 'Troisième jeu',
    title: 'La question',
    meta: 'Une seule, chacun',
    body: ['Pose-lui la question audacieuse, celle que tu n’aurais pas osé poser.'],
    items: [
      'Une question chacun, pas deux',
      'On a le droit de répondre à côté',
      'Celui qui pose répond aussi',
    ],
    foot: 'Prochain message à venir.',
  },
  {
    id: 'jeu4',
    eyebrow: 'Quatrième jeu',
    title: 'Trente secondes',
    meta: 'Sans parler, en vous regardant',
    body: ['Le temps va vous paraître long. C’est normal. Ne dites rien avant la fin.'],
    items: [
      'Quelqu’un lance le chrono',
      'On ne parle pas, on ne rit pas trop fort',
      'À la fin, chacun dit un mot. Un seul',
    ],
    foot: 'Les paris arrivent juste après.',
    timer: 30,
  },
];

// ---------- Objectifs secrets ----------
// {le} {il} {qu} {e} sont remplacés selon la personne en face.
export const OBJECTIVES = [
  { id: 'vingt', title: 'Vingt ans', text: 'Amène-{le} à parler de ce {qu} faisait à vingt ans.' },
  { id: 'souvenir', title: 'Premier souvenir', text: 'Amène-{le} à te raconter son plus vieux souvenir.' },
  { id: 'fourire', title: 'Fou rire', text: 'Amène-{le} à te raconter son dernier vrai fou rire.' },
  { id: 'chanson', title: 'En boucle', text: 'Amène-{le} à te dire quelle chanson {il} écoute en boucle en ce moment.' },
  { id: 'ailleurs', title: 'Ailleurs', text: 'Amène-{le} à te parler d’un endroit où {il} rêverait de vivre.' },
  { id: 'fierte', title: 'Une fierté', text: 'Amène-{le} à te parler d’une chose dont {il} est fier{e} et dont {il} ne parle jamais.' },
  { id: 'enfant', title: 'Plus tard', text: 'Amène-{le} à te dire ce {qu} voulait faire quand {il} était petit{e}.' },
  { id: 'plat', title: 'Le plat', text: 'Amène-{le} à te dire ce {qu} te cuisinerait pour un premier dîner.' },
];

export function fill(text, f) {
  return text.replace(/\{(\w+)\}/g, (_, k) => (f[k] ?? ''));
}

// Lieux de repli quand les deux laissent le choix : des points publics, faciles à trouver.
export const FALLBACK_PLACES = {
  paris: { title: 'Au bord de l’eau', name: 'Le bassin de la Villette', address: 'Place de la Bataille-de-Stalingrad, Paris 19e', after: 'De là, vous longez le canal ensemble. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  lyon: { title: 'Entre deux rives', name: 'La passerelle Saint-Georges', address: 'Quai Fulchiron, Lyon 5e', after: 'Vous traversez, puis vous montez ou descendez les quais. À vous de voir.', tip: 'Prévois une veste, ça souffle sur la Saône' },
  marseille: { title: 'Face à la mer', name: 'Le Vieux-Port, côté ombrière', address: 'Quai de la Fraternité, Marseille', after: 'De là, vous marchez vers le Mucem. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  bordeaux: { title: 'Le miroir', name: 'Le Miroir d’eau', address: 'Place de la Bourse, Bordeaux', after: 'Vous remontez les quais ensemble. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  lille: { title: 'Sous les arcades', name: 'La Vieille Bourse', address: 'Place du Général-de-Gaulle, Lille', after: 'De là, vous marchez dans le Vieux-Lille. La suite se décide en chemin.', tip: 'Prévois un parapluie, on ne sait jamais' },
  toulouse: { title: 'Bord de Garonne', name: 'La Prairie des Filtres', address: 'Cours Dillon, Toulouse', after: 'Vous longez la Garonne ensemble. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  nantes: { title: 'Sur l’île', name: 'Les Machines de l’île, côté Carrousel', address: 'Parc des Chantiers, Nantes', after: 'Vous marchez le long de la Loire. La suite se décide en chemin.', tip: 'Prévois une veste' },
};

export function fallbackPlace(city) {
  const key = String(city || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  for (const k of Object.keys(FALLBACK_PLACES)) if (key.startsWith(k)) return FALLBACK_PLACES[k];
  return {
    title: 'Au centre',
    name: `Devant la mairie de ${city || 'ta ville'}`,
    address: city || '',
    after: 'Vous marchez ensemble jusqu’au premier café qui vous plaît. La suite se décide en chemin.',
    tip: 'Prévois des chaussures adaptées',
  };
}
