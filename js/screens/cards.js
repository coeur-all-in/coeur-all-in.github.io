// Chaque carte du date. Les textes suivent les maquettes ; seuls les prénoms, jours, lieux
// et accords (il / elle / iel) sont calculés.
import { GAMES, fill, forms, recognitionLines } from '../content.js';
import { autocomplete, mapBlock, searchAddress, searchPlace } from '../geo.js';
import { objectiveFor, partnerOf, resolvePlace } from '../date-logic.js';
import { at, clock, isDuringDate, moments } from '../timeline.js';
import { button, card, confirmSheet, dayLabel, h, hourLabel, icon, relDay, sheet, status, toast, weekday } from '../ui.js';

// Titres courts pour le fil.
export const TILE = {
  invite: (c) => ({ e: 'Quelqu’un a pensé à toi', t: c.partner?.firstName || '…' }),
  cadrage: (c) => ({ e: 'C’est calé', t: `${weekday(c.date.dateAt, true)}, 20h` }),
  tonTour: () => ({ e: 'Et si on en apprenait plus ?', t: 'À ton tour' }),
  phrase: () => ({ e: 'Ce qu’on a écrit pour toi', t: 'Dans ses mots' }),
  lieu: (c) => ({ e: 'Le lieu est fixé', t: place(c).title || place(c).name }),
  regles: () => ({ e: 'Avant ce soir', t: 'Les règles' }),
  objectif: (c) => ({ e: 'Personne d’autre ne le sait', t: objectiveFor(c.date, c.uid, c.partner?.gender).title }),
  numeros: () => ({ e: 'Juste pour se trouver', t: '19h30' }),
  jeu1: () => ({ e: GAMES[0].eyebrow, t: GAMES[0].title }),
  jeu2: () => ({ e: GAMES[1].eyebrow, t: GAMES[1].title }),
  jeu3: () => ({ e: GAMES[2].eyebrow, t: GAMES[2].title }),
  jeu4: () => ({ e: GAMES[3].eyebrow, t: GAMES[3].title }),
  pari: () => ({ e: 'On rouvre', t: 'Son pari' }),
  reveal: () => ({ e: 'On révèle', t: 'Les objectifs' }),
  apres: () => ({ e: 'Le lendemain', t: 'Et maintenant ?' }),
  verdict: (c) => (both(c, 'again') ? { e: 'C’est réciproque', t: 'On se revoit' } : { e: 'Merci pour la soirée', t: 'Chacun son chemin' }),
};

// Une carte attend-elle une action de ma part ?
export function needsAction(key, c) {
  const mine = c.date.answers?.[c.uid] || {};
  return ({
    invite: mine.accept === undefined,
    cadrage: !mine.confirm,
    tonTour: mine.phrase === undefined,
    lieu: mine.bet === undefined,
    regles: !mine.rules,
    objectif: !mine.objectiveSeen,
    pari: mine.betVerdict === undefined && !!theirs(c).bet,
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

async function act(c, key, value, msg) {
  await c.store.answer(key, value);
  if (msg) toast(msg);
  await c.refresh();
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
      actions = status(t.accept ? `Vous avez dit oui tous les deux.` : `Tu as dit oui. J’attends sa réponse.`, t.accept ? 'check' : 'hourglass');
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
      items: ['Pas de photo, pas de nom', `Le lieu se révèle ${veille}`, 'Quatre messages dans la soirée', 'Un objectif secret, rien qu’à toi'],
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
        'Quatre messages dans la soirée, pas un de plus',
        `Un objectif secret ${P.qu} ne connaîtra jamais`,
        `Les règles, ${weekday(c.date.dateAt)} matin, avant le reste`,
        `${cap(when)}, on reparle du lieu`,
      ],
      actions: mineA(c).confirm
        ? status(`Partant${M.e}. On se reparle ${when}.`)
        : button(`Tu es toujours partant${M.e} ?`, () => act(c, 'confirm', true, 'Parfait.')),
      foot: mineA(c).confirm ? null : 'Réponds-moi',
    });
  },

  tonTour(c) {
    const P = pf(c);
    const m = mineA(c);
    const dl = moments(c.date, c.uid).find((x) => x.key === 'tonTour').deadline;
    const answered = m.phrase !== undefined;
    return card({
      eyebrow: 'Et si on en apprenait plus ?',
      title: 'À ton tour',
      meta: `Réponse attendue avant ${relDay(dl, c.now)} ${dl > c.now ? (new Date(dl).getHours() === 12 ? 'midi' : hourLabel(dl)) : ''}`.trim(),
      body: [
        `Où vous allez ${weekday(c.date.dateAt)}. Un seul endroit, public, où on peut s’entendre parler.`,
        `Et une phrase sur toi, celle ${P.qu} lira ${relDay(dl, c.now) === 'demain' ? 'demain' : 'bientôt'} en même temps que le lieu.`,
      ],
      items: ['Un seul endroit, tu peux aussi lui laisser le choix', 'Une phrase qu’on ne pourrait dire que de toi', 'Ni ton métier, ni ton âge, ni ce que tu cherches', 'Je ne la corrigerai pas'],
      sections: answered ? [{ label: 'Ce que tu as envoyé', text: h('div', {},
        h('p', { class: 'small' }, m.place?.leave ? `Lieu : tu lui laisses le choix.` : `Lieu : ${m.place?.name}, ${m.place?.address}`),
        h('blockquote', { class: 'quote' }, `« ${m.phrase} »`)) }] : [],
      actions: answered
        ? status('C’est envoyé. Je ne la corrigerai pas.')
        : (dl > c.now ? button('Je réponds', () => tonTourForm(c)) : status('Trop tard pour celle-ci. Je m’occupe du lieu.', 'clock')),
    });
  },

  phrase(c) {
    const P = pf(c);
    const t = theirs(c);
    const lieu = moments(c.date, c.uid).find((x) => x.key === 'lieu').at;
    return card({
      eyebrow: `Ce ${P.qu} a écrit sur ${P.lui}`,
      title: 'Dans ses mots',
      meta: c.partner.firstName,
      quote: t.phrase || null,
      body: t.phrase ? null : [`${P.Il} n’a rien écrit. ${P.Il} préfère que tu le découvres en face.`],
      actions: h('hr', { class: 'rule' }),
      foot: `Le lieu, ${relDay(lieu, c.now)} ${hourLabel(lieu)}.`,
    });
  },

  lieu(c) {
    const P = pf(c);
    const pl = place(c);
    const m = mineA(c);
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${pl.name}, ${pl.address}`)}`;
    const body = [`Vous vous retrouvez devant ${pl.name}.`];
    if (pl.after) body.push(pl.after);
    const recog = recognitionLines(c.partner);
    const mineP = m.place;
    const theirP = theirs(c).place;
    const duel = mineP?.name && !mineP.leave && theirP?.name && !theirP.leave;
    if (duel) maybeDuel(c, mineP, theirP, pl.by === c.uid);
    return card({
      eyebrow: 'Le lieu est fixé',
      title: pl.title || pl.name,
      meta: dateMeta(c),
      body,
      items: [`20h, devant ${pl.name}${pl.address ? ' — ' + pl.address : ''}`, 'Vos numéros à 19h30, juste pour se trouver', pl.tip],
      extra: [
        mapBlock({ lat: pl.lat, lng: pl.lng, label: pl.name }),
        h('a', { class: 'link', href: maps, target: '_blank', rel: 'noopener', style: { textAlign: 'left', margin: '4px 0 0', padding: '6px 0', color: 'var(--accent)' } }, 'Ouvrir l’itinéraire ↗'),
        duel && h('button', { type: 'button', class: 'link', style: { textAlign: 'left', margin: '0', padding: '6px 0' }, onclick: () => placeDuel(mineP, theirP, pl.by === c.uid, c) },
          `Tiré au sort entre ${mineP.name} et ${theirP.name} · revoir le tirage`),
      ],
      sections: [
        recog.length && { label: `Pour ${P.le} reconnaître`, text: h('div', { class: 'body' }, h('p', { style: { fontSize: '16.5px' } }, recog.join(' · '))) },
        { label: 'Ton pari', italic: true, text: m.bet ? `« ${m.bet} »` : `D’après ce que tu sais de ${P.lui}, si tu devais parier quelque chose sur ${P.lui}, tu dirais quoi ? Une phrase.` },
      ].filter(Boolean),
      actions: m.bet ? status(`Pari enregistré. On rouvre ${weekday(c.date.dateAt)} soir.`) : button('J’écris mon pari', () => betForm(c)),
      foot: m.bet ? null : `On rouvre ${weekday(c.date.dateAt)} soir.`,
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
        'Vos numéros arrivent à 19h30, juste pour se trouver',
        'On n’utilise pas son téléphone, sauf pour mes messages',
        'On n’évoque pas sa vie professionnelle avant 21h30',
        'Tout choix qui prend plus de quelques secondes se tranche au pierre-feuille-ciseaux',
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
    else if (m.objectiveSeen) actions = status('C’est noté. Le bouton « fait » s’active ce soir.', 'clock');
    else actions = button('C’est noté', () => act(c, 'objectiveSeen', true));
    return card({
      eyebrow: 'Personne d’autre ne le sait',
      title: o.title,
      meta: 'Ton objectif de la soirée',
      body: [`${o.text} ${P.Il} a le sien, et tu ne l’apprendras qu’à la fin.`],
      items: ['Interdit de poser la question frontalement', 'Interdit de mimer ou de l’écrire', 'Écris-moi « fait » au moment où ça arrive'],
      actions,
      foot: 'On révèle plus tard.',
    });
  },

  numeros(c) {
    const P = pf(c);
    const pl = place(c);
    const num = h('div', { class: 'phone-big' }, '…');
    const links = h('div', { class: 'btn-row' });
    c.store.partnerPhone().then((tel) => {
      num.textContent = tel || 'Indisponible';
      if (tel) {
        const t = tel.replace(/[^\d+]/g, '');
        links.replaceChildren(
          h('a', { class: 'btn quiet', href: `tel:${t}`, style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' } }, 'Appeler'),
          h('a', { class: 'btn quiet', href: `sms:${t}`, style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' } }, 'SMS'));
      }
    }).catch(() => { num.textContent = 'Indisponible'; });
    return card({
      eyebrow: 'Juste pour se trouver',
      title: '19h30',
      meta: `Le numéro de ${c.partner.firstName}`,
      before: h('div', {}, num, links),
      items: ['On ne s’en sert que pour se trouver', `20h, devant ${pl.name}`, `${P.Il} a le tien aussi`],
      foot: 'Ensuite, téléphone dans la poche.',
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
          t.betVerdict === undefined ? `${P.Il} n’a pas encore tranché.` : t.betVerdict ? `${P.Il} dit que tu as vu juste.` : `${P.Il} dit que non. Raté, cette fois.`)) });
    }
    return card({
      eyebrow: 'On rouvre',
      title: 'Son pari',
      meta: `${c.partner.firstName}, ${relDay(lieuAt, c.now)} soir`,
      quote: t.bet || null,
      body: t.bet ? null : [`${P.Il} n’a pas parié. Tu as gagné par forfait.`],
      sections,
      before: t.bet && h('p', { style: { color: 'var(--ink-2)', margin: '0 0 6px' } }, 'Lis-le à voix haute'),
      actions: !t.bet ? null : m.betVerdict !== undefined
        ? status(m.betVerdict ? `Tu as tranché : ${P.il} a vu juste.` : `Tu as tranché : ${P.il} s’est trompé${P.e}.`)
        : [button(`${P.Il} a vu juste ?`, () => verdictSheet(c))],
      foot: t.bet && m.betVerdict === undefined ? 'C’est toi qui tranches.' : null,
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
    return card({
      eyebrow: 'On révèle',
      title: 'Les objectifs',
      meta: 'Personne d’autre ne le savait',
      sections: [
        { rule: false, label: 'Le tien', text: h('div', {}, h('div', { class: 'italic' }, mine.text), h('p', { class: 'small', style: { marginTop: '8px' } }, line(m.done))) },
        { label: 'Le sien', text: h('div', {}, h('div', { class: 'italic' }, theirsO.text), h('p', { class: 'small', style: { marginTop: '8px' } }, line(t.done))) },
        c.partner.job && { label: 'Et son métier', text: h('div', { class: 'body' }, h('p', {}, c.partner.job)) },
      ].filter(Boolean),
      foot: 'Demain matin, une dernière question.',
    });
  },

  apres(c) {
    const P = pf(c);
    const m = mineA(c);
    return card({
      eyebrow: 'Le lendemain',
      title: 'Et maintenant ?',
      meta: 'Rien ne part sans vous deux',
      body: [`Dis-moi si tu veux ${P.le} revoir. ${P.Il} ne connaîtra ta réponse que si c’est réciproque.`],
      actions: m.again !== undefined
        ? status(`C’est noté. Je te dis dès ${P.qu} a répondu.`, 'hourglass')
        : [button(`Je veux ${P.le} revoir`, () => act(c, 'again', true)), button('On en reste là', () => act(c, 'again', false), 'link')],
    });
  },

  verdict(c) {
    const P = pf(c);
    if (both(c, 'again')) {
      return card({
        eyebrow: 'C’est réciproque',
        title: 'On se revoit',
        meta: `${c.partner.firstName} aussi`,
        body: ['Vous avez tous les deux envie de vous revoir. À partir de maintenant, je vous laisse faire : vous avez vos numéros.'],
        actions: [button('Terminer ce date', () => c.nextMatch({ quiet: true }), 'btn ghost')],
        foot: 'Ça m’a fait plaisir.',
      });
    }
    return card({
      eyebrow: 'Merci pour la soirée',
      title: 'Chacun son chemin',
      body: ['Ce n’était pas réciproque cette fois. Ce n’est pas un échec : c’est une soirée de plus où tu as joué le jeu.'],
      actions: button('Chercher quelqu’un d’autre', () => c.nextMatch({ quiet: true })),
      foot: `${P.Il} ne saura pas ta réponse.`,
    });
  },
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Jeux ----------
function game(c, idx) {
  const g = GAMES[idx];
  const extra = [];
  if (g.id === 'jeu3') extra.push(h('p', { class: 'small', style: { marginTop: '6px' } }, 'Il est 21h30 : vous pouvez maintenant parler boulot.'));
  if (g.timer) extra.push(button('Lancer le chrono', () => timerSheet(g.timer), 'btn ghost'), h('div', { style: { height: '8px' } }));
  return card({
    eyebrow: g.eyebrow, title: g.title, meta: g.meta, body: g.body, items: g.items, extra,
    actions: h('hr', { class: 'rule', style: { margin: '10px 0 0' } }), foot: g.foot,
  });
}

function timerSheet(seconds) {
  let left = seconds;
  let id;
  const C = 2 * Math.PI * 82;
  const num = h('div', { class: 'num' }, String(left));
  const ring = h('div', { class: 'ring', html: `<svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="82" class="track" stroke="currentColor" stroke-width="5" fill="none"/><circle class="arc" cx="90" cy="90" r="82" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0" style="transition: stroke-dashoffset 1s linear"/></svg>` }, num);
  const msg = h('p', { class: 'sub', style: { textAlign: 'center' } }, 'Sans parler, en vous regardant.');
  sheet((close) => {
    id = setInterval(() => {
      left -= 1;
      num.textContent = String(Math.max(0, left));
      ring.querySelector('.arc').setAttribute('stroke-dashoffset', String(C * (1 - left / seconds)));
      if (left <= 0) {
        clearInterval(id);
        msg.textContent = 'Un mot. Un seul.';
        navigator.vibrate?.([200, 100, 200]);
      }
    }, 1000);
    return [h('h3', { style: { textAlign: 'center' } }, 'Trente secondes'), h('div', { class: 'timer' }, ring), msg, button('Fermer', close, 'link')];
  }, { onClose: () => clearInterval(id) });
}

// ---------- Formulaires ----------
function tonTourForm(c) {
  const P = pf(c);
  const st = { leave: false, name: '', address: '', title: '', after: '', tip: '', phrase: '', lat: null, lng: null };
  sheet((close) => {
    const placeBox = h('div', {});
    const err = h('div', { class: 'error' });
    const input = (key, ph, multiline) => h(multiline ? 'textarea' : 'input', {
      class: 'input', placeholder: ph, maxlength: multiline ? 160 : 90, oninput: (e) => { st[key] = e.target.value; },
    });
    const fieldOf = (label, ...ctl) => h('div', { class: 'field' }, h('label', {}, label), ...ctl);
    // Le lieu : liste déroulante qui se met à jour à chaque lettre, puis carte.
    const mapBox = h('div', { style: { marginTop: '12px' } });
    const showMap = () => mapBox.replaceChildren(...[st.lat != null && mapBlock({ lat: st.lat, lng: st.lng, label: st.name }, { height: 170 })].filter(Boolean));
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
      fieldOf('L’adresse', addrField, mapBox),
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
      h('div', { class: 'section-label' }, 'Ta phrase'),
      h('div', { class: 'field' },
        h('textarea', { class: 'input', maxlength: 220, placeholder: 'Une phrase qu’on ne pourrait dire que de toi.', oninput: (e) => { st.phrase = e.target.value; } }),
        h('p', { class: 'small' }, 'Ni ton métier, ni ton âge, ni ce que tu cherches.')),
      err,
      button('Envoyer', async () => {
        if (!st.leave && (!st.name.trim() || !st.address.trim())) { err.textContent = 'Le nom du lieu et son adresse, ou laisse-lui le choix.'; return; }
        if (st.phrase.trim().length < 10) { err.textContent = 'Ta phrase est un peu courte.'; return; }
        const placeVal = st.leave ? { leave: true } : { name: st.name.trim(), address: st.address.trim(), title: st.title.trim(), after: st.after.trim(), tip: st.tip.trim(), lat: st.lat, lng: st.lng };
        await c.store.answer('place', placeVal);
        await c.store.answer('phrase', st.phrase.trim());
        close();
        toast('Envoyé.');
        await c.refresh();
      }),
    ];
  });
}

function betForm(c) {
  const P = pf(c);
  let v = '';
  sheet((close) => {
    const err = h('div', { class: 'error' });
    return [
      h('h3', {}, 'Ton pari'),
      h('p', { class: 'sub' }, `D’après ce que tu sais de ${P.lui}, si tu devais parier quelque chose sur ${P.lui}, tu dirais quoi ? ${P.Il} le lira le soir même.`),
      h('div', { class: 'field' }, h('textarea', { class: 'input', maxlength: 160, placeholder: `${P.Il} va me dire…`, oninput: (e) => { v = e.target.value; } })),
      err,
      button('Parier', async () => {
        if (v.trim().length < 6) { err.textContent = 'Une vraie phrase, s’il te plaît.'; return; }
        await c.store.answer('bet', v.trim());
        close();
        toast('Pari enregistré.');
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
      button('Oui', async () => { close(); await act(c, 'betVerdict', true, 'Bien vu.'); }),
      button('Non', async () => { close(); await act(c, 'betVerdict', false, 'Raté.'); }, 'btn ghost')),
  ]);
}

export async function markDone(c) {
  const ok = await confirmSheet({ title: 'Fait ?', sub: 'Ton objectif est atteint ? Je note l’heure.', yes: 'Fait', no: 'Pas encore' });
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
