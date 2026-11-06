// Chaque carte du date. Les textes suivent les maquettes ; seuls les prénoms, jours, lieux
// et accords (il / elle) sont calculés.
import { forms } from '../content.js';
import { autocomplete, searchAddress, searchPlace } from '../geo.js';
import { gamePoints, objectiveFor, partnerOf, resolvePlace, scoreBoard, starterOf } from '../date-logic.js';
import { arrivals, at, canArrive, clock, endedOf, isDuringDate, moments, startOf } from '../timeline.js';
import { button, card, confirmSheet, dayLabel, h, hourLabel, icon, relDay, sheet, status, toast, weekday } from '../ui.js';

const ORD = ['Premier', 'Deuxième', 'Troisième', 'Quatrième'];

// Titres courts pour le fil.
export const TILE = {
  invite: (c) => ({ e: 'Quelqu’un a pensé à toi', t: c.partner?.firstName || '…' }),
  cadrage: (c) => ({ e: 'C’est calé', t: `${weekday(c.date.dateAt, true)}, 20h` }),
  tonTour: () => ({ e: 'Et si on en apprenait plus ?', t: 'À ton tour' }),
  phrase: () => ({ e: 'Ce qu’on a écrit pour toi', t: 'Dans ses mots' }),
  lieu: (c) => ({ e: 'Le lieu est fixé', t: place(c).title || place(c).name }),
  regles: () => ({ e: 'Avant ce soir', t: 'Les règles' }),
  objectif: (c) => ({ e: 'Personne d’autre ne le sait', t: objectiveFor(c.date, c.uid, c.partner?.gender).title }),
  discussion: () => ({ e: 'Juste pour se trouver', t: 'La discussion' }),
  start: () => ({ e: 'Vous êtes là', t: 'Le date commence' }),
  jeu1: (c) => ({ e: 'Premier jeu', t: c.games[0].title }),
  jeu2: (c) => ({ e: 'Deuxième jeu', t: c.games[1].title }),
  jeu3: (c) => ({ e: 'Troisième jeu', t: c.games[2].title }),
  jeu4: (c) => ({ e: 'Quatrième jeu', t: c.games[3].title }),
  pari: () => ({ e: 'On rouvre', t: 'Son pari' }),
  reveal: () => ({ e: 'On révèle', t: 'Les objectifs' }),
  score: (c) => ({ e: 'Les points', t: winnerLine(c) }),
  fin: () => ({ e: 'Le date est terminé', t: 'Fin du date' }),
  apres: () => ({ e: 'Le lendemain', t: 'Et maintenant ?' }),
  verdict: (c) => (both(c, 'again') ? { e: 'C’est réciproque', t: 'On se revoit' } : { e: 'Merci pour la soirée', t: 'Chacun son chemin' }),
};

// Une carte attend-elle une action de ma part ?
export function needsAction(key, c) {
  const mine = c.date.answers?.[c.uid] || {};
  const g = /^jeu(\d)$/.exec(key);
  if (g) return mine[`g${g[1]}`] === undefined;
  return ({
    invite: mine.accept === undefined,
    cadrage: !mine.confirm,
    tonTour: mine.about === undefined && mine.phrase === undefined,
    lieu: mine.bet === undefined || mine.lookout === undefined,
    regles: !mine.rules,
    objectif: !mine.objectiveSeen,
    pari: mine.betVerdict === undefined && !!theirs(c).bet,
    reveal: mine.guessed === undefined,
    apres: mine.again === undefined,
  })[key] || false;
}

const mineA = (c) => c.date.answers?.[c.uid] || {};
const theirs = (c) => c.date.answers?.[partnerOf(c.date, c.uid)] || {};
const both = (c, k) => mineA(c)[k] === true && theirs(c)[k] === true;
const place = (c) => resolvePlace(c.date, c.me.city);
const pf = (c) => forms(c.partner?.gender);
const me = (c) => forms(c.me.gender);
const dateMeta = (c) => `${dayLabel(c.date.dateAt)}  ·  20h`;
const firstGameAt = (c) => moments(c.date, c.uid).find((m) => m.key === 'jeu1')?.at || startOf(c.date);

async function act(c, key, value, msg) {
  await c.store.answer(key, value);
  if (msg) toast(msg);
  await c.refresh();
}

// ---------- Arrivée (« Je suis là ») ----------
// Bloc réutilisé dans l'accueil, l'onglet Rendez-vous et la carte Discussion.
export function arriveBox(c, { compact } = {}) {
  if (!canArrive(c.date, c.now) && arrivals(c.date)[c.uid] == null) return null;
  const name = c.partner?.firstName || 'Ton date';
  const r = arrivals(c.date);
  const mine = r[c.uid];
  const their = r[partnerOf(c.date, c.uid)];
  const jeu1 = firstGameAt(c);
  let line;
  let action = null;
  if (mine != null && their != null) line = [h('strong', {}, 'Vous êtes là tous les deux.'), ` Premier jeu à ${hourLabel(jeu1)}.`];
  else if (mine != null) line = [h('strong', {}, 'Tu es là.'), ` J’attends ${name}. Les jeux commencent 30 min après vos deux arrivées.`];
  else {
    line = their != null ? [h('strong', {}, `${name} est déjà là.`), ' Appuie dès que tu arrives.'] : 'En arrivant au rendez-vous, appuie ici : les jeux commencent 30 min après vos deux arrivées.';
    action = button(`Je suis arrivé${me(c).e}`, () => act(c, 'arrived', clock.now(), `C’est noté. ${their != null ? 'Le date commence !' : `Je préviens ${name}.`}`), 'btn arrive-btn');
  }
  return h('section', { class: `arrive${mine != null ? ' here' : ''}${compact ? ' compact' : ''}` },
    h('div', { class: 'arrive-dots' },
      h('span', { class: mine != null ? 'on' : '' }, 'Toi'),
      h('i'),
      h('span', { class: their != null ? 'on' : '' }, name)),
    h('p', {}, line),
    action);
}

// ---------- Mettre fin au date (à tout moment) ----------
export function endDateSheet(c) {
  const name = c.partner?.firstName || 'l’autre personne';
  let note = '';
  sheet((close) => [
    h('h3', {}, 'Mettre fin au date ?'),
    h('p', { class: 'sub' }, `Tu peux partir à tout moment, sans te justifier. ${name} sera prévenu·e tout de suite, et le date s’arrête pour vous deux.`),
    h('div', { class: 'field' }, h('label', {}, `Un mot pour ${name} (facultatif)`),
      h('textarea', { class: 'input', maxlength: 400, placeholder: 'Merci pour ce moment, mais je préfère m’arrêter là.', oninput: (e) => { note = e.target.value; } })),
    button('Mettre fin au date', async () => {
      await c.store.answer('ended', { at: clock.now(), note: note.trim() || null });
      close();
      toast('Le date est terminé. Prends soin de toi.');
      await c.nextMatch({ quiet: true });
    }, 'btn danger'),
    button('Je reste', close, 'link'),
    h('div', { class: 'section-label' }, 'Tu ne te sens pas en sécurité ?'),
    h('div', { class: 'btn-row' },
      h('a', { class: 'btn quiet', href: 'tel:17', style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' } }, 'Police · 17'),
      h('a', { class: 'btn quiet', href: 'tel:112', style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' } }, 'Urgences · 112')),
    h('p', { class: 'small', style: { marginTop: '12px' } }, 'Par SMS : 114. Violences : 3919 (gratuit, anonyme). Tu pourras aussi signaler depuis le menu.'),
  ]);
}

// ---------- Les cartes ----------
export const CARDS = {
  invite(c) {
    const P = pf(c);
    const m = mineA(c);
    const t = theirs(c);
    const veille = weekday(at(c.date.dateAt, -1, 20));
    let actions;
    const expired = t.accept === undefined && c.now > Math.max(c.date.createdAt + 36 * 3600e3, at(c.date.dateAt, -2, 12));
    if (expired && m.accept !== false) {
      actions = [status(`${P.Il} n’a pas répondu à temps. Ça arrive.`, 'clock'),
        h('div', { style: { height: '14px' } }), button('Chercher quelqu’un d’autre', () => c.nextMatch())];
    } else if (t.accept === false) {
      actions = [status(`Pas cette fois pour ${P.lui}. Ce n’est pas toi : c’est le moment.`, 'info'),
        h('div', { style: { height: '14px' } }), button('Chercher quelqu’un d’autre', () => c.nextMatch())];
    } else if (m.accept === true) {
      actions = status(t.accept ? 'Vous avez dit oui tous les deux.' : 'Tu as dit oui. J’attends sa réponse.', t.accept ? 'check' : 'hourglass');
    } else {
      actions = [
        button('J’y vais', () => act(c, 'accept', true, 'C’est noté.')),
        button('Pas cette fois', async () => {
          const ok = await confirmSheet({ title: 'Pas cette fois ?', sub: `${c.partner.firstName} ne saura pas pourquoi. Je te chercherai quelqu’un d’autre.`, yes: 'Oui, pas cette fois', no: 'Finalement, j’y vais' });
          if (ok) { await c.store.answer('accept', false); await c.nextMatch(); }
        }, 'link'),
      ];
    }
    return card({
      eyebrow: 'Quelqu’un a pensé à toi',
      title: c.partner.firstName,
      meta: dateMeta(c),
      body: [c.portrait],
      items: ['Pas de photo, pas de nom', `Le lieu se révèle ${veille}`, 'Quatre jeux dans la soirée, avec des points', 'Un objectif secret, rien qu’à toi'],
      actions,
    });
  },

  cadrage(c) {
    const P = pf(c);
    const M = me(c);
    const veille = weekday(at(c.date.dateAt, -1, 20));
    const tonTour = moments(c.date, c.uid).find((x) => x.key === 'tonTour').at;
    const when = relDay(tonTour, c.now);
    return card({
      eyebrow: 'C’est calé',
      title: `${weekday(c.date.dateAt, true)}, 20h`,
      meta: 'L’heure, je ne la négocie pas',
      body: [`Tu ne sauras ni à quoi ${P.il} ressemble, ni où vous allez, avant ${veille} 20h.`],
      items: [
        'Quatre jeux dans la soirée, avec des points à gagner',
        `Un objectif secret ${P.qu} ne connaîtra pas`,
        `Les règles, ${weekday(c.date.dateAt)} matin, avant le reste`,
        `${cap(when)}, on reparle du lieu`,
      ],
      actionsFirst: true,
      foot: mineA(c).confirm ? null : 'Réponds-moi',
      actions: mineA(c).confirm
        ? status(`Partant${M.e}. On se reparle ${when}.`)
        : button(`Tu es toujours partant${M.e} ?`, () => act(c, 'confirm', true, 'Parfait.')),
    });
  },

  tonTour(c) {
    const P = pf(c);
    const m = mineA(c);
    const dl = moments(c.date, c.uid).find((x) => x.key === 'tonTour').deadline;
    const answered = m.about !== undefined || m.phrase !== undefined;
    return card({
      eyebrow: 'Et si on en apprenait plus ?',
      title: 'À ton tour',
      meta: `Réponse attendue avant ${relDay(dl, c.now)} ${dl > c.now ? (new Date(dl).getHours() === 12 ? 'midi' : hourLabel(dl)) : ''}`.trim(),
      body: [
        `Où vous allez ${weekday(c.date.dateAt)}. Un seul endroit, public, où on peut s’entendre parler.`,
        `Et quelques mots sur toi, ${P.qu} lira ${relDay(dl, c.now) === 'demain' ? 'demain' : 'bientôt'}.`,
      ],
      items: [
        'Un seul endroit, tu peux aussi lui laisser le choix',
        'Ni ton métier, ni ton âge, ni ce que tu cherches',
        'Quelque chose que tu aimes',
        'Ce qu’on dit de toi',
        'Une chose que tu détestes',
        'Ce que tu as envie de dire de toi, librement',
      ],
      sections: answered ? [{ label: 'Ce que tu as envoyé', text: h('div', {},
        h('p', { class: 'small' }, m.place?.leave ? 'Lieu : tu lui laisses le choix.' : `Lieu : ${m.place?.name}, ${m.place?.address}`),
        aboutView(m, 'toi')) }] : [],
      foot: answered ? null : 'Je ne corrigerai rien.',
      actions: answered
        ? status('C’est envoyé. Je ne corrigerai rien.')
        : (dl > c.now ? button('Je réponds', () => tonTourForm(c)) : status('Trop tard pour celle-ci. Je m’occupe du lieu.', 'clock')),
    });
  },

  phrase(c) {
    const P = pf(c);
    const t = theirs(c);
    const lieu = moments(c.date, c.uid).find((x) => x.key === 'lieu').at;
    const has = t.about || t.phrase;
    return card({
      eyebrow: `Ce ${P.qu} a écrit sur ${P.lui}`,
      title: 'Dans ses mots',
      meta: c.partner.firstName,
      body: has ? null : [`${P.Il} n’a rien écrit. ${P.Il} préfère que tu le découvres en face.`],
      extra: has ? aboutView(t, P) : null,
      foot: `Le lieu, ${relDay(lieu, c.now)} ${hourLabel(lieu)}.`,
    });
  },

  lieu(c) {
    const P = pf(c);
    const pl = place(c);
    const m = mineA(c);
    const t = theirs(c);
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${pl.name}, ${pl.address}`)}`;
    const body = [`Vous vous retrouvez devant ${pl.name}.`];
    if (pl.after) body.push(pl.after);
    const mineP = m.place;
    const theirP = t.place;
    const duel = mineP?.name && !mineP.leave && theirP?.name && !theirP.leave;
    if (duel) maybeDuel(c, mineP, theirP, pl.by === c.uid);
    const todo = m.bet === undefined || m.lookout === undefined;
    return card({
      eyebrow: 'Le lieu est fixé',
      title: pl.title || pl.name,
      meta: dateMeta(c),
      body,
      items: [`20h, devant ${pl.name}${pl.address ? ' — ' + pl.address : ''}`, 'La discussion s’ouvre à 19h, juste pour se trouver', pl.tip],
      extra: [
        h('div', { class: 'btn-row', style: { marginTop: '16px' } },
          button('Voir la carte', () => c.goTab?.('rdv'), 'btn quiet'),
          h('a', { class: 'btn quiet', href: maps, target: '_blank', rel: 'noopener', style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' } }, 'Itinéraire ↗')),
        duel && h('button', { type: 'button', class: 'link', style: { textAlign: 'left', margin: '0', padding: '6px 0' }, onclick: () => placeDuel(mineP, theirP, pl.by === c.uid, c) },
          `Tiré au sort entre ${mineP.name} et ${theirP.name} · revoir le tirage`),
      ],
      sections: [
        { label: `Pour ${P.le} reconnaître`, text: t.lookout ? h('blockquote', { class: 'quote small-quote' }, `« ${t.lookout} »`) : h('p', { class: 'small' }, `${P.Il} n’a pas encore écrit son petit mot. Il arrive avant le rendez-vous.`) },
        { label: 'Pour te reconnaître', italic: !!m.lookout, text: m.lookout ? `« ${m.lookout} »` : 'Un petit mot pour qu’on te reconnaisse : un accessoire, une couleur, où tu seras…' },
        { label: 'Ton pari', italic: true, text: m.bet ? `« ${m.bet} »` : `D’après ce que tu sais de ${P.lui}, si tu devais parier quelque chose sur ${P.lui}, tu dirais quoi ? S’il est juste, 2 points pour toi.` },
      ],
      actions: todo ? button(m.bet === undefined && m.lookout === undefined ? 'Je réponds' : m.bet === undefined ? 'J’écris mon pari' : 'J’écris mon petit mot', () => prepForm(c))
        : status(`C’est noté. On rouvre ${weekday(c.date.dateAt)} soir.`),
    });
  },

  regles(c) {
    const pl = place(c);
    return card({
      eyebrow: 'Avant ce soir',
      title: 'Les règles',
      meta: `Ce soir 20h  ·  Devant ${pl.name}${pl.address ? ', ' + pl.address : ''}`,
      body: ['Rien à retenir par cœur. Elles sont là pour que la soirée ne ressemble pas à un entretien d’embauche.'],
      items: [
        'En arrivant, appuie sur « Je suis arrivé·e » : les jeux commencent 30 min après vos deux arrivées',
        'On n’utilise pas son téléphone, sauf pour mes messages',
        'On n’évoque pas sa vie professionnelle avant le troisième jeu',
        'Chaque jeu rapporte des points : le gagnant est révélé à la fin',
        'Tout choix qui prend plus de quelques secondes se tranche au pierre-feuille-ciseaux',
        'Chacun peut mettre fin au date à tout moment, sans se justifier',
      ],
      actions: mineA(c).rules ? status('C’est noté.') : button('C’est noté', () => act(c, 'rules', true)),
      foot: 'Quoi qu’il arrive, tu m’écris. Je m’occupe du reste.',
    });
  },

  objectif(c) {
    const P = pf(c);
    const o = objectiveFor(c.date, c.uid, c.partner?.gender);
    const m = mineA(c);
    let actions;
    if (m.done) actions = status(`Fait à ${hourLabel(m.done)}. Bien joué.`);
    else if (isDuringDate(c.date, c.now) && m.objectiveSeen) actions = button('Fait', () => markDone(c));
    else if (m.objectiveSeen) actions = status('C’est noté. Le bouton « Fait » s’active ce soir.', 'clock');
    else actions = button('C’est noté', () => act(c, 'objectiveSeen', true));
    return card({
      eyebrow: 'Personne d’autre ne le sait',
      title: o.title,
      meta: 'Ton objectif de la soirée',
      body: [`${o.text} ${P.Il} a le sien, et tu ne l’apprendras qu’à la fin.`],
      extra: h('div', { class: 'secret-rule' }, h('strong', {}, `SOIS DISCRET${me(c).e === 'e' ? 'E' : me(c).e ? '·E' : ''}.`), ` Si ${P.il} devine ton objectif avant la fin du date, tu ne gagnes aucun point.`),
      items: [
        'Interdit de poser la question frontalement',
        'Interdit de mimer ou de l’écrire',
        'Le premier des deux à réussir son objectif gagne 3 points, le second 1 point',
        'Appuie sur « Fait » au moment où ça arrive',
      ],
      actions,
      foot: 'On révèle à la fin de la soirée.',
    });
  },

  discussion(c) {
    const P = pf(c);
    const pl = place(c);
    return card({
      eyebrow: 'Juste pour se trouver',
      title: 'La discussion',
      meta: `Ouverte avec ${c.partner.firstName}`,
      body: ['Vous pouvez vous écrire à partir de maintenant. Juste ce qu’il faut pour se trouver : on se voit dans une heure.'],
      items: ['Texte uniquement, pas de photo', `20h, devant ${pl.name}`, `${P.Il} attend peut-être déjà ton message`],
      extra: arriveBox(c, { compact: true }),
      actions: button('Ouvrir la discussion', () => c.goTab?.('thread')),
      foot: 'Ensuite, téléphone dans la poche.',
    });
  },

  start(c) {
    const jeu1 = firstGameAt(c);
    return card({
      eyebrow: 'Vous êtes là',
      title: 'Le date commence',
      meta: `Premier jeu à ${hourLabel(jeu1)}`,
      body: ['Vous êtes arrivés tous les deux. Prenez le temps de vous installer : je vous envoie le premier jeu dans 30 minutes.'],
      items: [
        'Téléphone dans la poche, sauf pour mes messages',
        'Après chaque jeu, chacun note son résultat : les points se comptent tout seuls',
        'Ton objectif secret rapporte 3 points si tu le réussis en premier',
        'Tu peux mettre fin au date à tout moment, sans te justifier',
      ],
      extra: scoreChip(c),
    });
  },

  jeu1: (c) => game(c, 0),
  jeu2: (c) => game(c, 1),
  jeu3: (c) => game(c, 2),
  jeu4: (c) => game(c, 3),

  pari(c) {
    const P = pf(c);
    const t = theirs(c);
    const m = mineA(c);
    const lieuAt = moments(c.date, c.uid).find((x) => x.key === 'lieu').at;
    const sections = [];
    if (m.bet) {
      sections.push({ label: 'Et ton pari', text: h('div', {},
        h('div', { class: 'italic' }, `« ${m.bet} »`),
        h('p', { class: 'small', style: { marginTop: '10px' } },
          t.betVerdict === undefined ? `${P.Il} n’a pas encore tranché.` : t.betVerdict ? `${P.Il} dit que tu as vu juste : +2 points pour toi.` : `${P.Il} dit que non. Raté, cette fois.`)) });
    }
    return card({
      eyebrow: 'On rouvre',
      title: 'Son pari',
      meta: `${c.partner.firstName}, ${relDay(lieuAt, c.now)} soir`,
      quote: t.bet || null,
      body: t.bet ? null : [`${P.Il} n’a pas parié.`],
      sections,
      before: t.bet && h('p', { style: { color: 'var(--ink-2)', margin: '0 0 6px' } }, `Lis-le à voix haute. S’il est juste, ${P.il} gagne 2 points.`),
      foot: t.bet && m.betVerdict === undefined ? 'C’est toi qui tranches.' : null,
      actions: !t.bet ? null : m.betVerdict !== undefined
        ? status(m.betVerdict ? `Tu as tranché : ${P.il} a vu juste.` : `Tu as tranché : ${P.il} s’est trompé${P.e}.`)
        : [button(`${P.Il} a vu juste ?`, () => verdictSheet(c))],
    });
  },

  reveal(c) {
    const P = pf(c);
    const m = mineA(c);
    const t = theirs(c);
    const mine = objectiveFor(c.date, c.uid, c.partner?.gender);
    const other = partnerOf(c.date, c.uid);
    const theirsO = objectiveFor(c.date, other, c.me.gender);
    const line = (ts) => (ts ? `Atteint à ${hourLabel(ts)}` : 'Pas atteint');
    let actions;
    if (m.guessed === undefined) {
      actions = [
        h('p', { class: 'q-label' }, `Avais-tu deviné son objectif avant la révélation ?`),
        h('div', { class: 'btn-row' },
          button('Oui, je l’avais deviné', () => act(c, 'guessed', true, `Ses points d’objectif sautent.`), 'btn quiet'),
          button('Non', () => act(c, 'guessed', false), 'btn quiet')),
      ];
    } else if (t.guessed === undefined) actions = status(`J’attends que ${c.partner.firstName} réponde, puis je compte les points.`, 'hourglass');
    else actions = button('Voir le gagnant', () => c.openCard?.('score'));
    return card({
      eyebrow: 'On révèle',
      title: 'Les objectifs',
      meta: 'Personne d’autre ne le savait',
      sections: [
        { rule: false, label: 'Le tien', text: h('div', {}, h('div', { class: 'italic' }, mine.text), h('p', { class: 'small', style: { marginTop: '8px' } }, line(m.done))) },
        { label: 'Le sien', text: h('div', {}, h('div', { class: 'italic' }, theirsO.text), h('p', { class: 'small', style: { marginTop: '8px' } }, line(t.done))) },
        c.partner.job && { label: 'Et son métier', text: h('div', { class: 'body' }, h('p', {}, c.partner.job)) },
      ].filter(Boolean),
      actions,
      foot: m.guessed === undefined ? `Sois honnête : si tu l’avais deviné, ${P.il} ne gagne pas les points de son objectif.` : 'Demain matin, une dernière question.',
    });
  },

  score(c) {
    const board = scoreBoard(c.date, c.games);
    const other = partnerOf(c.date, c.uid);
    maybeWinner(c, board);
    return card({
      eyebrow: 'Les points',
      title: winnerLine(c, board),
      meta: `${board.total[c.uid]} pour toi · ${board.total[other]} pour ${c.partner.firstName}`,
      extra: h('div', { class: 'board' },
        h('div', { class: 'board-row head' }, h('span'), h('span', {}, 'Toi'), h('span', {}, c.partner.firstName)),
        board.lines.map((l) => h('div', { class: 'board-row' }, h('span', {}, l.label), h('span', {}, String(l.pts[c.uid] || 0)), h('span', {}, String(l.pts[other] || 0)))),
        h('div', { class: 'board-row total' }, h('span', {}, 'Total'), h('span', {}, String(board.total[c.uid])), h('span', {}, String(board.total[other])))),
      actions: button('Revoir l’annonce', () => winnerShow(c, board), 'btn quiet'),
      foot: 'Demain matin, une dernière question.',
    });
  },

  fin(c) {
    const P = pf(c);
    const end = endedOf(c.date);
    return card({
      eyebrow: 'Le date est terminé',
      title: 'Fin du date',
      meta: `${c.partner.firstName} y a mis fin${end?.at ? ` à ${hourLabel(end.at)}` : ''}`,
      body: [`${c.partner.firstName} a choisi d’arrêter là. C’est son droit, et ça ne dit rien de toi. Prends soin de toi.`],
      sections: end?.note ? [{ label: `Son mot pour toi`, italic: true, text: `« ${end.note} »` }] : [],
      actions: button('Chercher quelqu’un d’autre', () => c.nextMatch({ quiet: true })),
      foot: `${P.Il} ne pourra plus t’écrire.`,
    });
  },

  apres(c) {
    const P = pf(c);
    const m = mineA(c);
    return card({
      eyebrow: 'Le lendemain',
      title: 'Et maintenant ?',
      meta: 'Rien ne part sans vous deux',
      body: [`Dis-moi si tu veux ${P.le} revoir. Si ce n’est pas réciproque, chacun laisse un mot à l’autre : un mot gentil, ou ce qui n’a pas collé.`],
      actions: m.again !== undefined
        ? status(`C’est noté. Je te dis dès ${P.qu} a répondu.`, 'hourglass')
        : [button(`Je veux ${P.le} revoir`, () => act(c, 'again', true)), button('On en reste là', () => noteSheet(c), 'link')],
    });
  },

  verdict(c) {
    const P = pf(c);
    const t = theirs(c);
    if (both(c, 'again')) {
      return card({
        eyebrow: 'C’est réciproque',
        title: 'On se revoit',
        meta: `${c.partner.firstName} aussi`,
        body: ['Vous avez tous les deux envie de vous revoir. À partir de maintenant, je vous laisse faire : la discussion reste ouverte encore deux jours, échangez-y ce que vous voulez.'],
        actions: [button('Aller à la discussion', () => c.goTab?.('thread')), button('Terminer ce date', () => c.nextMatch({ quiet: true }), 'link')],
        foot: 'Ça m’a fait plaisir.',
      });
    }
    return card({
      eyebrow: 'Merci pour la soirée',
      title: 'Chacun son chemin',
      body: ['Ce n’était pas réciproque cette fois. Ce n’est pas un échec : c’est une soirée de plus où tu as joué le jeu.'],
      sections: t.note ? [{ label: `Le mot de ${c.partner.firstName}`, italic: true, text: `« ${t.note} »` }] : [],
      actions: button('Chercher quelqu’un d’autre', () => c.nextMatch({ quiet: true })),
      foot: mineA(c).note ? `${P.Il} a reçu ton mot.` : null,
    });
  },
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// « Ce que tu aimes / ce qu'on dit de toi / ce que tu détestes / librement »
function aboutView(a, P) {
  if (!a.about) return a.phrase ? h('blockquote', { class: 'quote' }, `« ${a.phrase} »`) : null;
  const self = P === 'toi';
  const rows = [
    [self ? 'Tu aimes' : `${P.Il} aime`, a.about.likes],
    [self ? 'On dit de toi' : P.lui === 'lui' ? 'On dit de lui' : `On dit d’${P.lui}`, a.about.said],
    [self ? 'Tu détestes' : `${P.Il} déteste`, a.about.hates],
    [self ? 'Et librement' : `Et ce qu’${P.il} a envie de dire`, a.about.free],
  ].filter(([, v]) => v);
  return h('div', { class: 'about' }, rows.map(([k, v]) => h('div', { class: 'about-row' }, h('div', { class: 'about-k' }, k), h('div', { class: 'about-v' }, v))));
}

// ---------- Jeux ----------
function scoreChip(c) {
  const board = scoreBoard(c.date, c.games);
  const other = partnerOf(c.date, c.uid);
  return h('div', { class: 'score-chip' },
    h('span', {}, 'Score'),
    h('strong', {}, `Toi ${board.total[c.uid]}`), h('i', {}, '–'), h('strong', {}, `${board.total[other]} ${c.partner?.firstName || ''}`));
}

function winnerLine(c, board = scoreBoard(c.date, c.games)) {
  const other = partnerOf(c.date, c.uid);
  const a = board.total[c.uid];
  const b = board.total[other];
  if (a === b) return 'Égalité !';
  return a > b ? 'Tu as gagné !' : `${c.partner?.firstName || 'L’autre'} a gagné`;
}

function game(c, idx) {
  const g = c.games[idx];
  const P = pf(c);
  const key = `g${g.slot}`;
  const m = mineA(c)[key];
  const t = theirs(c)[key];
  const extra = [];
  if (g.starter) {
    const who = starterOf(c.date, g);
    const mineStart = who === c.uid;
    const name = mineStart ? 'toi' : c.partner.firstName;
    maybeStarter(c, g);
    extra.push(h('div', { class: 'starter' },
      h('div', { class: 'starter-k' }, 'Tirage au sort'),
      h('div', { class: 'starter-v' }, mineStart ? 'C’est toi qui commences' : `C’est ${name} qui commence`),
      g.eyes && h('div', { class: 'eyes-now' }, mineStart ? 'FERME LES YEUX MAINTENANT.' : `${c.partner.firstName.toUpperCase()}, FERME LES YEUX MAINTENANT.`),
      h('button', { type: 'button', class: 'link', style: { margin: '4px 0 0', padding: '4px 0' }, onclick: () => starterDraw(c, g) }, 'Revoir le tirage')));
  }
  if (idx === 2) extra.push(h('p', { class: 'small', style: { marginTop: '6px' } }, 'À partir de maintenant, vous pouvez parler boulot.'));
  if (g.timer) extra.push(button(`Lancer le chrono · ${g.timer} s`, () => timerSheet(g.timer, g.title), 'btn ghost'), h('div', { style: { height: '8px' } }));

  // Résultat déclaré par chacun : les points se calculent tout seuls.
  const pts = gamePoints(c.date, g);
  const other = partnerOf(c.date, c.uid);
  const save = (v) => act(c, key, v, 'Noté.');
  let result;
  if (m !== undefined) {
    const mineTxt = g.type === 'count' ? `${m.n} ${g.id === 'communs' ? 'en commun' : g.id === 'motinterdit' ? 'fois' : `bonne${m.n > 1 ? 's' : ''} réponse${m.n > 1 ? 's' : ''}`}` : (m.ok ? g.yes : g.no);
    result = h('div', { class: 'result' },
      status(`Noté : ${mineTxt}.`),
      t !== undefined
        ? h('p', { class: 'small', style: { textAlign: 'center', margin: '10px 0 0' } }, `Ce jeu : +${pts[c.uid]} pour toi, +${pts[other]} pour ${c.partner.firstName}.`)
        : h('p', { class: 'small', style: { textAlign: 'center', margin: '10px 0 0' } }, `J’attends le résultat de ${c.partner.firstName}.`),
      h('button', { type: 'button', class: 'link', onclick: () => resultSheet(c, g, save) }, 'Corriger'));
  } else {
    result = h('div', { class: 'result' }, h('p', { class: 'q-label' }, g.q), resultControls(g, save));
  }
  return card({
    eyebrow: `${ORD[idx]} jeu · ${g.type === 'count' ? `${g.pts} pt par bonne réponse` : `${g.pts} points`}`,
    title: g.title, meta: g.meta, body: g.body, items: g.items, extra: [...extra, scoreChip(c)],
    actions: result,
    foot: idx < 3 ? 'Prochain jeu dans 30 minutes.' : 'Les paris arrivent juste après.',
  });
}

function resultControls(g, save) {
  if (g.type === 'count') {
    return h('div', { class: 'chips count-chips' }, Array.from({ length: (g.max || 3) + 1 }, (_, n) =>
      button(String(n), () => save({ n }), 'chip')));
  }
  return h('div', { class: 'btn-row' }, button(g.yes || 'Oui', () => save({ ok: true }), 'btn quiet'), button(g.no || 'Non', () => save({ ok: false }), 'btn quiet'));
}

function resultSheet(c, g, save) {
  sheet((close) => [
    h('h3', {}, g.title), h('p', { class: 'sub' }, g.q),
    resultControls(g, async (v) => { close(); await save(v); }),
  ]);
}

function timerSheet(seconds, title) {
  let left = seconds;
  let id;
  const C = 2 * Math.PI * 82;
  const num = h('div', { class: 'num' }, String(left));
  const ring = h('div', { class: 'ring', html: `<svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="82" class="track" stroke="currentColor" stroke-width="5" fill="none"/><circle class="arc" cx="90" cy="90" r="82" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0" style="transition: stroke-dashoffset 1s linear"/></svg>` }, num);
  const msg = h('p', { class: 'sub', style: { textAlign: 'center' } }, 'C’est parti.');
  sheet((close) => {
    id = setInterval(() => {
      left -= 1;
      num.textContent = String(Math.max(0, left));
      ring.querySelector('.arc').setAttribute('stroke-dashoffset', String(C * (1 - left / seconds)));
      if (left <= 0) {
        clearInterval(id);
        msg.textContent = 'Temps écoulé !';
        navigator.vibrate?.([200, 100, 200]);
      }
    }, 1000);
    return [h('h3', { style: { textAlign: 'center' } }, title), h('div', { class: 'timer' }, ring), msg, button('Fermer', close, 'link')];
  }, { onClose: () => clearInterval(id) });
}

// ---------- Tirage « qui commence » (animation) ----------
const once = (k) => { try { if (localStorage.getItem(k)) return false; localStorage.setItem(k, '1'); } catch { /* rien */ } return true; };
const shownNow = new Set();

function maybeStarter(c, g) {
  const k = `cai.starter.${c.date.id}.${g.id}`;
  if (shownNow.has(k)) return;
  shownNow.add(k);
  if (once(k)) setTimeout(() => starterDraw(c, g), 350);
}

export function starterDraw(c, g) {
  const who = starterOf(c.date, g);
  const mineStart = who === c.uid;
  const left = h('div', { class: 'pick' }, 'Toi');
  const right = h('div', { class: 'pick' }, c.partner.firstName);
  const big = h('div', { class: 'draw-big' });
  const go = h('button', { class: 'btn', type: 'button', style: { opacity: 0, pointerEvents: 'none' } }, 'C’est parti');
  const wrap = h('div', { class: 'duel draw', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'duel-inner' },
      h('div', { class: 'eyebrow', style: { alignSelf: 'center' } }, g.title),
      h('h2', { class: 'duel-title' }, 'Qui commence ?'),
      h('div', { class: 'picks' }, left, right),
      big, go));
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 300); };
  go.onclick = close;
  document.body.append(wrap);
  // La surbrillance passe d'un nom à l'autre en ralentissant, puis s'arrête sur le bon.
  const steps = 13 + (mineStart ? 0 : 1);
  let i = 0;
  const tick = () => {
    const onLeft = i % 2 === 0;
    left.classList.toggle('on', onLeft);
    right.classList.toggle('on', !onLeft);
    navigator.vibrate?.(5);
    i++;
    if (i < steps) setTimeout(tick, 70 + i * i * 2.2);
    else {
      (mineStart ? left : right).classList.add('win');
      big.replaceChildren(g.eyes
        ? h('strong', {}, mineStart ? 'C’EST TOI. FERME LES YEUX MAINTENANT.' : `${c.partner.firstName.toUpperCase()}, FERME LES YEUX MAINTENANT.`)
        : h('strong', {}, mineStart ? 'Tu commences !' : `${c.partner.firstName} commence !`));
      navigator.vibrate?.([30, 40, 60]);
      go.style.opacity = 1;
      go.style.pointerEvents = 'auto';
    }
  };
  setTimeout(tick, 250);
}

// ---------- Annonce du gagnant (animation) ----------
function maybeWinner(c, board) {
  const k = `cai.winner.${c.date.id}`;
  if (shownNow.has(k)) return;
  shownNow.add(k);
  if (once(k)) setTimeout(() => winnerShow(c, board), 300);
}

export function winnerShow(c, board = scoreBoard(c.date, c.games)) {
  const other = partnerOf(c.date, c.uid);
  const a = board.total[c.uid];
  const b = board.total[other];
  const nA = h('div', { class: 'win-num' }, '0');
  const nB = h('div', { class: 'win-num' }, '0');
  const colA = h('div', { class: 'win-col' }, h('div', { class: 'win-crown' }, '👑'), nA, h('div', { class: 'win-name' }, 'Toi'));
  const colB = h('div', { class: 'win-col' }, h('div', { class: 'win-crown' }, '👑'), nB, h('div', { class: 'win-name' }, c.partner.firstName));
  const title = h('h2', { class: 'duel-title' }, 'Et le gagnant est…');
  const burst = h('div', { class: 'duel-burst' });
  const go = h('button', { class: 'btn', type: 'button', style: { opacity: 0, pointerEvents: 'none' } }, 'Voir le détail');
  const wrap = h('div', { class: 'duel winner', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'duel-inner' }, h('div', { class: 'eyebrow', style: { alignSelf: 'center' } }, 'Les points sont comptés'), title,
      h('div', { class: 'win-stage' }, burst, colA, h('div', { class: 'win-vs' }, '–'), colB), go));
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 300); };
  go.onclick = close;
  document.body.append(wrap);
  const dur = 1600;
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - (1 - p) ** 3;
    nA.textContent = String(Math.round(a * e));
    nB.textContent = String(Math.round(b * e));
    if (p < 1) { requestAnimationFrame(step); return; }
    title.textContent = a === b ? 'Égalité parfaite !' : a > b ? 'Tu as gagné !' : `${c.partner.firstName} a gagné !`;
    if (a >= b) colA.classList.add('win');
    if (b >= a) colB.classList.add('win');
    navigator.vibrate?.([40, 50, 80]);
    for (let i = 0; i < 30; i++) {
      const ang = (Math.PI * 2 * i) / 30 + Math.random() * 0.3;
      const d = 120 + Math.random() * 130;
      burst.append(h('i', { style: {
        '--x': `${Math.cos(ang) * d}px`, '--y': `${Math.sin(ang) * d}px`, '--r': `${Math.random() * 120 - 60}deg`,
        '--s': (0.6 + Math.random() * 0.9).toFixed(2), animationDelay: `${Math.random() * 150}ms`,
      } }));
    }
    go.style.opacity = 1;
    go.style.pointerEvents = 'auto';
  };
  setTimeout(() => requestAnimationFrame(step), 500);
}

// ---------- Formulaires ----------
function tonTourForm(c) {
  const P = pf(c);
  const st = { leave: false, name: '', address: '', title: '', after: '', tip: '', lat: null, lng: null };
  const ab = { likes: '', said: '', hates: '', free: '' };
  const aboutField = (k, label, ph, long) => h('div', { class: 'field' }, h('label', {}, label),
    h(long ? 'textarea' : 'input', { class: 'input', maxlength: long ? 280 : 120, placeholder: ph, oninput: (e) => { ab[k] = e.target.value; } }));
  sheet((close) => {
    const placeBox = h('div', {});
    const err = h('div', { class: 'error' });
    const input = (key, ph, multiline) => h(multiline ? 'textarea' : 'input', {
      class: 'input', placeholder: ph, maxlength: multiline ? 160 : 90, oninput: (e) => { st[key] = e.target.value; },
    });
    const fieldOf = (label, ...ctl) => h('div', { class: 'field' }, h('label', {}, label), ...ctl);
    // Le lieu : liste déroulante qui se met à jour à chaque lettre, puis carte.
    const found = h('div', { class: 'small', style: { marginTop: '8px' } });
    const showMap = () => { found.textContent = st.lat != null ? 'Adresse trouvée ✓ Elle apparaîtra sur la carte, dans l’onglet Rendez-vous.' : ''; };
    const addr = h('input', { class: 'input', placeholder: 'Ou cherche l’adresse : 202 rue d’Aub…', maxlength: 140, oninput: (e) => { st.address = e.target.value; st.lat = null; st.lng = null; showMap(); } });
    const addrField = autocomplete(addr, {
      search: (q, signal) => searchAddress(q, c.me, signal),
      onPick: (it) => { st.address = it.address; st.lat = it.lat; st.lng = it.lng; showMap(); },
      minChars: 3,
    });
    const nameIn = h('input', { class: 'input', placeholder: 'Un resto, un bar, un parc… (Noccio)', maxlength: 90, oninput: (e) => { st.name = e.target.value; } });
    const nameField = autocomplete(nameIn, {
      search: (q, signal) => searchPlace(q, c.me, signal),
      onPick: (it) => { st.name = it.name; st.address = it.address; st.lat = it.lat; st.lng = it.lng; addr.value = it.address; showMap(); },
    });
    const proposeNodes = [
      fieldOf('Le lieu (public, où on s’entend parler)', nameField),
      fieldOf('L’adresse', addrField, found),
      fieldOf('Et après ? (facultatif)', input('after', 'De là, vous marchez jusqu’au bassin de la Villette.', true)),
      fieldOf('Si ce lieu était un titre (facultatif)', input('title', 'Au bord de l’eau')),
      fieldOf('Un conseil (facultatif)', input('tip', 'Prévois des chaussures adaptées')),
    ];
    const leaveNode = h('p', { class: 'small', style: { margin: '0 0 20px' } }, 'Tu lui laisses le choix. Si vous laissez tous les deux, je choisis pour vous.');
    const renderPlace = () => placeBox.replaceChildren(...(st.leave ? [leaveNode] : proposeNodes));
    const toggle = h('div', { class: 'chips', style: { marginBottom: '18px' } });
    const renderToggle = () => toggle.replaceChildren(
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!st.leave), onclick: () => { st.leave = false; renderToggle(); renderPlace(); } }, 'Je propose un lieu'),
      h('button', { class: 'chip', type: 'button', 'aria-pressed': String(st.leave), onclick: () => { st.leave = true; renderToggle(); renderPlace(); } }, `Je lui laisse le choix`));
    renderToggle(); renderPlace();
    return [
      h('h3', {}, 'À ton tour'),
      h('p', { class: 'sub' }, 'Je ne corrigerai rien. Relis-toi.'),
      h('div', { class: 'section-label', style: { marginTop: 0 } }, 'Le lieu'),
      toggle, placeBox,
      h('div', { class: 'section-label' }, 'Sur toi'),
      h('p', { class: 'small', style: { margin: '-2px 0 14px' } }, 'Ni ton métier, ni ton âge, ni ce que tu cherches.'),
      aboutField('likes', 'Quelque chose que tu aimes', 'Les marchés le dimanche matin'),
      aboutField('said', 'Ce qu’on dit de toi', 'Qu’on ne s’ennuie jamais avec moi'),
      aboutField('hates', 'Une chose que tu détestes', 'Les gens qui marchent lentement sur le trottoir'),
      aboutField('free', 'Ce que tu as envie de dire de toi (libre)', 'Ce que tu veux…', true),
      err,
      button('Envoyer', async () => {
        if (!st.leave && (!st.name.trim() || !st.address.trim())) { err.textContent = 'Le nom du lieu et son adresse, ou laisse-lui le choix.'; return; }
        const about = Object.fromEntries(Object.entries(ab).map(([k, v]) => [k, v.trim()]));
        if (!about.likes || !about.said || !about.hates) { err.textContent = 'Ce que tu aimes, ce qu’on dit de toi et ce que tu détestes : les trois sont nécessaires.'; return; }
        const placeVal = st.leave ? { leave: true } : { name: st.name.trim(), address: st.address.trim(), title: st.title.trim(), after: st.after.trim(), tip: st.tip.trim(), lat: st.lat, lng: st.lng };
        await c.store.answer('place', placeVal);
        await c.store.answer('about', about);
        close();
        toast('Envoyé.');
        await c.refresh();
      }),
    ];
  });
}

// La veille : ton pari sur l'autre, et un petit mot pour qu'on te reconnaisse.
function prepForm(c) {
  const P = pf(c);
  const m = mineA(c);
  let bet = '';
  let look = '';
  sheet((close) => {
    const err = h('div', { class: 'error' });
    return [
      h('h3', {}, 'Avant le rendez-vous'),
      m.lookout === undefined && [
        h('div', { class: 'section-label', style: { marginTop: 0 } }, 'Pour te reconnaître'),
        h('p', { class: 'small', style: { margin: '0 0 10px' } }, `Pas de photo : décris-toi avec un accessoire, une couleur, où tu seras… ${P.Il} le lira avant le rendez-vous.`),
        h('div', { class: 'field' }, h('textarea', { class: 'input', maxlength: 160, placeholder: 'Veste rouge et bonnet noir, je t’attends près de l’entrée.', oninput: (e) => { look = e.target.value; } })),
      ],
      m.bet === undefined && [
        h('div', { class: 'section-label' }, 'Ton pari'),
        h('p', { class: 'small', style: { margin: '0 0 10px' } }, `D’après ce que tu sais de ${P.lui}, si tu devais parier quelque chose sur ${P.lui}, tu dirais quoi ? ${P.Il} le lira le soir même. S’il est juste : 2 points.`),
        h('div', { class: 'field' }, h('textarea', { class: 'input', maxlength: 160, placeholder: `${P.Il} va me dire…`, oninput: (e) => { bet = e.target.value; } })),
      ],
      err,
      button('Envoyer', async () => {
        if (m.lookout === undefined && look.trim().length < 4) { err.textContent = 'Un petit mot pour qu’on te reconnaisse.'; return; }
        if (m.bet === undefined && bet.trim().length < 6) { err.textContent = 'Ton pari : une vraie phrase, s’il te plaît.'; return; }
        if (m.lookout === undefined) await c.store.answer('lookout', look.trim());
        if (m.bet === undefined) await c.store.answer('bet', bet.trim());
        close();
        toast('C’est noté.');
        await c.refresh();
      }),
    ];
  });
}

// « On en reste là » : un mot obligatoire pour l'autre.
function noteSheet(c) {
  const name = c.partner.firstName;
  let v = '';
  sheet((close) => {
    const err = h('div', { class: 'error' });
    const ta = h('textarea', { class: 'input', maxlength: 500, placeholder: `Merci pour la soirée ${name}…`, oninput: (e) => { v = e.target.value; } });
    const pick = (txt) => { ta.value = txt; v = txt; ta.focus(); };
    return [
      h('h3', {}, 'Un mot pour ' + name),
      h('p', { class: 'sub' }, `Avant de vous dire au revoir, laisse-lui un mot : quelque chose de gentil, ou pourquoi ça n’a pas collé. Avec bienveillance.`),
      h('div', { class: 'chips', style: { marginBottom: '12px' } },
        h('button', { type: 'button', class: 'chip', onclick: () => pick(`Merci pour cette soirée ${name}, j’ai passé un bon moment. Je n’ai juste pas ressenti l’étincelle.`) }, 'Un mot gentil'),
        h('button', { type: 'button', class: 'chip', onclick: () => pick('Je t’explique pourquoi, en toute honnêteté : ') }, 'Expliquer pourquoi')),
      h('div', { class: 'field' }, ta),
      err,
      button('Envoyer et en rester là', async () => {
        if (v.trim().length < 15) { err.textContent = 'Quelques mots de plus, s’il te plaît (15 caractères minimum).'; return; }
        await c.store.answer('note', v.trim());
        await c.store.answer('again', false);
        close();
        toast('C’est noté.');
        await c.refresh();
      }),
    ];
  });
}

function verdictSheet(c) {
  const P = pf(c);
  sheet((close) => [
    h('h3', {}, `${P.Il} a vu juste ?`),
    h('p', { class: 'sub' }, 'C’est toi qui tranches.'),
    h('div', { class: 'btn-row' },
      button('Oui', async () => { close(); await act(c, 'betVerdict', true, '+2 points pour son pari.'); }),
      button('Non', async () => { close(); await act(c, 'betVerdict', false, 'Raté.'); }, 'btn ghost')),
  ]);
}

export async function markDone(c) {
  const ok = await confirmSheet({ title: 'Fait ?', sub: 'Ton objectif est atteint ? Je note l’heure : le premier des deux prend 3 points.', yes: 'Fait', no: 'Pas encore' });
  if (ok) await act(c, 'done', clock.now(), 'Bien joué. Je note l’heure.');
}

// ---------- Tirage au sort quand les deux ont proposé un lieu ----------
const duelShown = new Set();
function maybeDuel(c, mine, theirs, mineWins) {
  const key = `cai.duel.${c.date.id}`;
  let done = false;
  try { done = localStorage.getItem(key) === '1'; } catch { /* rien */ }
  if (done || duelShown.has(key)) return;
  duelShown.add(key);
  setTimeout(() => placeDuel(mine, theirs, mineWins, c, () => { try { localStorage.setItem(key, '1'); } catch { /* rien */ } }), 450);
}

export function placeDuel(mine, theirs, mineWins, c, onDone) {
  const P = pf(c);
  const face = (p, who, cls) => h('div', { class: `duel-face ${cls}` },
    h('div', { class: 'duel-who' }, who),
    h('div', { class: 'duel-name' }, p.title || p.name),
    p.title && h('div', { class: 'duel-place' }, p.name),
    h('div', { class: 'duel-addr' }, p.address || ''));
  const coin = h('div', { class: 'duel-card' },
    face(mine, 'Ta proposition', 'front'),
    face(theirs, `Sa proposition`, 'back'));
  const status = h('div', { class: 'duel-status' }, 'Vous avez proposé tous les deux…');
  const burst = h('div', { class: 'duel-burst' });
  const go = h('button', { class: 'btn', type: 'button', style: { opacity: 0, pointerEvents: 'none' } }, 'Voir le lieu');
  const wrap = h('div', { class: 'duel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tirage au sort du lieu' },
    h('div', { class: 'duel-inner' },
      h('div', { class: 'eyebrow', style: { alignSelf: 'center' } }, 'Le hasard tranche'),
      h('h2', { class: 'duel-title' }, 'Pile ou face'),
      h('div', { class: 'duel-stage' }, burst, coin),
      status,
      go));
  const close = () => { wrap.classList.add('out'); setTimeout(() => wrap.remove(), 300); document.body.style.overflow = ''; onDone?.(); };
  go.onclick = close;
  document.body.append(wrap);
  document.body.style.overflow = 'hidden';

  // 7 à 8 tours complets, puis on s'arrête sur la bonne face (0° = la tienne, 180° = la sienne).
  const turns = 7 * 360 + (mineWins ? 0 : 180);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    coin.style.transition = reduce ? 'none' : 'transform 4.2s cubic-bezier(0.12, 0.72, 0.18, 1)';
    coin.style.transform = `rotateY(${turns}deg)`;
  }));
  const ticks = [400, 900, 1500, 2200];
  const lines = ['Le hasard réfléchit…', 'Ça tourne…', 'Presque…', 'Et c’est…'];
  ticks.forEach((t, i) => setTimeout(() => { status.textContent = lines[i]; navigator.vibrate?.(8); }, reduce ? 0 : t));
  setTimeout(() => {
    const w = mineWins ? mine : theirs;
    status.replaceChildren(h('strong', {}, w.title || w.name), mineWins ? ' : ta proposition l’emporte !' : ` : sa proposition l’emporte !`);
    coin.classList.add('win');
    navigator.vibrate?.([30, 40, 60]);
    for (let i = 0; i < 26; i++) {
      const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.3;
      const d = 110 + Math.random() * 120;
      burst.append(h('i', { style: {
        '--x': `${Math.cos(a) * d}px`, '--y': `${Math.sin(a) * d}px`, '--r': `${Math.random() * 120 - 60}deg`,
        '--s': (0.6 + Math.random() * 0.9).toFixed(2), animationDelay: `${Math.random() * 120}ms`,
      } }));
    }
    go.style.opacity = 1;
    go.style.pointerEvents = 'auto';
  }, reduce ? 300 : 4300);
}
