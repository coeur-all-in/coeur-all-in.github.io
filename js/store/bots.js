// Profils fictifs du mode solo. Ils permettent de jouer tout le déroulé sans second téléphone.
// `script` décrit ce que la personne simulée répond à chaque étape.

const base = {
  lat: 48.8566, lng: 2.3522, city: 'Paris', maxKm: 30, ageMin: 22, ageMax: 45,
  availability: [6, 5, 4], smoke: 'jamais', drink: 'parfois', bot: true,
};

const noccio = {
  title: 'Au bord de l’eau', name: 'Noccio', address: '202 rue d’Aubervilliers, Paris',
  after: 'De là vous marchez ensemble jusqu’au bassin de la Villette. La suite se décide en chemin.',
  tip: 'Prévois des chaussures adaptées',
};

export const BOTS = [
  {
    ...base, id: 'bot-kevin', firstName: 'Kévin', gender: 'homme', seeking: ['femme'], birthdate: '1993-04-12',
    height: 182, build: 'Sportive', hairColor: 'Bruns', hairLength: 'Courts', eyes: 'Marron', style: ['Casual', 'Minimaliste'],
    distinctive: 'Une veste en jean, toujours', values: ['Curiosité', 'Calme', 'Honnêteté'],
    interests: ['Lecture', 'Randonnée', 'Cuisine', 'Musique live'], ambitions: ['Évoluer dans mon métier', 'Voyager longtemps'],
    traits: { social: 2, tempo: 1, plan: 3, talk: 1 }, intent: 'serieux', kids: 'veux', job: 'Architecte',
    portrait: { first: 'calme, au point que ça se remarque dès les premières minutes', people: 'pose beaucoup de questions et écoute vraiment les réponses', unforgivable: 'l’esprit fermé' },
    phone: '06 12 34 56 78',
    script: {
      place: noccio,
      phrase: 'Je ne cours pas après les gens. En revanche, quand quelqu’un éveille ma curiosité, j’aime comprendre ce qui le rend unique.',
      bet: 'Elle va me dire on t’a pas dit que tu ressemblais à…', doneMin: 72, again: true,
    },
  },
  {
    ...base, id: 'bot-marie', firstName: 'Marie', gender: 'femme', seeking: ['homme'], birthdate: '1996-09-03',
    height: 168, build: 'Élancée', hairColor: 'Châtains', hairLength: 'Longs', eyes: 'Verts', style: ['Bohème', 'Vintage'],
    distinctive: 'Un foulard jaune dans les cheveux', values: ['Liberté', 'Humour', 'Curiosité'],
    interests: ['Art & expos', 'Voyages', 'Danse', 'Food & restos'], ambitions: ['Créer (art, musique, écriture…)', 'Voyager longtemps'],
    traits: { social: 4, tempo: 4, plan: 2, talk: 4 }, intent: 'voir', kids: 'peutetre', job: 'Illustratrice',
    portrait: { first: 'solaire, mais ne vous fiez pas à la première impression', people: 'retient tout ce qu’on lui raconte, même trois mois plus tard', unforgivable: 'qu’on lui mente sur les petites choses' },
    phone: '06 98 76 54 32',
    script: {
      place: { leave: true },
      phrase: 'J’ai toujours un carnet sur moi. Si je le sors pendant qu’on parle, c’est plutôt bon signe.',
      bet: 'Il va commander la même chose que moi pour ne pas avoir à choisir.', doneMin: 55, again: true,
    },
  },
  {
    ...base, id: 'bot-ines', firstName: 'Inès', gender: 'femme', seeking: ['homme', 'femme'], birthdate: '1994-01-22',
    height: 160, build: 'Moyenne', hairColor: 'Noirs', hairLength: 'Bouclés / afro', eyes: 'Noirs', style: ['Streetwear', 'Créatif'],
    distinctive: 'Des grosses lunettes rondes', values: ['Ambition', 'Loyauté', 'Humour'],
    interests: ['Musique live', 'Jeux de société', 'Tech', 'Cinéma'], ambitions: ['Monter ma boîte', 'Acheter un lieu à moi'],
    traits: { social: 5, tempo: 4, plan: 4, talk: 3 }, intent: 'serieux', kids: 'veux', job: 'Développeuse',
    portrait: { first: 'drôle avant même d’avoir dit bonjour', people: 'transforme n’importe quelle file d’attente en soirée', unforgivable: 'le mépris' },
    phone: '07 11 22 33 44',
    script: {
      place: { title: 'En hauteur', name: 'Le parc de Belleville, en haut des escaliers', address: 'Rue Piat, Paris 20e', after: 'Vous regardez Paris d’en haut, puis vous descendez vers la rue de Belleville.', tip: 'Prévois une veste, ça souffle là-haut' },
      phrase: 'Je pose souvent la question qu’on n’ose pas poser. Tu es prévenu·e.',
      bet: 'Tu vas me demander d’où vient mon prénom dans les dix premières minutes.', doneMin: 40, again: true,
    },
  },
  {
    ...base, id: 'bot-yanis', firstName: 'Yanis', gender: 'homme', seeking: ['femme', 'homme'], birthdate: '1991-06-30',
    height: 176, build: 'Musclée', hairColor: 'Noirs', hairLength: 'Très courts', eyes: 'Noisette', style: ['Chic', 'Classique'],
    distinctive: 'Une montre à cadran vert', values: ['Famille', 'Engagement', 'Générosité'],
    interests: ['Sport', 'Cuisine', 'Voyages', 'Engagement asso'], ambitions: ['Fonder une famille', 'Monter ma boîte'],
    traits: { social: 3, tempo: 3, plan: 5, talk: 2 }, intent: 'serieux', kids: 'veux', job: 'Kiné',
    portrait: { first: 'posé, du genre à arriver dix minutes en avance', people: 'fait toujours en sorte que tout le monde ait parlé avant de partir', unforgivable: 'qu’on soit dur avec les serveurs' },
    phone: '06 55 44 33 22',
    script: {
      place: { leave: true },
      phrase: 'Je cuisine pour les gens que j’aime. C’est ma façon de dire les choses.',
      bet: 'Tu vas rire avant moi au jeu des trente secondes.', doneMin: 85, again: true,
    },
  },
  {
    ...base, id: 'bot-camille', firstName: 'Camille', gender: 'nonbinaire', seeking: ['femme', 'homme', 'nonbinaire'], birthdate: '1997-11-14',
    height: 171, build: 'Mince', hairColor: 'Colorés', hairLength: 'Mi-longs', eyes: 'Bleus', style: ['Rock', 'Toujours en noir'],
    distinctive: 'Des bagues à presque tous les doigts', values: ['Liberté', 'Gentillesse', 'Curiosité'],
    interests: ['Théâtre', 'Écriture', 'Musique live', 'Photo'], ambitions: ['Créer (art, musique, écriture…)', 'Changer de vie'],
    traits: { social: 3, tempo: 3, plan: 2, talk: 3 }, intent: 'voir', kids: 'peutetre', job: 'Comédien·ne',
    portrait: { first: 'curieux·se de tout, surtout de ce qui ne se dit pas', people: 'lit dans les silences mieux que dans les mots', unforgivable: 'l’indifférence' },
    phone: '07 66 77 88 99',
    script: {
      place: { leave: true },
      phrase: 'J’ai changé de vie deux fois. Je ne suis pas contre une troisième.',
      bet: 'Tu vas tricher au jeu des yeux fermés.', doneMin: 65, again: true,
    },
  },
  {
    ...base, id: 'bot-sarah', firstName: 'Sarah', gender: 'femme', seeking: ['homme'], birthdate: '1990-02-08',
    height: 165, build: 'Sportive', hairColor: 'Blonds', hairLength: 'Mi-longs', eyes: 'Bleus', style: ['Sportswear', 'Casual'],
    distinctive: 'Un bonnet, même en été', values: ['Aventure', 'Indépendance', 'Honnêteté'],
    interests: ['Randonnée', 'Mer & plage', 'Sport', 'Voyages'], ambitions: ['Voyager longtemps', 'Avoir du temps pour moi'],
    traits: { social: 4, tempo: 5, plan: 1, talk: 3 }, intent: 'leger', kids: 'peutetre', job: 'Infirmière',
    portrait: { first: 'impossible à tenir en place plus de deux heures', people: 'dit ce qu’elle pense, mais toujours avec le sourire', unforgivable: 'qu’on annule à la dernière minute' },
    phone: '06 21 43 65 87',
    script: {
      place: { leave: true },
      phrase: 'J’ai dormi dans plus de trains que d’hôtels. Je te raconterai le pire.',
      bet: 'Il va me proposer de marcher plutôt que de s’asseoir.', doneMin: 50, again: false,
    },
  },
  {
    ...base, id: 'bot-thomas', firstName: 'Thomas', gender: 'homme', seeking: ['femme'], birthdate: '1988-08-19',
    height: 188, build: 'Élancée', hairColor: 'Châtains', hairLength: 'Courts', eyes: 'Gris', style: ['Workwear', 'Classique'],
    distinctive: 'Une barbe de trois jours et un sac en cuir', values: ['Calme', 'Loyauté', 'Famille'],
    interests: ['Cinéma', 'Lecture', 'Jeux de société', 'Cuisine'], ambitions: ['Acheter un lieu à moi', 'Fonder une famille'],
    traits: { social: 2, tempo: 2, plan: 4, talk: 2 }, intent: 'serieux', kids: 'veux', job: 'Prof d’histoire',
    portrait: { first: 'discret, jusqu’à ce qu’on parle de cinéma', people: 'se souvient de l’anniversaire de tout le monde', unforgivable: 'les gens qui parlent pendant les films' },
    phone: '06 10 20 30 40',
    script: {
      place: { leave: true },
      phrase: 'J’ai vu le même film quarante fois. Je ne te dirai pas lequel avant le troisième jeu.',
      bet: 'Elle va deviner mon mensonge du premier coup.', doneMin: 95, again: true,
    },
  },
  {
    ...base, id: 'bot-lea', firstName: 'Léa', gender: 'femme', seeking: ['femme', 'nonbinaire'], birthdate: '1995-05-27',
    height: 170, build: 'Moyenne', hairColor: 'Roux', hairLength: 'Courts', eyes: 'Verts', style: ['Minimaliste', 'Créatif'],
    distinctive: 'Des taches de rousseur et un trench beige', values: ['Gentillesse', 'Curiosité', 'Engagement'],
    interests: ['Lecture', 'Méditation / yoga', 'Art & expos', 'Animaux'], ambitions: ['M’engager pour une cause', 'Créer (art, musique, écriture…)'],
    traits: { social: 2, tempo: 2, plan: 3, talk: 2 }, intent: 'serieux', kids: 'peutetre', job: 'Libraire',
    portrait: { first: 'douce, mais avec un avis sur tout', people: 'offre des livres au lieu de donner des conseils', unforgivable: 'la cruauté gratuite' },
    phone: '07 98 87 76 65',
    script: {
      place: { leave: true },
      phrase: 'Je finis toujours les livres que je commence. Même les mauvais. Surtout les mauvais.',
      bet: 'Elle va me poser une question sur mes taches de rousseur.', doneMin: 60, again: true,
    },
  },
  {
    ...base, id: 'bot-nadia', firstName: 'Nadia', gender: 'femme', seeking: ['homme', 'nonbinaire'], birthdate: '1992-12-01',
    height: 163, build: 'Ronde', hairColor: 'Bruns', hairLength: 'Tressés / locks', eyes: 'Marron', style: ['Chic', 'Créatif'],
    distinctive: 'Des grandes boucles d’oreilles dorées', values: ['Ambition', 'Famille', 'Humour'],
    interests: ['Mode', 'Danse', 'Food & restos', 'Fête'], ambitions: ['Monter ma boîte', 'Évoluer dans mon métier'],
    traits: { social: 5, tempo: 4, plan: 4, talk: 4 }, intent: 'serieux', kids: 'veux', job: 'Avocate',
    portrait: { first: 'celle qu’on entend rire avant de la voir', people: 'défend ses amis comme si c’étaient des clients', unforgivable: 'la mauvaise foi' },
    phone: '06 33 22 11 00',
    script: {
      place: { leave: true },
      phrase: 'Je gagne presque toujours les débats. Je perds presque toujours au pierre-feuille-ciseaux.',
      bet: 'Il va perdre au pierre-feuille-ciseaux, et contester.', doneMin: 45, again: true,
    },
  },
  {
    ...base, id: 'bot-hugo', firstName: 'Hugo', gender: 'homme', seeking: ['homme'], birthdate: '1994-03-15',
    height: 179, build: 'Sportive', hairColor: 'Blonds', hairLength: 'Mi-longs', eyes: 'Bleus', style: ['Casual', 'Vintage'],
    distinctive: 'Un vieux Polaroid autour du cou', values: ['Aventure', 'Humour', 'Liberté'],
    interests: ['Photo', 'Voyages', 'Musique live', 'Mer & plage'], ambitions: ['Changer de vie', 'Voyager longtemps'],
    traits: { social: 4, tempo: 3, plan: 2, talk: 3 }, intent: 'voir', kids: 'non', job: 'Photographe',
    portrait: { first: 'souriant, même sous la pluie', people: 'se souvient des visages mieux que des prénoms', unforgivable: 'qu’on ne dise pas merci' },
    phone: '07 12 12 12 12',
    script: {
      place: { leave: true },
      phrase: 'Je prends une seule photo par soirée. Une seule. On verra si tu es dessus.',
      bet: 'Il va me demander pourquoi j’ai un Polaroid avant même de dire bonjour.', doneMin: 70, again: true,
    },
  },
];
