// Cœur All In — contrôleur principal.
import { CONFIG, IS_REMOTE } from './config.js';
import { forms, portraitText } from './content.js';
import { askPermission, downloadCalendar, notifState, notifyNew, setBadge } from './notify.js';
import { CARDS, TILE, markDone, needsAction } from './screens/cards.js';
import { onboarding } from './screens/onboarding.js';
import { createStore } from './store/index.js';
import { clock, isDuringDate, nextJump, nextMoment, unlocked } from './timeline.js';
import { button, card, confirmSheet, countdown, dayLabel, h, hourLabel, icon, relDay, sheet, shortDay, status, toast, weekday } from './ui.js';

const root = document.getElementById('app');
const S = {
  store: null, uid: null, profile: null, data: null,
  view: 'boot', cardKey: null, sig: '', searching: false,
};
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

// ---------- Préférences locales ----------
const pref = {
  get(k, d) { try { const v = localStorage.getItem('cai.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cai.' + k, JSON.stringify(v)); } catch { /* rien */ } },
};
const demoOn = () => pref.get('demo', !IS_REMOTE);

const seenKey = () => `seen.${S.data?.date?.id}`;
const seen = () => new Set(pref.get(seenKey(), []));
const markSeen = (k) => { const s = seen(); s.add(k); pref.set(seenKey(), [...s]); };

// ---------- Contexte passé aux cartes ----------
function ctx() {
  const { date, partner } = S.data;
  return {
    date, partner, me: S.profile, uid: S.uid, store: S.store, now: clock.now(),
    portrait: portraitText(partner),
    refresh: () => refresh(true),
    nextMatch: (o) => nextMatch(o),
  };
}

// ---------- Démarrage ----------
async function boot() {
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  try {
    S.store = await createStore();
    ({ userId: S.uid } = await S.store.init());
    S.profile = await S.store.getProfile();
    if (!S.profile) return showWelcome();
    await route({ autoOpen: true });
  } catch (e) {
    console.error(e);
    root.replaceChildren(h('main', { class: 'screen' },
      h('div', { class: 'eyebrow' }, 'Un souci'), h('h1', { class: 'title' }, 'Oups'),
      h('div', { class: 'body' }, h('p', {}, 'Impossible de démarrer. Vérifie ta connexion et réessaie.'), h('p', { class: 'small' }, String(e.message || e))),
      h('div', { class: 'spacer' }), button('Réessayer', () => location.reload())));
  }
}

async function route({ autoOpen = false } = {}) {
  S.data = await S.store.getDate();
  if (!S.data) return showSearch();
  sync();
  if (autoOpen) {
    const s = seen();
    const fresh = unlocked(S.data.date, S.uid).filter((m) => !s.has(m.key));
    if (fresh.length) return showCard(fresh[fresh.length - 1].key);
  }
  showFeed();
}

// Signature : change quand une carte se débloque ou qu'une réponse arrive.
function signature() {
  if (!S.data) return 'none';
  return JSON.stringify([unlocked(S.data.date, S.uid).map((m) => m.key), S.data.date.answers, isDuringDate(S.data.date)]);
}

function sync() {
  const list = unlocked(S.data.date, S.uid);
  notifyNew(S.data.date.id, list, { silentFirst: true });
  const s = seen();
  setBadge(list.filter((m) => !s.has(m.key)).length);
  S.sig = signature();
}

let lastPoll = 0;
async function tick() {
  if (S.view === 'feed') updateCountdown();
  const every = IS_REMOTE ? 15000 : 2000;
  if (Date.now() - lastPoll < every || document.hidden) return;
  lastPoll = Date.now();
  if (S.view === 'search') return trySearch();
  if (S.view === 'feed' || S.view === 'card') refresh();
}

async function refresh(force = false) {
  if (!S.store || !S.profile) return;
  try {
    const data = await S.store.getDate();
    if (!data) { if (S.view === 'feed' || S.view === 'card') showSearch(); return; }
    S.data = data;
    const before = S.sig;
    sync();
    const busy = document.querySelector('.sheet-wrap') || document.activeElement?.matches?.('input, textarea');
    if ((force || before !== S.sig) && !busy) {
      if (S.view === 'card') showCard(S.cardKey, { keepScroll: true });
      else if (S.view === 'feed') showFeed({ keepScroll: true });
    }
  } catch (e) { console.warn(e); }
}

// ---------- Accueil ----------
function showWelcome() {
  S.view = 'welcome';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  root.replaceChildren(h('main', { class: 'screen' },
    h('div', { class: 'topbar' }, h('div', { class: 'brand' }, logo(), CONFIG.APP_NAME), h('span')),
    h('div', { class: 'eyebrow' }, 'Pas de photo. Pas de swipe.'),
    h('h1', { class: 'title' }, 'Un soir, une personne'),
    h('div', { class: 'meta' }, 'Le reste, je m’en occupe'),
    h('div', { class: 'body' }, h('p', {}, 'Je te présente une seule personne. Vous ne vous voyez pas avant le soir du rendez-vous. Entre-temps, je vous envoie des cartes : un lieu, des règles, un objectif secret, et quatre jeux.')),
    card({ items: ['Tu dresses ton portrait, cinq minutes', 'Je trouve quelqu’un qui te correspond', 'Les cartes arrivent, au bon moment', 'Le soir venu, on joue'] }),
    button('Créer mon portrait', () => showOnboarding()),
    !IS_REMOTE && h('p', { class: 'foot' }, 'Mode solo : la personne en face est simulée, pour tout tester.'),
    !standalone && h('div', { class: 'install' },
      installEvt ? button('Installer l’appli sur mon téléphone', async () => { installEvt.prompt(); installEvt = null; }, 'btn ghost')
        : ios ? 'Pour l’avoir comme une appli : touche Partager, puis « Sur l’écran d’accueil ».'
          : 'Pour l’avoir comme une appli : menu du navigateur, puis « Ajouter à l’écran d’accueil ».'),
  ));
}

function showOnboarding(edit = false) {
  S.view = 'onboarding';
  onboarding(root, {
    initial: edit ? S.profile : null,
    onCancel: edit ? () => route() : () => showWelcome(),
    onDone: async (p) => {
      S.profile = await S.store.saveProfile(p);
      if (edit) { toast('Portrait enregistré.'); return route(); }
      if (notifState() === 'default') await askPermission();
      showSearch();
    },
  });
}

// ---------- Recherche ----------
function showSearch(msg) {
  S.view = 'search';
  const days = (S.profile.availability || []).sort().map((d) => weekday(new Date(2024, 0, 7 + d).getTime())).join(', ');
  const note = h('p', { class: 'small', style: { textAlign: 'center' } }, msg || '');
  root.replaceChildren(h('main', { class: 'screen' },
    topbar(),
    h('div', { class: 'pulse' }, icon('heart')),
    h('div', { class: 'eyebrow', style: { textAlign: 'center' } }, 'Patience'),
    h('h1', { class: 'title', style: { textAlign: 'center', marginBottom: '22px' } }, 'Je cherche'),
    h('div', { class: 'body', style: { textAlign: 'center' } }, h('p', {}, `Quelqu’un qui te ressemble assez, et pas trop. Près de toi, libre ${days || 'un soir'}.`)),
    note,
    h('div', { class: 'spacer' }),
    S.profile.paused && status('Ton profil est en pause.', 'pause'),
  ));
  S.searchNote = note;
  setTimeout(trySearch, IS_REMOTE ? 300 : 2600);
}

async function trySearch() {
  if (S.view !== 'search' || S.searching || S.profile.paused) return;
  S.searching = true;
  try {
    const d = await S.store.findMatch();
    if (d) { await route({ autoOpen: true }); return; }
    if (S.searchNote) S.searchNote.textContent = 'Personne de libre pour l’instant. Je continue à chercher : laisse l’appli ouverte ou reviens plus tard.';
  } catch (e) {
    if (S.searchNote) S.searchNote.textContent = 'Connexion difficile, je réessaie… (' + e.message + ')';
  } finally { S.searching = false; }
}

async function nextMatch({ quiet } = {}) {
  await S.store.closeDate();
  S.data = null;
  if (!quiet) toast('Je te cherche quelqu’un d’autre.');
  showSearch();
}

// ---------- Le fil ----------
function topbar(back) {
  return h('div', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', 'aria-label': 'Retour', onclick: back }, icon('back')) : h('div', { class: 'brand' }, logo(), CONFIG.APP_NAME),
    h('button', { class: 'icon-btn', 'aria-label': 'Menu', onclick: openMenu }, icon('menu')));
}

let cdEl = null;
let cdTarget = 0;
function updateCountdown() {
  if (cdEl && cdTarget) {
    cdEl.textContent = countdown(cdTarget - clock.now());
    if (cdTarget <= clock.now()) { cdTarget = 0; refresh(true); }
  }
}

function showFeed({ keepScroll } = {}) {
  S.view = 'feed';
  const y = window.scrollY;
  const c = ctx();
  const { date } = S.data;
  const list = unlocked(date, S.uid);
  const s = seen();
  const next = nextMoment(date, S.uid);
  const P = forms(S.data.partner?.gender);
  const mine = date.answers?.[S.uid] || {};

  cdEl = h('div', { class: 'cd' });
  cdTarget = next?.at || 0;
  const nextBox = next
    ? h('section', { class: 'next' },
      h('div', { class: 'k' }, 'Prochain message'),
      h('div', { class: 'when' }, `${cap(relDay(next.at, c.now))}, ${hourLabel(next.at)}`),
      cdEl)
    : h('section', { class: 'next' }, h('div', { class: 'k' }, 'Fin du jeu'), h('div', { class: 'when' }, 'Plus de message prévu'));
  updateCountdown();

  const tiles = [...list].reverse().map((m) => {
    const t = TILE[m.key](c);
    const unread = !s.has(m.key);
    const todo = needsAction(m.key, c);
    return h('button', { class: `tile${unread ? ' unread' : ''}${todo ? ' todo' : ''}`, onclick: () => showCard(m.key) },
      h('div', {}, h('div', { class: 'e' }, t.e), h('div', { class: 't' }, t.t)),
      unread ? h('span', { class: 'dot', 'aria-label': 'Nouveau' }) : h('span', { class: 'w' }, todo ? 'À faire' : `${shortDay(m.at, c.now)} ${hourLabel(m.at)}`));
  });

  const during = isDuringDate(date);
  const doneBar = during && mine.objectiveSeen && !mine.done && h('div', { class: 'done-bar' },
    h('div', { class: 'txt' }, 'Ton objectif est atteint ? Écris-moi « fait ».'),
    button('Fait', () => markDone(c)));

  root.replaceChildren(h('main', { class: 'screen plain' },
    topbar(),
    h('div', { class: 'eyebrow' }, S.data.partner ? `Ton date avec ${S.data.partner.firstName}` : 'Ton date'),
    h('h1', { class: 'title', style: { fontSize: '40px', marginBottom: '22px' } }, `${dayLabel(date.dateAt)}`),
    nextBox,
    h('div', { class: 'tiles' }, tiles),
    doneBar,
    demoOn() && demoPanel(),
    h('p', { class: 'foot' }, during ? 'On n’utilise pas son téléphone, sauf pour mes messages.' : `Je t’écris au bon moment. ${P.Il} reçoit les siens en même temps.`),
  ));
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
}

function demoPanel() {
  const { date } = S.data;
  const target = nextJump(date, S.uid);
  return h('section', { class: 'demo' },
    h('div', { class: 'k' }, `Mode démo · il est ${weekday(clock.now())} ${hourLabel(clock.now())}${clock.offset ? ' (simulé)' : ''}`),
    button(h('span', {}, `Avancer à ${relDay(target, clock.now())} ${hourLabel(target)}`), async () => {
      clock.jumpTo(target + 1000);
      await refresh();
      const l = unlocked(S.data.date, S.uid);
      const last = l[l.length - 1];
      if (last && !seen().has(last.key)) showCard(last.key); else showFeed();
    }, 'btn quiet'),
    clock.offset ? button('Revenir au temps réel', () => { clock.reset(); refresh(true); }, 'link') : null);
}

// ---------- Une carte ----------
function showCard(key, { keepScroll } = {}) {
  if (!CARDS[key] || !S.data) return showFeed();
  S.view = 'card';
  S.cardKey = key;
  const y = window.scrollY;
  markSeen(key);
  setBadge(unlocked(S.data.date, S.uid).filter((m) => !seen().has(m.key)).length);
  root.replaceChildren(h('main', { class: 'screen' },
    topbar(() => showFeed()),
    CARDS[key](ctx())));
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
}

// ---------- Menu ----------
function openMenu() {
  const hasDate = !!S.data?.date;
  const notif = notifState();
  sheet((close) => [
    h('h3', {}, CONFIG.APP_NAME),
    h('p', { class: 'sub' }, IS_REMOTE ? `Connecté${forms(S.profile?.gender).e} · ${S.profile?.firstName || ''}` : 'Mode solo · la personne en face est simulée'),
    item('home', 'Le fil', null, () => { close(); route(); }),
    item('user', 'Mon portrait', 'Modifier mes réponses', () => { close(); showOnboarding(true); }),
    item('bell', 'Notifications', notif === 'granted' ? 'Activées' : notif === 'denied' ? 'Bloquées dans les réglages du téléphone' : notif === 'unsupported' ? 'Installe l’appli sur l’écran d’accueil pour les recevoir' : 'Touche pour activer', async () => {
      const r = await askPermission();
      toast(r === 'granted' ? 'Notifications activées.' : 'Notifications non autorisées.');
      close();
    }),
    hasDate && item('cal', 'Rappels dans mon calendrier', 'Chaque message à l’heure exacte, même appli fermée', () => { downloadCalendar(S.data.date, S.uid); close(); }),
    item('clock', 'Mode démo', demoOn() ? 'Activé : tu peux avancer dans le temps' : 'Désactivé', () => { pref.set('demo', !demoOn()); if (!demoOn()) clock.reset(); close(); route(); }),
    hasDate && item('shield', 'Un souci avec ce date ?', 'Annuler, signaler, se protéger', () => { close(); safety(); }),
    item('pause', S.profile?.paused ? 'Reprendre les rencontres' : 'Mettre en pause', 'On ne te proposera plus personne', async () => {
      S.profile = await S.store.saveProfile({ ...S.profile, paused: !S.profile.paused });
      toast(S.profile.paused ? 'En pause.' : 'C’est reparti.');
      close(); route();
    }),
    item('info', 'Comment ça marche', null, () => { close(); about(); }),
    item('trash', 'Supprimer mon compte', 'Efface tout, définitivement', async () => {
      close();
      if (await confirmSheet({ title: 'Tout supprimer ?', sub: 'Ton portrait, tes dates et tes réponses seront effacés.', yes: 'Supprimer définitivement', danger: true })) {
        await S.store.resetAll();
        location.reload();
      }
    }, 'danger'),
  ]);
}

function item(ic, label, desc, onClick, cls = '') {
  return h('button', { class: `menu-item ${cls}`, onclick: onClick }, icon(ic), h('span', {}, label, desc && h('span', { class: 'd' }, desc)));
}

function safety() {
  sheet((close) => {
    let reason = '';
    return [
      h('h3', {}, 'Un souci ?'),
      h('p', { class: 'sub' }, 'Tu n’as pas à te justifier. Ta sécurité passe avant le jeu.'),
      h('div', { class: 'field' }, h('textarea', { class: 'input', placeholder: 'Ce qui s’est passé (facultatif)', oninput: (e) => { reason = e.target.value; } })),
      button('Signaler et annuler le date', async () => {
        await S.store.report(reason || 'Signalement sans détail');
        close();
        toast('Merci. C’est signalé, et le date est annulé.');
        await nextMatch({ quiet: true });
      }),
      button('Juste annuler le date', async () => {
        close();
        if (await confirmSheet({ title: 'Annuler ce date ?', sub: 'L’autre personne sera prévenue que ça n’aura pas lieu.', yes: 'Annuler le date' })) {
          await S.store.answer('accept', false);
          await nextMatch();
        }
      }, 'btn ghost'),
      h('div', { class: 'section-label' }, 'En cas d’urgence'),
      h('div', { class: 'btn-row' },
        h('a', { class: 'btn quiet', href: 'tel:17', style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' } }, 'Police · 17'),
        h('a', { class: 'btn quiet', href: 'tel:112', style: { textAlign: 'center', textDecoration: 'none', lineHeight: '30px' } }, 'Urgences · 112')),
      h('p', { class: 'small', style: { marginTop: '14px' } }, 'Par SMS : 114. Violences : 3919 (gratuit, anonyme).'),
    ];
  });
}

function about() {
  sheet((close) => [
    h('h3', {}, 'Comment ça marche'),
    card({
      items: [
        'Tu dresses ton portrait : physique, style, caractère, ambitions',
        'Je trouve la personne la plus compatible près de toi',
        'Tu lis son portrait, sans photo. Vous dites oui tous les deux',
        'Le reste arrive par cartes : le lieu, sa phrase, les règles, ton objectif secret',
        'Le soir venu : quatre jeux, des paris, et on révèle',
        'Le lendemain, vous dites si vous voulez vous revoir. Seul le « oui » réciproque est révélé',
      ],
    }),
    h('p', { class: 'small' }, 'Rendez-vous toujours dans un lieu public. Tes infos ne servent qu’au matching ; tu peux tout supprimer depuis le menu.'),
    button('Compris', close, 'btn ghost'),
  ]);
}

// ---------- Divers ----------
function logo() {
  const s = document.createElement('span');
  s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="#f0906c" stroke-width="1.3" stroke-dasharray="2.2 2.2"/><path d="M12 17.2s-4.6-2.8-5.7-5.6C5.5 9.6 6.7 7.4 8.9 7.4c1.2 0 2.2.7 3.1 1.8.9-1.1 1.9-1.8 3.1-1.8 2.2 0 3.4 2.2 2.6 4.2-1.1 2.8-5.7 5.6-5.7 5.6z" fill="#f0906c"/></svg>';
  return s.firstChild;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne non dispo */ });
}

boot();
