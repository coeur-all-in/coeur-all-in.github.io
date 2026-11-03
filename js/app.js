// Cœur All In — contrôleur principal.
import { CONFIG, IS_REMOTE } from './config.js';
import { forms, portraitText } from './content.js';
import { askPermission, disablePush, downloadCalendar, enablePush, isIosBrowser, notifOff, notifState, notifyNew, pushSupported, setBadge } from './notify.js';
import { CARDS, TILE, markDone, needsAction } from './screens/cards.js';
import { onboarding } from './screens/onboarding.js';
import { chatListView, chatOpensAt, rdvView, renderMessages, threadView } from './screens/tabs.js';
import { createStore } from './store/index.js';
import { clock, isDuringDate, nextJump, nextMoment, unlocked } from './timeline.js';
import { button, card, confirmSheet, countdown, dayLabel, h, hourLabel, icon, relDay, sheet, shortDay, status, toast, weekday } from './ui.js';

const root = document.getElementById('app');
const S = {
  store: null, uid: null, profile: null, data: null, admin: false,
  view: 'boot', cardKey: null, sig: '', searching: false,
};
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

// Structure d'appli : la page ne défile jamais, seul l'écran (.screen) défile au-dessus de la barre d'onglets.
const scroller = () => root.querySelector(':scope > .screen');
const scrollPos = () => scroller()?.scrollTop || 0;
const setScroll = (y) => { const el = scroller(); if (el) el.scrollTop = y; };

// ---------- Préférences locales ----------
const pref = {
  get(k, d) { try { const v = localStorage.getItem('cai.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cai.' + k, JSON.stringify(v)); } catch { /* rien */ } },
};
const demoOn = () => S.admin && pref.get('demo', !IS_REMOTE);

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
    goTab: (t) => goTab(t),
    adminPreview: demoOn(),
  };
}

// ---------- Démarrage ----------
// Clavier mobile : l'appli prend exactement la hauteur visible, la barre d'écriture reste collée au clavier.
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--app-h', `${Math.round(vv.height)}px`);
    rootStyle.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
    const list = document.querySelector('.thread-list');
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTop = list.scrollHeight;
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

async function boot() {
  fitViewport();
  setInterval(tick, 1000);
  // Comme une vraie appli : pas de zoom (pincement, double-tap) sur la page.
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 320 && !e.target.closest('.map, input, textarea')) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
  // Retour sur l'appli après l'avoir quittée plus de 10 s : on revient sur l'Accueil (sauf en pleine saisie).
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const away = hiddenAt && Date.now() - hiddenAt > 10000;
    hiddenAt = 0;
    const typing = document.querySelector('.sheet-wrap, .duel') || ['onboarding', 'auth', 'splash', 'boot', 'thread', 'notif-gate'].includes(S.view);
    // Appli pas fermée : retour direct à l'Accueil (le cœur ne s'affiche qu'au lancement).
    if (away && !typing && S.store && S.profile) {
      route().catch(() => {});
      return;
    }
    refresh();
  });
  // Le chargement démarre tout de suite, pendant que le cœur bat.
  const ready = prepare();
  ready.catch(() => {});
  showSplash(ready);
}

// Prépare la connexion et renvoie l'écran à afficher après le toucher du cœur.
async function prepare() {
  S.store = await createStore();
  ({ userId: S.uid } = await S.store.init());
  if (S.store.needsAuth) {
    S.store.onAuth((event) => { if (event === 'PASSWORD_RECOVERY' && S.view !== 'splash') showNewPassword(); });
    if (S.store.recovery && S.uid) return () => showNewPassword();
    if (!S.uid) return () => (pref.get('seenWelcome', false) ? showAuth('login') : showWelcome());
  }
  return () => afterLogin();
}

function showSplash(ready) {
  S.view = 'splash';
  let gone = false;
  const enter = async () => {
    if (gone) return;
    gone = true;
    heart.classList.add('burst');
    navigator.vibrate?.(15);
    await new Promise((r) => setTimeout(r, 380));
    try {
      const next = await ready;
      await next();
    } catch (e) {
      console.error(e);
      root.replaceChildren(h('main', { class: 'screen' },
        h('div', { class: 'eyebrow' }, 'Un souci'), h('h1', { class: 'title' }, 'Oups'),
        h('div', { class: 'body' }, h('p', {}, 'Impossible de démarrer. Vérifie ta connexion et réessaie.'), h('p', { class: 'small' }, String(e.message || e))),
        h('div', { class: 'spacer' }), button('Réessayer', () => location.reload())));
    }
  };
  const heart = h('button', { class: 'pulse splash-heart', type: 'button', 'aria-label': 'Entrer dans Cœur All In', onclick: enter }, icon('heart'));
  root.replaceChildren(h('main', { class: 'screen splash' },
    h('div', { class: 'splash-center' },
      heart,
      h('div', { class: 'brand splash-brand' }, CONFIG.APP_NAME),
      h('p', { class: 'splash-hint' }, 'Touche le cœur'))));
}

// En ligne, l'horloge suit l'avance du date (mode démo partagé par les deux personnes).
function syncClock() {
  if (IS_REMOTE) clock.setShared(S.data?.date?.demoOffset || 0);
}

async function route({ autoOpen = false } = {}) {
  S.data = await S.store.getDate();
  syncClock();
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
let lastChatPoll = 0;
async function tick() {
  if (S.view === 'feed') updateCountdown();
  document.querySelectorAll('[data-countdown]').forEach((el) => { el.textContent = countdown(Number(el.dataset.countdown) - clock.now()); });
  if (S.view === 'thread' && Date.now() - lastChatPoll > (IS_REMOTE ? 3000 : 1500) && !document.hidden) { lastChatPoll = Date.now(); pollChat(); }
  const every = IS_REMOTE ? (S.view === 'search' ? 8000 : 15000) : 2000;
  if (Date.now() - lastPoll < every || document.hidden) return;
  lastPoll = Date.now();
  if (S.view === 'search') return trySearch();
  if (['feed', 'card', 'rdv', 'chat', 'thread'].includes(S.view)) refresh();
}

async function refresh(force = false) {
  if (!S.store || !S.profile) return;
  try {
    const data = await S.store.getDate();
    if (!data) { if (['feed', 'card'].includes(S.view)) showSearch(); S.data = null; return; }
    S.data = data;
    syncClock();
    const before = S.sig;
    sync();
    const busy = document.querySelector('.sheet-wrap') || document.activeElement?.matches?.('input, textarea');
    if ((force || before !== S.sig) && !busy) {
      if (S.view === 'card') showCard(S.cardKey, { keepScroll: true });
      else if (S.view === 'feed') showFeed({ keepScroll: true });
      else if (S.view === 'rdv') showRdv({ keepScroll: true });
      else if (S.view === 'chat') showChat({ still: true });
      else if (S.view === 'thread' && S.chatRendered !== chatOpen()) showThread();
    }
    if (S.chatPolledAt === undefined || Date.now() - S.chatPolledAt > 14000) { S.chatPolledAt = Date.now(); if (S.view !== 'thread') await loadMessages(); }
    updateChatBadge();
  } catch (e) { console.warn(e); }
}

async function afterLogin() {
  S.profile = await S.store.getProfile();
  S.admin = await S.store.isAdmin?.() || false;
  if (!S.admin) clock.reset();
  if (S.profile) enablePush(S.store, { silent: true }); // resynchronise l'abonnement si déjà autorisé
  if (!S.profile) return S.store.needsAuth ? showOnboarding() : showWelcome();
  if (needsNotifGate()) return showNotifGate(() => route({ autoOpen: true }));
  await route({ autoOpen: true });
}

// ---------- Compte : inscription / connexion ----------
function showAuth(mode = 'signup') {
  S.view = 'auth';
  pref.set('seenWelcome', true);
  const signup = mode === 'signup';
  const st = { email: '', password: '' };
  const err = h('div', { class: 'error', role: 'alert' });
  const pw = h('input', {
    class: 'input', type: 'password', autocomplete: signup ? 'new-password' : 'current-password', minlength: 8,
    placeholder: signup ? '8 caractères minimum' : 'Ton mot de passe', oninput: (e) => { st.password = e.target.value; },
  });
  const toggle = h('button', { type: 'button', class: 'link', style: { margin: '6px 0 0', padding: '4px 0' },
    onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; toggle.textContent = pw.type === 'password' ? 'Afficher le mot de passe' : 'Masquer le mot de passe'; } },
  'Afficher le mot de passe');
  const submit = button(signup ? 'Créer mon compte' : 'Me connecter', go);
  async function go() {
    err.textContent = '';
    const mail = st.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { err.textContent = 'Adresse e-mail invalide.'; return; }
    if (st.password.length < 8) { err.textContent = 'Mot de passe trop court (8 caractères minimum).'; return; }
    submit.disabled = true;
    try {
      if (signup) {
        const r = await S.store.signUp(mail, st.password);
        if (r.confirmEmail) return showCheckEmail(mail);
      } else {
        await S.store.signIn(mail, st.password);
      }
      ({ userId: S.uid } = await S.store.init());
      await afterLogin();
    } catch (e) {
      err.textContent = e.message;
      submit.disabled = false;
    }
  }
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); go(); } },
    h('div', { class: 'field' }, h('label', {}, 'Ton e-mail'),
      h('input', { class: 'input', type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', placeholder: 'prenom@exemple.fr', oninput: (e) => { st.email = e.target.value; } })),
    h('div', { class: 'field' }, h('label', {}, signup ? 'Choisis un mot de passe' : 'Mot de passe'), pw, toggle),
    err, submit);
  root.replaceChildren(h('main', { class: 'screen' },
    h('div', { class: 'topbar' }, h('div', { class: 'brand' }, logo(), CONFIG.APP_NAME), h('span')),
    h('div', { class: 'eyebrow' }, signup ? 'Bienvenue' : 'Te revoilà'),
    h('h1', { class: 'title', style: { marginBottom: '26px' } }, signup ? 'Créer un compte' : 'Connexion'),
    form,
    !signup && button('Mot de passe oublié ?', () => forgotPassword(st.email), 'link'),
    h('div', { class: 'spacer' }),
    h('p', { class: 'foot' }, signup ? 'Déjà un compte ?' : 'Pas encore de compte ?'),
    button(signup ? 'Me connecter' : 'Créer un compte', () => showAuth(signup ? 'login' : 'signup'), 'btn ghost'),
    signup && h('p', { class: 'foot' }, 'En créant un compte, tu confirmes avoir 18 ans ou plus.'),
  ));
}

function showCheckEmail(mail) {
  S.view = 'auth';
  root.replaceChildren(h('main', { class: 'screen' },
    h('div', { class: 'topbar' }, h('div', { class: 'brand' }, logo(), CONFIG.APP_NAME), h('span')),
    h('div', { class: 'eyebrow' }, 'Presque fini'),
    h('h1', { class: 'title' }, 'Vérifie tes e-mails'),
    h('div', { class: 'body' }, h('p', {}, `Je t’ai envoyé un lien à ${mail}. Clique dessus, puis reviens te connecter.`)),
    h('div', { class: 'spacer' }),
    button('Me connecter', () => showAuth('login'))));
}

function forgotPassword(prefill = '') {
  sheet((close) => {
    let mail = prefill;
    const err = h('div', { class: 'error' });
    return [
      h('h3', {}, 'Mot de passe oublié'),
      h('p', { class: 'sub' }, 'Je t’envoie un lien pour en choisir un nouveau.'),
      h('div', { class: 'field' }, h('input', { class: 'input', type: 'email', value: prefill, placeholder: 'Ton e-mail', oninput: (e) => { mail = e.target.value; } })),
      err,
      button('Envoyer le lien', async () => {
        try { await S.store.resetPassword(mail.trim().toLowerCase()); close(); toast('Lien envoyé. Regarde tes e-mails (et les spams).'); }
        catch (e) { err.textContent = e.message; }
      }),
    ];
  });
}

function showNewPassword() {
  S.view = 'auth';
  let pw = '';
  const err = h('div', { class: 'error' });
  root.replaceChildren(h('main', { class: 'screen' },
    h('div', { class: 'topbar' }, h('div', { class: 'brand' }, logo(), CONFIG.APP_NAME), h('span')),
    h('div', { class: 'eyebrow' }, 'Sécurité'),
    h('h1', { class: 'title', style: { marginBottom: '26px' } }, 'Nouveau mot de passe'),
    h('div', { class: 'field' }, h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: '8 caractères minimum', oninput: (e) => { pw = e.target.value; } })),
    err,
    h('div', { class: 'spacer' }),
    button('Enregistrer', async () => {
      if (pw.length < 8) { err.textContent = 'Mot de passe trop court (8 caractères minimum).'; return; }
      try { await S.store.updatePassword(pw); toast('Mot de passe changé.'); await afterLogin(); }
      catch (e) { err.textContent = e.message; }
    })));
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
    S.store?.needsAuth
      ? [button('Créer un compte', () => showAuth('signup')), button('J’ai déjà un compte', () => showAuth('login'), 'link')]
      : button('Créer mon portrait', () => showOnboarding()),
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
    onCancel: edit ? () => route() : async () => {
      if (!S.store.needsAuth) return showWelcome();
      if (await confirmSheet({ title: 'Te déconnecter ?', sub: 'Ton portrait n’est pas encore enregistré.', yes: 'Me déconnecter', no: 'Continuer mon portrait' })) {
        await S.store.signOut(); S.uid = null; showAuth('login');
      }
    },
    onDone: async (p) => {
      S.profile = await S.store.saveProfile(p);
      if (edit) { toast('Portrait enregistré.'); return route(); }
      showNotifGate(() => showSearch());
    },
  });
}

// Bandeau « Active les notifications » tant que ce n'est pas fait.
function pushBanner() {
  if (!S.store?.pushKey) return null;
  const st = notifState();
  if (st === 'granted' || st === 'denied') return null;
  const ios = isIosBrowser();
  return h('div', { class: 'install', style: { marginTop: '18px' } },
    h('p', { style: { margin: '0 0 10px' } }, ios
      ? 'Pour être prévenu·e même appli fermée : installe l’appli (Partager → « Sur l’écran d’accueil »), puis ouvre-la depuis l’icône.'
      : 'Active les notifications pour être prévenu·e du match et de chaque carte, même appli fermée.'),
    !ios && button('Activer les notifications', async (e) => {
      const r = await enablePush(S.store, { ask: true });
      toast(r === 'ok' ? 'Notifications activées.' : r === 'denied' ? 'Refusées. Réactive-les dans les réglages du téléphone.' : 'Pas encore possible, réessaie dans une minute.');
      if (r === 'ok' || r === 'denied') e.target.closest('.install')?.remove();
    }, 'btn quiet'));
}

// ---------- Admin : choisir son match (démo à deux) ----------
function pickMatch() {
  sheet((close) => {
    const box = h('div', {}, h('p', { class: 'small' }, 'Chargement…'));
    S.store.adminListUsers().then((users) => {
      if (!users.length) { box.replaceChildren(h('p', { class: 'small' }, 'Aucun autre compte pour l’instant.')); return; }
      box.replaceChildren(h('div', { class: 'convs' }, users.map((u) => h('button', {
        class: 'conv old', type: 'button',
        onclick: async () => {
          if (!(await confirmSheet({ title: `Matcher avec ${u.name} ?`, sub: 'Vos dates en cours seront refermés. Le nouveau date commence tout de suite pour vous deux.', yes: 'Créer le date' }))) return;
          close();
          try { await S.store.adminMatchWith(u.id); toast(`Date créé avec ${u.name}.`); await route({ autoOpen: true }); }
          catch (e) { toast(e.message); }
        },
      }, avatarOf(u.name), h('div', { class: 'conv-main' },
        h('div', { class: 'conv-top' }, h('span', { class: 'conv-name' }, u.name), u.busy ? h('span', { class: 'conv-time' }, 'en date') : null),
        h('div', { class: 'conv-bottom' }, h('span', { class: 'conv-preview' }, [u.email, u.city].filter(Boolean).join(' · '))))))));
    }).catch((e) => box.replaceChildren(h('p', { class: 'small' }, e.message)));
    return [h('h3', {}, 'Choisir mon match'), h('p', { class: 'sub' }, 'Mode démo (admin) : pour tester à deux, avec ton acolyte.'), box];
  });
}
const avatarOf = (name) => h('div', { class: 'avatar' }, h('span', {}, (name || '?').charAt(0).toUpperCase()));

// ---------- Diagnostic (admin) : pourquoi les notifications / cartes n'arrivent pas ----------
async function diagnostics() {
  sheet((close) => {
    const box = h('div', {}, h('p', { class: 'small' }, 'Vérification…'));
    const row = (ok, label, hint) => h('div', { class: 'diag' },
      h('span', { class: `diag-dot ${ok === true ? 'ok' : ok === false ? 'ko' : 'na'}` }, ok === true ? '✓' : ok === false ? '✗' : '–'),
      h('div', {}, h('div', { class: 'diag-label' }, label), hint && h('div', { class: 'small' }, hint)));
    (async () => {
      const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
      const sub = await reg?.pushManager?.getSubscription().catch(() => null);
      let d = null; let err = null;
      try { d = await S.store.adminDiagnostics(); } catch (e) { err = e.message; }
      const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      const resp = d?.function_responses?.[0];
      const runs = d?.cron_runs || [];
      const failedRun = runs.find((r) => r.status === 'failed');
      const date = S.data?.date;
      box.replaceChildren(h('div', {},
        h('div', { class: 'section-label', style: { marginTop: 0 } }, 'Ce téléphone'),
        row(standalone || !/iphone|ipad/i.test(navigator.userAgent), 'Appli installée sur l’écran d’accueil', 'Obligatoire sur iPhone pour les notifications.'),
        row(notifState() === 'granted', `Permission notifications : ${notifState()}`, notifState() === 'granted' ? null : 'Autorise-les (☰ → Notifications).'),
        row(!notifOff(), 'Notifications non coupées dans l’appli', notifOff() ? 'Réactive-les dans ☰ → Notifications.' : null),
        row(!!sub, 'Téléphone abonné aux notifications', sub ? null : 'Touche « Réabonner ce téléphone » ci-dessous.'),
        h('div', { class: 'section-label' }, 'Serveur (Supabase)'),
        err ? row(false, 'Diagnostic serveur indisponible', `${err}. Relance le script SQL.`) : [
          row(d.demo_column, 'Script SQL à jour', d.demo_column ? null : 'Relance supabase/schema.sql dans SQL Editor.'),
          row(d.pg_cron, 'Extension pg_cron', d.pg_cron ? null : 'Database → Extensions → pg_cron, puis relance le script.'),
          row(d.pg_net, 'Extension pg_net', d.pg_net ? null : 'Database → Extensions → pg_net, puis relance le script.'),
          row((d.cron_jobs || []).length >= 2, `Tâches planifiées : ${(d.cron_jobs || []).map((j) => j.job).join(', ') || 'aucune'}`, (d.cron_jobs || []).length >= 2 ? null : 'Relance le script après avoir activé pg_cron et pg_net.'),
          failedRun ? row(false, `Dernière exécution en échec (${failedRun.job})`, failedRun.message) : row(runs.length ? true : null, runs.length ? 'Tâches exécutées récemment' : 'Pas encore d’exécution'),
          row(resp ? resp.status_code === 200 : null, resp ? `Fonction push : réponse ${resp.status_code}` : 'Fonction push : aucune réponse encore',
            !resp ? 'Attends 1 minute après avoir lancé le script.'
              : resp.status_code === 404 ? 'La fonction « push » n’est pas déployée (Edge Functions → Deploy, nom exact : push).'
                : resp.status_code === 401 ? 'Désactive « Enforce JWT Verification » dans les réglages de la fonction push.'
                  : resp.status_code >= 500 ? `Erreur dans la fonction : ${resp.body || ''}` : null),
          row(d.vapid, 'Clés de notification générées', d.vapid ? null : 'Elles se créent au premier appel réussi de la fonction push.'),
          row(d.my_subscriptions > 0, `Mes abonnements enregistrés : ${d.my_subscriptions} (total : ${d.all_subscriptions})`, d.my_subscriptions > 0 ? null : 'Réabonne ce téléphone.'),
          row(d.last_push ? true : null, d.last_push ? `Dernier envoi : ${hourLabel(Date.parse(d.last_push))} (${d.pushes_last_hour} dans l’heure)` : 'Aucune notification envoyée pour l’instant'),
        ],
        date && [h('div', { class: 'section-label' }, 'Date en cours'),
          row(true, `Avance du temps partagée : ${date.demoOffset ? `${Math.round(date.demoOffset / 3600000)} h` : 'aucune (temps réel)'}`),
          row(true, `Heure simulée : ${weekday(clock.now())} ${hourLabel(clock.now())}`)],
        h('div', { style: { height: '14px' } }),
        button('Réabonner ce téléphone', async () => {
          const r = await enablePush(S.store, { ask: true });
          toast(r === 'ok' ? 'Téléphone abonné.' : `Échec : ${r}`);
          close(); diagnostics();
        }, 'btn quiet'),
        h('div', { style: { height: '8px' } }),
        button('Envoyer une notification test', async () => {
          try { const n = await S.store.adminTestPush(); toast(`Test envoyé à ${n} personne${n > 1 ? 's' : ''} : arrive en moins d’1 minute.`); }
          catch (e) { toast(e.message); }
        }),
      ));
    })();
    return [h('h3', {}, 'Diagnostic'), h('p', { class: 'sub' }, 'Chaque ligne rouge dit quoi corriger. Fais-le aussi sur le téléphone de ton match.'), box];
  });
}

// ---------- Activation des notifications (obligatoire après la création du compte) ----------
function needsNotifGate() {
  if (notifOff()) return false;                    // coupées volontairement dans les réglages
  if (!pushSupported() && !isIosBrowser()) return false; // navigateur incapable : on ne bloque pas
  return notifState() !== 'granted' || isIosBrowser();
}

function showNotifGate(next) {
  if (!needsNotifGate()) return next();
  S.view = 'notif-gate';
  const ios = isIosBrowser();
  const denied = notifState() === 'denied';
  const err = h('p', { class: 'small', style: { textAlign: 'center', minHeight: '1em' } });
  const steps = ios
    ? ['Touche le bouton Partager de Safari (le carré avec une flèche)', 'Choisis « Sur l’écran d’accueil », puis « Ajouter »', 'Ouvre Cœur All In depuis la nouvelle icône : je te redemanderai les notifications']
    : denied
      ? ['Ouvre les réglages de ton navigateur ou de ton téléphone', 'Notifications → Cœur All In (ou coeur-all-in.github.io)', 'Autorise, puis reviens ici']
      : ['Touche « Activer les notifications »', 'Accepte la demande de ton téléphone', 'C’est tout : je te préviens au bon moment'];
  root.replaceChildren(h('main', { class: 'screen' },
    h('div', { class: 'spacer' }),
    h('div', { class: 'pulse', style: { margin: '10px auto 26px' } }, icon('bell')),
    h('div', { class: 'eyebrow', style: { alignSelf: 'center' } }, 'Indispensable'),
    h('h1', { class: 'title', style: { textAlign: 'center', fontSize: '42px' } }, 'Active les notifications'),
    h('div', { class: 'body', style: { textAlign: 'center' } }, h('p', {}, 'Tout le jeu passe par elles : le match, le lieu, ton objectif secret, les quatre jeux de la soirée. Sans elles, tu rates les messages.')),
    card({ items: steps }),
    err,
    !ios && !denied && button('Activer les notifications', async () => {
      const r = await enablePush(S.store, { ask: true });
      if (r === 'ok' || notifState() === 'granted') { toast('Notifications activées.'); next(); return; }
      err.textContent = r === 'denied' ? 'Refusées. Suis les étapes ci-dessus pour les réactiver.' : 'Pas encore possible, réessaie dans une minute.';
      if (r === 'denied') showNotifGate(next);
    }),
    denied && button('J’ai autorisé, continuer', () => (notifState() === 'granted' ? (enablePush(S.store, { ask: true }), next()) : (err.textContent = 'Toujours bloquées pour l’instant.'))),
    button(ios || denied ? 'Continuer sans (déconseillé)' : 'Plus tard (déconseillé)', () => next(), 'link'),
  ));
}

// Réglages des notifications (menu) : activer / couper.
function notifSettings() {
  sheet((close) => {
    const box = h('div', {});
    const render = () => {
      const on = notifState() === 'granted' && !notifOff();
      box.replaceChildren(
        h('label', { class: 'switch-row' },
          h('span', {}, h('strong', {}, 'Notifications'), h('span', { class: 'd' }, on ? 'Activées : le match, chaque carte, chaque message' : 'Coupées sur ce téléphone')),
          h('input', { type: 'checkbox', class: 'switch', checked: on, onchange: async (e) => {
            if (e.target.checked) {
              const r = await enablePush(S.store, { ask: true });
              if (r !== 'ok' && notifState() !== 'granted') toast(isIosBrowser() ? 'Sur iPhone : installe d’abord l’appli sur l’écran d’accueil.' : 'Autorise les notifications dans les réglages du téléphone.');
            } else {
              await disablePush(S.store);
              toast('Notifications coupées.');
            }
            render();
          } })),
        notifState() === 'denied' && h('p', { class: 'small' }, 'Elles sont bloquées par ton téléphone : réglages → notifications → Cœur All In.'),
      );
    };
    render();
    return [h('h3', {}, 'Notifications'), h('p', { class: 'sub' }, 'Tu peux les couper à tout moment. Sans elles, ouvre l’appli régulièrement pour ne rien rater.'), box];
  });
}

// ---------- Recherche ----------
// Paliers de la recherche progressive (mêmes seuils que supabase/schema.sql).
const STEPS = [
  { at: 0, label: 'Précise' },
  { at: 1, label: '1 min' },
  { at: 3, label: '3 min' },
  { at: 7, label: '7 min' },
  { at: 15, label: '15 min' },
];

function showSearch() {
  S.view = 'search';
  S.searchBox = h('div', {});
  root.replaceChildren(h('main', { class: 'screen' },
    topbar(),
    h('div', { class: 'pulse' }, icon('heart')),
    h('div', { class: 'eyebrow', style: { alignSelf: 'center' } }, 'Recherche en cours'),
    h('h1', { class: 'title', style: { textAlign: 'center', marginBottom: '14px' } }, 'Je cherche'),
    h('div', { class: 'body', style: { textAlign: 'center' } },
      h('p', {}, 'Je commence exigeant, puis j’élargis minute après minute. Au bout de 15 minutes, je te présente la première personne disponible.')),
    S.searchBox,
    demoOn() && h('section', { class: 'demo' },
      h('div', { class: 'k' }, 'Mode démo (admin)'),
      button('Choisir mon match', () => pickMatch(), 'btn quiet'),
      h('div', { style: { height: '8px' } }),
      S.store.adminSkipSearch && button('Recherche large maintenant', async () => {
        await S.store.adminSkipSearch();
        toast('Recherche ouverte à tout le monde.');
        await trySearch();
      }, 'btn quiet')),
    pushBanner(),
    h('div', { class: 'spacer' }),
    S.profile.paused ? status('Ton profil est en pause. Menu ☰ → Reprendre.', 'pause')
      : h('p', { class: 'foot' }, IS_REMOTE ? 'Tu peux fermer l’appli : je continue de chercher.' : 'Mode solo : la personne en face est simulée.'),
    tabbar('home'),
  ));
  renderSearch(S.lastSearch);
  setTimeout(trySearch, IS_REMOTE ? 300 : 2600);
}

function renderSearch(info) {
  if (!S.searchBox || !info || info.level == null) return;
  const lvl = Number(info.level) || 0;
  const p = S.profile;
  const mins = info.since ? (Date.now() - Date.parse(info.since)) / 60000 : 0;
  const next = STEPS[lvl + 1];
  const left = next ? Math.max(1, Math.round(next.at - mins)) : 0;
  const leftTxt = left >= 60 ? `${Math.round(left / 60)} h` : `${left} min`;
  S.searchBox.replaceChildren(
    h('div', { class: 'progress', style: { margin: '18px 0 6px' } }, STEPS.map((_, k) => h('i', { class: k <= lvl ? 'on' : '' }))),
    h('div', { class: 'range-row', style: { marginBottom: '14px' } }, h('span', {}, 'Précise'), h('span', {}, 'Large')),
    h('ol', { class: 'list' },
      [
        info.km == null ? 'Toutes distances' : `Jusqu’à ${info.km} km de toi`,
        lvl >= 4 ? 'Tous les âges (18 ans et plus)' : `Entre ${Math.max(18, p.ageMin - info.age_pad)} et ${p.ageMax + info.age_pad} ans`,
        info.min_score > 0 ? `Compatibilité d’au moins ${info.min_score} %` : 'Toutes les compatibilités',
        lvl < 2 ? 'Un soir libre en commun' : 'N’importe quel soir (samedi par défaut)',
      ].map((t, i) => h('li', {}, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), h('span', {}, t)))),
    h('p', { class: 'small', style: { textAlign: 'center', marginTop: '12px' } },
      [info.waiting > 0 ? `${info.waiting} personne${info.waiting > 1 ? 's' : ''} qui pourrai${info.waiting > 1 ? 'ent' : 't'} te correspondre cherche${info.waiting > 1 ? 'nt' : ''} aussi.` : 'Personne d’autre ne cherche pour l’instant. Parle de l’appli autour de toi !',
        next ? ` J’élargis dans ${leftTxt}.` : ' Recherche ouverte à tout le monde : le premier qui arrive, c’est pour toi.'].join('')),
  );
}

async function trySearch() {
  if (S.view !== 'search' || S.searching || S.profile.paused) return;
  S.searching = true;
  try {
    const r = await S.store.findMatch();
    if (r?.date) { S.lastSearch = null; await route({ autoOpen: true }); return; }
    S.lastSearch = r?.search;
    renderSearch(S.lastSearch);
  } catch (e) {
    if (S.searchBox) S.searchBox.replaceChildren(h('p', { class: 'small', style: { textAlign: 'center' } }, 'Connexion difficile, je réessaie… (' + e.message + ')'));
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
  const y = scrollPos();
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

  root.replaceChildren(h('main', { class: `screen plain${keepScroll ? ' still' : ''}` },
    topbar(),
    h('div', { class: 'eyebrow' }, S.data.partner ? `Ton date avec ${S.data.partner.firstName}` : 'Ton date'),
    h('h1', { class: 'title', style: { fontSize: '40px', marginBottom: '22px' } }, `${dayLabel(date.dateAt)}`),
    nextBox,
    pushBanner(),
    h('div', { class: 'tiles', style: { marginTop: '18px' } }, tiles),
    doneBar,
    demoOn() && demoPanel(),
    h('p', { class: 'foot' }, during ? 'On n’utilise pas son téléphone, sauf pour mes messages.' : `Je t’écris au bon moment. ${P.Il} reçoit les siens en même temps.`),
    h('div', { class: 'spacer' }),
    tabbar('home'),
  ));
  setScroll(keepScroll ? y : 0);
}

function demoPanel() {
  const { date } = S.data;
  const target = nextJump(date, S.uid);
  return h('section', { class: 'demo' },
    h('div', { class: 'k' }, `Mode démo · il est ${weekday(clock.now())} ${hourLabel(clock.now())}${clock.offset ? ' (simulé)' : ''}`),
    button(h('span', {}, `Avancer à ${relDay(target, clock.now())} ${hourLabel(target)}`), async () => {
      if (S.store.setDemoOffset) {
        try { await S.store.setDemoOffset(target + 1000 - Date.now()); } // partagé avec ton match
        catch (e) {
          toast('Impossible d’avancer le temps côté serveur : relance le script SQL (voir ☰ → Diagnostic).');
          console.warn(e);
          return;
        }
      } else clock.jumpTo(target + 1000);
      await refresh();
      const l = unlocked(S.data.date, S.uid);
      const last = l[l.length - 1];
      if (last && !seen().has(last.key)) showCard(last.key); else showFeed();
    }, 'btn quiet'),
    clock.offset ? button('Revenir au temps réel', async () => {
      if (S.store.setDemoOffset) await S.store.setDemoOffset(null); else clock.reset();
      await refresh(true);
    }, 'link') : null,
    S.store.setDemoOffset && h('p', { class: 'small', style: { marginTop: '8px' } }, 'Le temps avance aussi pour ton match : mêmes cartes, mêmes notifications.'));
}

// ---------- Une carte ----------
function showCard(key, { keepScroll } = {}) {
  if (!CARDS[key] || !S.data) return showFeed();
  S.view = 'card';
  S.cardKey = key;
  const y = scrollPos();
  markSeen(key);
  setBadge(unlocked(S.data.date, S.uid).filter((m) => !seen().has(m.key)).length);
  root.replaceChildren(h('main', { class: `screen${keepScroll ? ' still' : ''}` },
    topbar(() => showFeed()),
    CARDS[key](ctx()),
    tabbar('home')));
  setScroll(keepScroll ? y : 0);
}

// ---------- Onglets : Accueil, Rendez-vous, Discussion ----------
function tabbar(active) {
  const tab = (id, label, ic) => h('button', {
    class: `tab${active === id ? ' on' : ''}`, type: 'button', 'aria-current': active === id ? 'page' : null,
    onclick: () => goTab(id),
  }, icon(ic), h('span', {}, label), id === 'chat' && h('span', { class: 'badge', id: 'chat-badge', hidden: true }));
  const bar = h('nav', { class: 'tabbar', 'aria-label': 'Navigation' }, tab('home', 'Accueil', 'home'), tab('rdv', 'Rendez-vous', 'cal'), tab('chat', 'Discussion', 'chat'));
  // La barre est sortie de l'écran animé : elle reste parfaitement fixe d'un onglet à l'autre.
  queueMicrotask(() => { if (bar.isConnected) root.append(bar); updateChatBadge(); });
  return bar;
}

function goTab(id) {
  if (id === 'thread') return showThread();
  if (id === 'rdv') return showRdv();
  if (id === 'chat') return showChat();
  return S.data ? showFeed() : showSearch();
}

function showRdv({ keepScroll } = {}) {
  S.view = 'rdv';
  const y = scrollPos();
  root.replaceChildren(h('main', { class: `screen${keepScroll ? ' still' : ''}` },
    topbar(),
    rdvView(S.data ? ctx() : null),
    h('div', { class: 'spacer' }),
    tabbar('rdv')));
  setScroll(keepScroll ? y : 0);
}

const chatOpen = () => {
  const d = S.data?.date;
  if (!d) return false;
  const a = d.answers || {};
  const accepted = Object.values(a).filter((x) => x?.accept === true).length === 2;
  // Mode démo (admin) : discussion ouverte tout de suite pour tester.
  return accepted && (demoOn() || clock.now() >= chatOpensAt(d));
};
const chatSeenKey = () => `chatSeen.${S.data?.date?.id}`;

function updateChatBadge() {
  const el = document.getElementById('chat-badge');
  if (!el) return;
  const n = Math.max(0, (S.messages || []).filter((m) => m.from !== S.uid).length - pref.get(chatSeenKey(), 0));
  el.hidden = !n;
  el.textContent = n > 9 ? '9+' : String(n);
}

async function loadMessages() {
  S.messages = chatOpen() ? await S.store.getMessages().catch(() => S.messages || []) : [];
  return S.messages;
}

// Onglet Discussion : liste des conversations (en cours en haut, anciennes en dessous).
async function showChat({ still } = {}) {
  S.view = 'chat';
  S.chatRendered = chatOpen();
  const messages = await loadMessages();
  const past = await S.store.getPastChats?.().catch(() => []) || [];
  if (S.view !== 'chat') return;
  S.past = past;
  const rows = [];
  const d = S.data;
  if (d?.partner) {
    const accepted = Object.values(d.date.answers || {}).filter((x) => x?.accept === true).length === 2;
    const last = messages[messages.length - 1];
    const opens = chatOpensAt(d.date);
    const unread = Math.max(0, messages.filter((m) => m.from !== S.uid).length - pref.get(chatSeenKey(), 0));
    rows.push({
      id: 'current', current: true, name: d.partner.firstName, unread,
      locked: !chatOpen(),
      at: last?.at || null,
      preview: !accepted ? 'S’ouvre 1 h avant votre rendez-vous'
        : !chatOpen() ? `S’ouvre ${relDay(opens, clock.now())} à ${hourLabel(opens)}`
          : last ? `${last.from === S.uid ? 'Toi : ' : ''}${last.body}` : 'Dis-lui que tu es en route 👋',
    });
  }
  for (const t of past) {
    const last = t.messages[t.messages.length - 1];
    rows.push({ id: t.dateId, name: t.name, at: last.at, preview: `${last.from === S.uid ? 'Toi : ' : ''}${last.body}`, past: t });
  }
  root.replaceChildren(h('main', { class: `screen${still ? ' still' : ''}` },
    topbar(),
    chatListView(rows, (r) => (r.current ? showThread() : openPastThread(r.past))),
    h('div', { class: 'spacer' }),
    tabbar('chat')));
}

// Conversation en cours, plein écran.
async function showThread() {
  S.view = 'thread';
  S.chatRendered = chatOpen();
  const d = S.data;
  if (!d?.partner) return showChat();
  const messages = await loadMessages();
  pref.set(chatSeenKey(), messages.filter((m) => m.from !== S.uid).length);
  const open = chatOpen();
  const opens = chatOpensAt(d.date);
  root.replaceChildren(threadView({
    name: d.partner.firstName,
    sub: demoOn() && clock.now() < chatOpensAt(d.date) ? 'Aperçu admin · ouverte avant l’heure (mode démo)' : `Votre date · ${weekday(d.date.dateAt)} 20h`,
    messages, uid: S.uid,
    onBack: () => showChat(),
    onSend: open ? async (body) => {
      const list = document.querySelector('.thread-list');
      // Affichage immédiat (optimiste), puis synchronisation.
      S.messages = [...(S.messages || []), { id: `tmp${Date.now()}`, from: S.uid, body, at: clock.now(), pending: true }];
      renderMessages(list, S.messages, S.uid);
      list.scrollTop = list.scrollHeight;
      try { await S.store.sendMessage(body); }
      catch (e) { toast(/row-level|policy/i.test(e.message) ? 'La discussion n’est pas encore ouverte.' : e.message); }
      await pollChat(true);
    } : null,
    lockedText: open ? '' : `La discussion s’ouvre ${relDay(opens, clock.now())} à ${hourLabel(opens)}, 1 h avant votre rendez-vous.`,
  }));
  const list = document.querySelector('.thread-list');
  list.scrollTop = list.scrollHeight;
}

async function pollChat(force) {
  if (S.view !== 'thread' || !chatOpen()) return;
  const before = (S.messages || []).filter((m) => !m.pending).length;
  const msgs = await loadMessages();
  const list = document.querySelector('.thread-list');
  if (!list || (!force && msgs.length === before)) return;
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  renderMessages(list, msgs, S.uid);
  pref.set(chatSeenKey(), msgs.filter((m) => m.from !== S.uid).length);
  if (atBottom || force) list.scrollTop = list.scrollHeight;
}

// Ancienne conversation : lecture seule.
function openPastThread(t) {
  S.view = 'past-thread';
  root.replaceChildren(threadView({
    name: t.name, sub: `Date du ${dayLabel(t.dateAt, { capital: false })}`, messages: t.messages, uid: S.uid,
    onBack: () => showChat(), onSend: null, lockedText: 'Ancienne discussion · lecture seule',
  }));
  const list = document.querySelector('.thread-list');
  list.scrollTop = list.scrollHeight;
}

// ---------- Menu ----------
function openMenu() {
  const hasDate = !!S.data?.date;
  const notif = notifState();
  sheet((close) => [
    h('h3', {}, CONFIG.APP_NAME),
    h('p', { class: 'sub' }, IS_REMOTE ? `${S.profile?.firstName || ''} · ${S.store.email || ''}` : 'Mode solo · la personne en face est simulée'),
    item('home', 'Accueil', null, () => { close(); goTab('home'); }),
    item('user', 'Mon portrait', 'Modifier mes réponses', () => { close(); showOnboarding(true); }),
    item('bell', 'Notifications', notifOff() ? 'Coupées' : notif === 'granted' ? 'Activées' : 'À activer', () => { close(); notifSettings(); }),
    hasDate && item('cal', 'Rappels dans mon calendrier', 'Chaque message à l’heure exacte, même appli fermée', () => { downloadCalendar(S.data.date, S.uid); close(); }),
    item('edit', 'Apparence', THEMES.find((t) => t.id === currentTheme())?.label, () => { close(); themeSheet(); }),
    demoOn() && S.store.adminListUsers && item('heart', 'Choisir mon match (admin)', 'Pour tester à deux', () => { close(); pickMatch(); }),
    S.admin && S.store.adminDiagnostics && item('info', 'Diagnostic (admin)', 'Notifications, tâches, fonction push', () => { close(); diagnostics(); }),
    S.admin && item('clock', 'Mode démo (admin)', demoOn() ? 'Activé : tu peux avancer dans le temps' : 'Désactivé', () => { pref.set('demo', !demoOn()); if (!demoOn()) clock.reset(); close(); route(); }),
    hasDate && item('shield', 'Un souci avec ce date ?', 'Annuler, signaler, se protéger', () => { close(); safety(); }),
    item('pause', S.profile?.paused ? 'Reprendre les rencontres' : 'Mettre en pause', 'On ne te proposera plus personne', async () => {
      S.profile = await S.store.saveProfile({ ...S.profile, paused: !S.profile.paused });
      toast(S.profile.paused ? 'En pause.' : 'C’est reparti.');
      close(); route();
    }),
    item('info', 'Comment ça marche', null, () => { close(); about(); }),
    S.store.needsAuth && item('back', 'Me déconnecter', null, async () => {
      close();
      await S.store.signOut();
      S.uid = null; S.profile = null; S.data = null;
      showAuth('login');
    }),
    item('trash', 'Supprimer mon compte', 'Efface tout, définitivement', async () => {
      close();
      if (await confirmSheet({ title: 'Tout supprimer ?', sub: 'Ton compte, ton portrait, tes dates et tes réponses seront effacés.', yes: 'Supprimer définitivement', danger: true })) {
        await S.store.resetAll();
        location.reload();
      }
    }, 'danger'),
  ], { side: 'right' });
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

// ---------- Thèmes ----------
export const THEMES = [
  { id: 'creme', label: 'Crème', bg: '#faf6f1', swatch: 'linear-gradient(135deg,#ffb86b,#ff5a47 60%,#1d1a17 60%)' },
  { id: 'noir', label: 'Noir', bg: '#0b0b0b', swatch: 'linear-gradient(135deg,#ff5a47,#ffb86b 60%,#f6f1ea 60%)' },
  { id: 'minuit', label: 'Minuit', bg: '#09090f', swatch: 'linear-gradient(135deg,#ff4d8d,#7c5cff 60%,#09090f 60%)' },
  { id: 'sorbet', label: 'Sorbet', bg: '#f2efff', swatch: 'linear-gradient(135deg,#c8f53c,#6a46ff 60%,#17112e 60%)' },
];
export const FONTS = [
  { id: '', label: 'Classique', family: 'Fraunces' },
  { id: 'syne', label: 'Syne', family: 'Syne' },
  { id: 'unbounded', label: 'Unbounded', family: 'Unbounded' },
  { id: 'geist', label: 'Geist', family: 'Geist' },
  { id: 'jakarta', label: 'Jakarta', family: 'Plus Jakarta Sans' },
  { id: 'instrument', label: 'Instrument', family: 'Instrument Serif' },
];
const currentFont = () => document.documentElement.getAttribute('data-font') || '';
function applyFont(id) {
  if (id) document.documentElement.setAttribute('data-font', id);
  else document.documentElement.removeAttribute('data-font');
  pref.set('font', id);
}
const currentTheme = () => document.documentElement.getAttribute('data-theme') || 'minuit';
function applyTheme(id) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  document.documentElement.setAttribute('data-theme', t.id);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.bg);
  pref.set('theme', t.id);
}
applyTheme(pref.get('theme', 'minuit'));

function themeSheet() {
  sheet((close) => {
    const grid = h('div', { class: 'themes' });
    const render = () => grid.replaceChildren(...THEMES.map((t) => h('button', {
      class: 'theme-pick', type: 'button', 'aria-pressed': String(currentTheme() === t.id),
      onclick: () => { applyTheme(t.id); render(); },
    }, h('i', { style: { background: t.swatch } }), t.label)));
    const fonts = h('div', { class: 'chips' });
    const renderFonts = () => fonts.replaceChildren(...FONTS.map((f) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(currentFont() === f.id), style: { fontFamily: `'${f.family}'` },
      onclick: () => { applyFont(f.id); renderFonts(); },
    }, f.label)));
    render(); renderFonts();
    return [h('h3', {}, 'Apparence'), h('p', { class: 'sub' }, 'Choisis l’ambiance de l’appli. Tu peux changer quand tu veux.'), grid,
      h('div', { class: 'section-label' }, 'Police'), fonts,
      h('div', { style: { height: '18px' } }), button('Terminé', () => { close(); route(); })];
  });
}

// ---------- Divers ----------
function logo() {
  const s = document.createElement('span');
  s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 2.2"/><path d="M12 17.2s-4.6-2.8-5.7-5.6C5.5 9.6 6.7 7.4 8.9 7.4c1.2 0 2.2.7 3.1 1.8.9-1.1 1.9-1.8 3.1-1.8 2.2 0 3.4 2.2 2.6 4.2-1.1 2.8-5.7 5.6-5.7 5.6z" fill="currentColor"/></svg>';
  return s.firstChild;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne non dispo */ });
}

boot();
