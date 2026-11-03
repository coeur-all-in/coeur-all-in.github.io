// Onglets « Rendez-vous » (carte, horaires, infos) et « Discussion ».
import { forms, recognitionLines } from '../content.js';
import { partnerOf, resolvePlace } from '../date-logic.js';
import { mapBlock } from '../geo.js';
import { at, clock, moments, unlocked } from '../timeline.js';
import { button, countdown, dayLabel, h, hourLabel, icon, relDay, weekday } from '../ui.js';
import { placeDuel } from './cards.js';

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
    : [
      h('div', { class: 'section-label' }, 'Le lieu'),
      h('div', { class: 'map-locked' },
        icon('pin'),
        h('span', {}, accepted ? `Se révèle ${relDay(veille, now)} à 20h` : 'Se révèle quand vous aurez dit oui tous les deux'),
        accepted && h('span', { class: 'small' }, countdown(veille - now))),
    ];

  const recog = placeKnown ? recognitionLines(partner) : [];
  const plan = [
    ['regles', 'Les règles'], ['objectif', 'Ton objectif secret'], ['discussion', 'La discussion s’ouvre'],
    ['rdv', 'Rendez-vous'], ['jeu1', 'Premier jeu'], ['jeu2', 'Deuxième jeu'], ['jeu3', 'Troisième jeu · on peut parler boulot'],
    ['jeu4', 'Quatrième jeu'], ['pari', 'Les paris'], ['reveal', 'On révèle'],
  ].map(([k, label]) => {
    const t = k === 'rdv' ? date.dateAt : ms[k]?.at;
    const done = t <= now;
    return h('li', { class: done ? 'done' : '' },
      h('span', { class: 'n' }, done ? '✓' : hourLabel(t).replace('h', 'h')), h('span', {}, label));
  });

  return [
    h('div', { class: 'eyebrow' }, `Avec ${partner?.firstName || '…'}`),
    h('h1', { class: 'title' }, `${weekday(date.dateAt, true)}, 20h`),
    h('div', { class: 'meta' }, `${dayLabel(date.dateAt)} · ${date.dateAt > now ? countdown(date.dateAt - now) : 'c’est le jour J'}`),
    ...lieu,
    recog.length > 0 && [h('div', { class: 'section-label' }, `Pour ${P.le} reconnaître`), h('div', { class: 'body' }, h('p', { style: { fontSize: '16px' } }, recog.join(' · ')))],
    h('div', { class: 'section-label' }, `La soirée · ${weekday(date.dateAt)}`),
    h('ol', { class: 'list plan' }, plan),
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
    const ta = h('textarea', { class: 'input chat-input', rows: 1, maxlength: 1000, placeholder: 'Message…', enterkeyhint: 'send',
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
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !/iphone|ipad|android/i.test(navigator.userAgent)) { e.preventDefault(); go(); } });
    bar = h('div', { class: 'thread-bar' }, h('div', { class: 'chat-bar' }, ta, send), h('div', { class: 'thread-note' }, 'Texte uniquement · pas de photo ni de fichier'));
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

