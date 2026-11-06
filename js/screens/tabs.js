// Onglets « Rendez-vous » (carte, horaires, infos) et « Discussion ».
import { forms } from '../content.js';
import { partnerOf, resolvePlace } from '../date-logic.js';
import { mapBlock } from '../geo.js';
import { at, clock, moments, unlocked } from '../timeline.js';
import { button, countdown, dayLabel, h, hourLabel, icon, relDay, weekday } from '../ui.js';
import { arriveBox, placeDuel } from './cards.js';

const both = (c, k) => c.date.answers?.[c.uid]?.[k] === true && c.date.answers?.[partnerOf(c.date, c.uid)]?.[k] === true;

// ---------- Rendez-vous ----------
export function rdvView(c) {
  if (!c) {
    return [
      h('div', { class: 'eyebrow' }, 'Ton rendez-vous'),
      h('h1', { class: 'title' }, 'Pas encore'),
      h('div', { class: 'body' }, h('p', {}, 'Dès que je t’ai trouvé quelqu’un, tout ce qu’il faut savoir sur votre soirée sera ici : le jour, le lieu sur la carte, l’heure de chaque message.')),
    ];
  }
  const { date, partner, now } = c;
  const P = forms(partner?.gender);
  const keys = new Set(unlocked(date, c.uid, now).map((m) => m.key));
  const ms = Object.fromEntries(moments(date, c.uid).map((m) => [m.key, m]));
  const placeKnown = keys.has('lieu');
  const pl = resolvePlace(date, c.me.city);
  const accepted = both(c, 'accept');
  const veille = at(date.dateAt, -1, 20);

  const mine = date.answers?.[c.uid]?.place;
  const theirs = date.answers?.[partnerOf(date, c.uid)]?.place;
  const duel = mine?.name && !mine.leave && theirs?.name && !theirs.leave;

  const lieu = placeKnown
    ? [
      h('div', { class: 'section-label' }, 'Le lieu'),
      h('div', { class: 'rdv-place' },
        h('div', { class: 'rdv-place-name' }, pl.name),
        pl.address && h('div', { class: 'small' }, pl.address)),
      mapBlock({ lat: pl.lat, lng: pl.lng, label: pl.name }, { height: 260 })
        || h('div', { class: 'map-locked' }, h('span', {}, 'Pas de carte pour cette adresse')),
      h('div', { class: 'btn-row', style: { marginTop: '12px' } },
        h('a', { class: 'btn quiet', target: '_blank', rel: 'noopener', style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' },
          href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pl.lat != null ? `${pl.lat},${pl.lng}` : `${pl.name}, ${pl.address}`)}` }, 'Itinéraire ↗'),
        duel ? button('Revoir le tirage', () => placeDuel(mine, theirs, pl.by === c.uid, c), 'btn quiet') : null),
    ]
    : c.adminPreview ? adminPreview(c, pl, mine, theirs) : [
      h('div', { class: 'section-label' }, 'Le lieu'),
      h('div', { class: 'map-locked' },
        icon('pin'),
        h('span', {}, accepted ? `Se révèle ${relDay(veille, now)} à 20h` : 'Se révèle quand vous aurez dit oui tous les deux'),
        accepted && h('span', { class: 'small' }, countdown(veille - now))),
    ];

  const lookout = placeKnown ? date.answers?.[partnerOf(date, c.uid)]?.lookout : null;
  const g = c.games || [];
  const plan = [
    ['regles', 'Les règles'], ['objectif', 'Ton objectif secret'], ['discussion', 'La discussion s’ouvre'],
    ['rdv', 'Rendez-vous · appuie sur « Je suis arrivé·e »'],
    ['jeu1', `Premier jeu · ${g[0]?.title || ''}`], ['jeu2', `Deuxième jeu · ${g[1]?.title || ''}`],
    ['jeu3', `Troisième jeu · ${g[2]?.title || ''} · on peut parler boulot`],
    ['jeu4', `Quatrième jeu · ${g[3]?.title || ''}`], ['pari', 'Les paris'], ['reveal', 'On révèle, puis le gagnant'],
  ].filter(([k]) => k === 'rdv' || ms[k]).map(([k, label]) => {
    const t = k === 'rdv' ? date.dateAt : ms[k]?.at;
    const done = t <= now;
    return h('li', { class: done ? 'done' : '' },
      h('span', { class: 'n' }, done ? '✓' : hourLabel(t)), h('span', {}, label));
  });
  const arrived = date.answers?.[c.uid]?.arrived != null && date.answers?.[partnerOf(date, c.uid)]?.arrived != null;

  return [
    h('div', { class: 'eyebrow' }, `Avec ${partner?.firstName || '…'}`),
    h('h1', { class: 'title' }, `${weekday(date.dateAt, true)}, 20h`),
    h('div', { class: 'meta' }, `${dayLabel(date.dateAt)} · ${date.dateAt > now ? countdown(date.dateAt - now) : 'c’est le jour J'}`),
    arriveBox(c),
    ...lieu,
    placeKnown && [h('div', { class: 'section-label' }, `Pour ${P.le} reconnaître`),
      lookout ? h('blockquote', { class: 'quote small-quote' }, `« ${lookout} »`) : h('p', { class: 'small' }, `${P.Il} écrira un petit mot avant le rendez-vous.`)],
    h('div', { class: 'section-label' }, `La soirée · ${weekday(date.dateAt)}`),
    h('ol', { class: 'list plan' }, plan),
    h('p', { class: 'small', style: { marginTop: '8px' } }, arrived ? 'Les heures des jeux partent de votre arrivée.' : 'Les jeux commencent 30 min après vos deux arrivées : ces heures s’ajustent quand vous appuyez sur « Je suis arrivé·e ».'),
  ];
}

// Mode démo (admin) : la carte est visible avant la révélation, pour vérifier les adresses.
function adminPreview(c, pl, mine, theirs) {
  const pts = [];
  const add = (p, who) => { if (p && !p.leave && p.name) pts.push({ ...p, who }); };
  add(mine, 'Ta proposition');
  add(theirs, 'Sa proposition');
  const chosen = pts.length ? null : { ...pl, who: 'Lieu par défaut (personne n’a proposé)' };
  const list = chosen ? [chosen] : pts;
  return [
    h('div', { class: 'section-label' }, 'Le lieu · aperçu admin (mode démo)'),
    h('div', { class: 'rdv-place' },
      ...list.map((p) => h('div', { style: { marginBottom: '8px' } },
        h('div', { class: 'small' }, p.who),
        h('div', { class: 'rdv-place-name', style: { fontSize: '19px' } }, p.name),
        h('div', { class: 'small' }, `${p.address || 'adresse manquante'}${p.lat == null ? ' · ⚠ pas de coordonnées, pas de carte' : ''}`)))),
    mapBlock(list.map((p) => ({ lat: p.lat, lng: p.lng, label: p.name })), { height: 260 })
      || h('div', { class: 'map-locked' }, icon('pin'), h('span', {}, 'Aucune coordonnée : impossible d’afficher la carte')),
    h('p', { class: 'small', style: { marginTop: '8px' } }, 'Visible seulement par les admins en mode démo. Les autres voient le lieu verrouillé jusqu’à la veille 20h.'),
  ];
}

// ---------- Discussion ----------
// Ouvre 1 h avant le rendez-vous (même règle côté serveur).
export const chatOpensAt = (date) => date.dateAt - 3600e3;

// Liste des conversations, une par ligne (comme WhatsApp / Insta).
// rows : [{ id, name, preview, at, unread, locked, current }]
export function chatListView(rows, onOpen) {
  return [
    h('h1', { class: 'title', style: { fontSize: '40px', marginBottom: '18px' } }, 'Discussions'),
    rows.length
      ? h('div', { class: 'convs' }, rows.map((r) => h('button', { class: `conv${r.unread ? ' unread' : ''}${r.current ? ' current' : ' old'}`, type: 'button', onclick: () => onOpen(r) },
        avatar(r.name, r.current),
        h('div', { class: 'conv-main' },
          h('div', { class: 'conv-top' },
            h('span', { class: 'conv-name' }, h('span', { class: 'nm' }, r.name), r.current && h('span', { class: 'conv-live' }, 'En cours')),
            h('span', { class: 'conv-time' }, r.at ? shortTime(r.at) : '')),
          h('div', { class: 'conv-bottom' },
            h('span', { class: 'conv-preview' }, r.locked ? h('span', { class: 'conv-lock' }, icon('clock'), r.preview) : r.preview),
            r.unread ? h('span', { class: 'conv-badge' }, r.unread > 9 ? '9+' : String(r.unread)) : null)))))
      : h('div', { class: 'map-locked', style: { height: '220px' } }, icon('chat'),
        h('span', {}, 'Aucune discussion pour l’instant'),
        h('span', { class: 'small' }, 'Elle s’ouvre 1 h avant ton rendez-vous.')),
  ];
}

export function avatar(name, live) {
  return h('div', { class: `avatar${live ? ' live' : ''}` }, h('span', {}, (name || '?').trim().charAt(0).toUpperCase()));
}

function shortTime(ts) {
  const d = relDay(ts, clock.now());
  if (d === 'aujourd’hui') return hourLabel(ts);
  if (d === 'hier') return 'hier';
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Une conversation en plein écran. opts : { name, sub, messages, uid, onBack, onSend (null = lecture seule), lockedText }
export function threadView(o) {
  const list = h('div', { class: 'thread-list' });
  renderMessages(list, o.messages, o.uid);
  let bar;
  if (o.onSend) {
    const ta = h('textarea', { class: 'input chat-input', rows: 1, maxlength: 1000, placeholder: 'Message…', enterkeyhint: 'enter', autocapitalize: 'sentences',
      oninput: (e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`; } });
    const send = h('button', { class: 'chat-send', type: 'button', 'aria-label': 'Envoyer' },
      h('span', { html: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor"/></svg>' }));
    const go = async () => {
      const body = ta.value.trim();
      if (!body) return;
      ta.value = '';
      ta.style.height = 'auto';
      ta.focus();
      await o.onSend(body);
    };
    send.onclick = go;
    // Sur téléphone, la touche Entrée va à la ligne (comme Insta) ; on envoie avec la flèche.
    // Sur ordinateur : Entrée envoie, Maj + Entrée va à la ligne.
    const touch = matchMedia('(pointer: coarse)').matches;
    ta.addEventListener('keydown', (e) => { if (!touch && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } });
    // Quand le clavier s'ouvre, on garde les derniers messages visibles.
    ta.addEventListener('focus', () => setTimeout(() => { list.scrollTop = list.scrollHeight; }, 250));
    send.addEventListener('pointerdown', (e) => e.preventDefault()); // le clavier reste ouvert après l'envoi
    bar = h('div', { class: 'thread-bar' }, h('div', { class: 'chat-bar' }, ta, send));
  } else {
    bar = h('div', { class: 'thread-bar' }, h('div', { class: 'thread-locked' }, o.lockedText || 'Lecture seule'));
  }
  return h('main', { class: 'thread' },
    h('header', { class: 'thread-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Retour', onclick: o.onBack }, icon('back')),
      avatar(o.name, !!o.onSend),
      h('div', { class: 'thread-who' }, h('div', { class: 'thread-name' }, o.name), h('div', { class: 'thread-sub' }, o.sub || ''))),
    list,
    bar);
}

export function renderMessages(list, messages, uid) {
  if (!messages.length) {
    list.replaceChildren(h('div', { class: 'chat-empty' }, 'Aucun message. Lance-toi.'));
    return;
  }
  let lastDay = '';
  const nodes = [];
  for (const m of messages) {
    const day = relDay(m.at, clock.now());
    if (day !== lastDay) { nodes.push(h('div', { class: 'chat-day' }, day)); lastDay = day; }
    nodes.push(h('div', { class: `bubble ${m.from === uid ? 'me' : 'them'}${m.pending ? ' pending' : ''}` }, m.body, h('span', { class: 'bubble-time' }, m.pending ? 'envoi…' : hourLabel(m.at))));
  }
  list.replaceChildren(...nodes);
}


// Glisser vers la droite pour quitter une conversation (comme sur iPhone).
// `el` suit le doigt ; `under` (l'écran en dessous) glisse légèrement en parallaxe.
export function enableSwipeBack(el, { under, onBack }) {
  let x0 = 0; let y0 = 0; let dx = 0; let t0 = 0; let lock = null; let on = false;
  const W = () => el.getBoundingClientRect().width || window.innerWidth;
  const paint = (x, anim) => {
    const tr = anim ? 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    el.style.transition = tr;
    el.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
    if (under) {
      under.style.transition = tr;
      under.style.transform = x ? `translate3d(${-60 + (60 * x) / W()}px, 0, 0)` : '';
    }
  };
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) { on = false; return; }
    const t = e.touches[0];
    x0 = t.clientX; y0 = t.clientY; dx = 0; lock = null; on = true; t0 = performance.now();
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!on) return;
    const t = e.touches[0];
    const mx = t.clientX - x0;
    const my = t.clientY - y0;
    if (!lock) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      lock = mx > 0 && Math.abs(mx) > Math.abs(my) * 1.3 ? 'x' : 'y';
      if (lock === 'x') { el.classList.add('swiping'); if (under) under.style.transform = 'translate3d(-60px, 0, 0)'; }
    }
    if (lock !== 'x') return;
    dx = Math.max(0, mx);
    paint(dx, false);
  }, { passive: true });
  const end = () => {
    if (!on) return;
    on = false;
    if (lock !== 'x') return;
    el.classList.remove('swiping');
    const v = dx / Math.max(1, performance.now() - t0);
    if (dx > W() * 0.33 || (v > 0.45 && dx > 40)) {
      paint(W(), true);
      setTimeout(() => { if (under) { under.style.transition = ''; under.style.transform = ''; } onBack(); }, 260);
    } else paint(0, true);
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
}
