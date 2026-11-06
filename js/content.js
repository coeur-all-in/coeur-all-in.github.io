// Tout le contenu éditorial de l'appli : options du profil, jeux, objectifs secrets.
// Modifier ce fichier suffit pour changer les textes sans toucher à la logique.

// Ce que la personne veut rencontrer. Son propre sexe vient de la vérification d'identité (document officiel).
export const SEEKING = [
  { id: 'homme', label: 'Des hommes' },
  { id: 'femme', label: 'Des femmes' },
];

export const BUILDS = ['Mince', 'Élancée', 'Sportive', 'Moyenne', 'Musclée', 'Ronde', 'Forte'];

export const ORIGINS = [
  'Européenne', 'Maghrébine', 'Afrique subsaharienne', 'Antillaise / Caribéenne',
  'Moyen-Orientale', 'Asie de l’Est', 'Asie du Sud', 'Latino-américaine', 'Métisse', 'Autre',
];

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

// Côté joueur : sert à choisir les jeux de la soirée (on prend le niveau le plus doux des deux).
export const PLAY = [
  { id: 1, label: 'Tranquille', d: 'Des jeux doux, pour parler' },
  { id: 2, label: 'Joueur·se', d: 'Des petits défis, ça me va' },
  { id: 3, label: 'À fond', d: 'Défis osés : changer de lieu, chanter…' },
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
  const f = p.gender ? forms(p.gender) : { Il: p.firstName?.trim() || 'Iel' };
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

// ---------- Banque de jeux ----------
// Chaque date reçoit 4 jeux : « Deux vérités » et « Yeux fermés », puis deux jeux tirés au sort
// dans le niveau le plus doux des deux profils (1 tranquille, 2 joueur, 3 à fond).
// type : guess (trouver = points pour soi, sinon pour l'autre), count (n bonnes réponses × pts),
//        duel (gagné = points pour soi, perdu = points pour l'autre), dare (défi relevé = points pour soi).
// starter : on tire au sort qui commence (même résultat sur les deux téléphones).
export const GAME_BANK = [
  {
    id: 'verites', level: 1, fixed: 1, type: 'guess', pts: 2, starter: true,
    title: 'Deux vérités', meta: 'Et un mensonge',
    body: ['Chacun dit trois choses sur soi : deux vraies, une fausse. L’autre doit trouver le mensonge.'],
    items: ['Deux minutes pour y penser, pas plus', 'On désigne le mensonge tout de suite, et on dit pourquoi', 'Tu trouves son mensonge : 2 points pour toi', 'Tu te trompes : 2 points pour l’autre'],
    q: 'As-tu trouvé son mensonge ?', yes: 'J’ai trouvé', no: 'Je me suis trompé·e',
  },
  {
    id: 'yeux', level: 1, fixed: 2, type: 'count', pts: 1, max: 3, starter: true, eyes: true,
    title: 'Yeux fermés', meta: 'Ce que tu as vraiment regardé',
    body: ['La personne tirée au sort ferme les yeux tout de suite. L’autre lui pose 3 questions sur ce qu’il ou elle porte, ou sur ce qui vous entoure : la couleur de ses yeux, ce qu’il y a sur la table, la couleur du mur… Ensuite, on échange les rôles.'],
    items: ['Les yeux restent fermés jusqu’à la fin des 3 questions', '3 questions chacun, pas une de plus', '1 point par bonne réponse', 'Chacun note ensuite ses bonnes réponses'],
    q: 'Combien de bonnes réponses as-tu données ?',
  },
  {
    id: 'trente', level: 1, type: 'duel', pts: 2, timer: 30,
    title: 'Trente secondes', meta: 'Sans parler, en vous regardant',
    body: ['Regardez-vous dans les yeux pendant 30 secondes, sans parler. Le temps va vous paraître long. C’est normal.'],
    items: ['Quelqu’un lance le chrono', 'Le premier qui parle, rit ou détourne le regard a perdu', 'Le gagnant prend 2 points', 'À la fin, chacun dit un mot. Un seul'],
    q: 'Qui a tenu ?', yes: 'Moi', no: 'L’autre',
  },
  {
    id: 'communs', level: 1, type: 'count', pts: 1, max: 3,
    title: 'Trois points communs', meta: 'Les inattendus seulement',
    body: ['Vous avez 5 minutes pour trouver 3 points communs inattendus. « On aime voyager » ne compte pas.'],
    items: ['Interdit : la musique, les voyages, la nourriture en général', 'Un point commun compte si vous êtes d’accord tous les deux', '1 point chacun par point commun trouvé'],
    q: 'Combien en avez-vous trouvé ?',
  },
  {
    id: 'devine', level: 1, type: 'count', pts: 1, max: 3, starter: true,
    title: 'Devine qui je suis', meta: 'Trois intuitions',
    body: ['Chacun essaie de deviner trois choses sur l’autre : son plat préféré, sa saison préférée, et le film qu’il ou elle a vu le plus de fois.'],
    items: ['Une seule réponse par question', '1 point par bonne réponse', 'La personne tirée au sort devine en premier'],
    q: 'Combien de bonnes réponses as-tu trouvées ?',
  },
  {
    id: 'pfc', level: 1, type: 'duel', pts: 2,
    title: 'Pierre-feuille-ciseaux', meta: 'En trois manches gagnantes',
    body: ['Le duel le plus sérieux de la soirée. Le premier à trois manches gagnées l’emporte.'],
    items: ['On compte « pierre, feuille, ciseaux » à voix haute', 'Pas de changement de dernière seconde', 'Le gagnant prend 2 points'],
    q: 'Qui a gagné ?', yes: 'Moi', no: 'L’autre',
  },
  {
    id: 'mime', level: 2, type: 'guess', pts: 2, starter: true, timer: 60,
    title: 'Le mime', meta: 'Un souvenir, sans un mot',
    body: ['Chacun mime un souvenir marquant de sa vie : un voyage, une chute, une rencontre… L’autre a une minute pour deviner.'],
    items: ['Aucun son, aucun mot', 'Une minute chrono par mime', 'Tu devines son souvenir : 2 points pour toi', 'Tu ne trouves pas : 2 points pour l’autre'],
    q: 'As-tu deviné son souvenir ?', yes: 'J’ai trouvé', no: 'Pas trouvé',
  },
  {
    id: 'motinterdit', level: 2, type: 'count', pts: 1, max: 5,
    title: 'Le mot interdit', meta: 'Ni oui, ni non',
    body: ['Jusqu’au prochain jeu, interdit de dire « oui » ou « non ». Piégez l’autre avec vos questions.'],
    items: ['Chaque « oui » ou « non » de l’autre te rapporte 1 point', '5 points maximum', 'Les hochements de tête sont autorisés'],
    q: 'Combien de fois l’as-tu piégé·e ?',
  },
  {
    id: 'accent', level: 2, type: 'dare', pts: 2,
    title: 'L’accent', meta: 'Le serveur s’en souviendra',
    body: ['Chacun commande sa prochaine boisson avec l’accent choisi par l’autre.'],
    items: ['L’accent se choisit en secret, à l’oreille', 'Interdit d’éclater de rire avant la fin de la commande', 'Défi relevé : 2 points'],
    q: 'Défi relevé ?', yes: 'Fait', no: 'Pas fait',
  },
  {
    id: 'complice', level: 2, type: 'dare', pts: 2, starter: true,
    title: 'Le complice', meta: 'Un inconnu tranche',
    body: ['Demandez à quelqu’un autour de vous depuis combien de temps vous vous connaissez, d’après lui.'],
    items: ['C’est la personne tirée au sort qui demande', 'S’il répond plus d’un an : 2 points chacun', 'S’il devine que c’est un premier date : rien'],
    q: 'Il a répondu plus d’un an ?', yes: 'Oui', no: 'Non',
  },
  {
    id: 'ailleurs', level: 3, type: 'dare', pts: 3,
    title: 'Ailleurs', meta: 'On change de lieu',
    body: ['Vous avez 10 minutes pour quitter cet endroit et en trouver un autre, qu’aucun de vous deux ne connaît, à moins de 10 minutes à pied.'],
    items: ['Le perdant du dernier jeu choisit la direction', 'Pas de téléphone pour chercher : on demande aux passants', 'Vous y êtes : 3 points chacun'],
    q: 'Vous avez changé de lieu ?', yes: 'C’est fait', no: 'On est resté·es',
  },
  {
    id: 'echange', level: 3, type: 'dare', pts: 3,
    title: 'L’échange', meta: 'Jusqu’à la fin de la soirée',
    body: ['Chacun choisit un accessoire de l’autre (montre, bague, écharpe, casquette…) et le porte jusqu’à la fin du date.'],
    items: ['On a le droit de refuser, mais ça ne rapporte rien', 'On se le rend avant de se quitter', 'Échange accepté : 3 points'],
    q: 'Tu portes son accessoire ?', yes: 'Oui', no: 'Non',
  },
  {
    id: 'refrain', level: 3, type: 'dare', pts: 3,
    title: 'Le refrain', meta: 'Dix secondes de courage',
    body: ['Chacun choisit une chanson que l’autre doit chanter : dix secondes du refrain, à voix normale.'],
    items: ['Pas de chuchotement', 'L’autre a le droit de faire les chœurs', 'Défi relevé : 3 points'],
    q: 'Tu as chanté ?', yes: 'Oui', no: 'Non',
  },
  {
    id: 'toast', level: 3, type: 'dare', pts: 3,
    title: 'Le toast', meta: 'Verre levé',
    body: ['Chacun porte un toast à l’autre pendant 20 secondes, debout, assez fort pour que la table d’à côté entende.'],
    items: ['Debout, verre levé', '20 secondes minimum', 'Défi relevé : 3 points'],
    q: 'Tu as porté ton toast ?', yes: 'Oui', no: 'Non',
  },
];

// Points de l'objectif secret : le premier à le réussir prend 3 points, le second 1.
// Si l'autre l'a deviné avant la révélation : aucun point.
export const OBJECTIVE_POINTS = { first: 3, second: 1 };
export const BET_POINTS = 2;

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
  paris: { lat: 48.8848, lng: 2.3708, title: 'Au bord de l’eau', name: 'Le bassin de la Villette', address: 'Place de la Bataille-de-Stalingrad, Paris 19e', after: 'De là, vous longez le canal ensemble. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  lyon: { lat: 45.7605, lng: 4.8263, title: 'Entre deux rives', name: 'La passerelle Saint-Georges', address: 'Quai Fulchiron, Lyon 5e', after: 'Vous traversez, puis vous montez ou descendez les quais. À vous de voir.', tip: 'Prévois une veste, ça souffle sur la Saône' },
  marseille: { lat: 43.2951, lng: 5.3744, title: 'Face à la mer', name: 'Le Vieux-Port, côté ombrière', address: 'Quai de la Fraternité, Marseille', after: 'De là, vous marchez vers le Mucem. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  bordeaux: { lat: 44.8413, lng: -0.5698, title: 'Le miroir', name: 'Le Miroir d’eau', address: 'Place de la Bourse, Bordeaux', after: 'Vous remontez les quais ensemble. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  lille: { lat: 50.6371, lng: 3.0636, title: 'Sous les arcades', name: 'La Vieille Bourse', address: 'Place du Général-de-Gaulle, Lille', after: 'De là, vous marchez dans le Vieux-Lille. La suite se décide en chemin.', tip: 'Prévois un parapluie, on ne sait jamais' },
  toulouse: { lat: 43.5975, lng: 1.4366, title: 'Bord de Garonne', name: 'La Prairie des Filtres', address: 'Cours Dillon, Toulouse', after: 'Vous longez la Garonne ensemble. La suite se décide en chemin.', tip: 'Prévois des chaussures adaptées' },
  nantes: { lat: 47.2066, lng: -1.5642, title: 'Sur l’île', name: 'Les Machines de l’île, côté Carrousel', address: 'Parc des Chantiers, Nantes', after: 'Vous marchez le long de la Loire. La suite se décide en chemin.', tip: 'Prévois une veste' },
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
