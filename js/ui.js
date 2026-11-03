// Petits outils d'interface : création d'éléments, carte, feuilles, toasts, dates en français.
import { MONTH_NAMES, WEEKDAY_NAMES } from './content.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------- Icônes (SVG inline) ----------
const ICONS = {
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="currentColor"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>',
  back: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  user: '<circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  bell: '<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14" rx="2.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6L12 3z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
  pause: '<path d="M9 6v12M15 6v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5s8 3.5 8 8.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  ff: '<path d="M4 6l7 6-7 6V6zM13 6l7 6-7 6V6z" fill="currentColor"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 1113 0c0 5-6.5 11-6.5 11z" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 006 6l1.5-2 4 1.5v3a2 2 0 01-2 2A16 16 0 014.5 5.5a2 2 0 012-2z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
  home: '<path d="M4 11l8-6.5 8 6.5V20h-5.5v-5h-5v5H4v-9z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span.firstChild;
}

// ---------- La carte (fidèle aux maquettes) ----------
// spec : { eyebrow, title, meta, body: [..], quote, items: [..], sections: [{label, text|node}],
//          actions: [nodes], foot, extra: [nodes] }
export function card(spec) {
  return [
    spec.eyebrow && h('div', { class: 'eyebrow' }, spec.eyebrow),
    spec.title && h('h1', { class: 'title' }, spec.title),
    spec.meta && h('div', { class: 'meta' }, spec.meta),
    spec.body?.length && h('div', { class: 'body' }, spec.body.map((p) => h('p', {}, p))),
    spec.quote && h('blockquote', { class: 'quote' }, `« ${spec.quote} »`),
    spec.before,
    spec.items?.length && list(spec.items),
    spec.extra,
    ...(spec.sections || []).map((s) => [
      s.rule !== false && h('hr', { class: 'rule' }),
      s.label && h('div', { class: 'section-label' }, s.label),
      typeof s.text === 'string' ? h('div', { class: s.italic ? 'italic' : 'body' }, s.italic ? s.text : h('p', {}, s.text)) : s.text,
    ]),
    h('div', { class: 'spacer' }),
    spec.actions,
    spec.foot && h('div', { class: 'foot' }, spec.foot),
  ];
}

export function list(items) {
  return h('ol', { class: 'list' }, items.filter(Boolean).map((t, i) =>
    h('li', {}, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), h('span', {}, t))));
}

export function button(label, onClick, cls = 'btn') {
  return h('button', { class: cls, type: 'button', onclick: onClick }, label);
}

export function status(text, ic = 'check') {
  return h('div', { class: 'status' }, icon(ic), h('span', {}, text));
}

// ---------- Feuille (bottom sheet) ----------
export function sheet(build, { onClose } = {}) {
  const wrap = h('div', { class: 'sheet-wrap', role: 'dialog', 'aria-modal': 'true' });
  const panel = h('div', { class: 'sheet' }, h('div', { class: 'grab' }));
  const close = () => { wrap.remove(); document.body.style.overflow = ''; onClose?.(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  panel.append(...[build(close)].flat().filter(Boolean));
  wrap.append(panel);
  document.body.append(wrap);
  document.body.style.overflow = 'hidden';
  return close;
}

export function confirmSheet({ title, sub, yes, no = 'Annuler', danger }) {
  return new Promise((resolve) => {
    let answered = false;
    sheet((close) => [
      h('h3', {}, title),
      sub && h('p', { class: 'sub' }, sub),
      button(yes, () => { answered = true; close(); resolve(true); }, danger ? 'btn' : 'btn'),
      button(no, () => { answered = true; close(); resolve(false); }, 'link'),
    ], { onClose: () => { if (!answered) resolve(false); } });
  });
}

let toastTimer;
export function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3800);
}

// ---------- Dates en français ----------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function hourLabel(ts) {
  const d = new Date(ts);
  const m = d.getMinutes();
  return `${d.getHours()}h${m ? String(m).padStart(2, '0') : ''}`;
}

export function dayLabel(ts, { capital = true } = {}) {
  const d = new Date(ts);
  const s = `${WEEKDAY_NAMES[d.getDay()]} ${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return capital ? cap(s) : s;
}

export function weekday(ts, capital = false) {
  const s = WEEKDAY_NAMES[new Date(ts).getDay()];
  return capital ? cap(s) : s;
}

// « aujourd'hui », « demain », ou le jour de la semaine.
export function relDay(ts, now) {
  const a = new Date(now); a.setHours(0, 0, 0, 0);
  const b = new Date(ts); b.setHours(0, 0, 0, 0);
  const diff = Math.round((b - a) / 864e5);
  if (diff === 0) return 'aujourd’hui';
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  if (diff > 1 && diff < 7) return WEEKDAY_NAMES[b.getDay()];
  return dayLabel(ts, { capital: false });
}

export function countdown(ms) {
  if (ms <= 0) return 'maintenant';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `dans ${d} j ${hh} h`;
  if (hh > 0) return `dans ${hh} h ${String(mm).padStart(2, '0')}`;
  return `dans ${mm} min ${String(ss).padStart(2, '0')} s`;
}

// Étiquette courte pour le fil : « auj. », « hier », « mar. »…
export function shortDay(ts, now) {
  const r = relDay(ts, now);
  if (r === 'aujourd’hui') return 'auj.';
  if (r === 'hier' || r === 'demain') return r;
  return WEEKDAY_NAMES[new Date(ts).getDay()].slice(0, 3) + '.';
}
