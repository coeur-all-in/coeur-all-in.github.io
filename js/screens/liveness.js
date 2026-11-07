// Vérification « vraie personne » : la caméra s'allume, la personne place son visage dans le cercle
// puis tourne la tête vers le haut, la droite et la gauche. Le bord du cercle s'allume en vert du côté
// où elle tourne la tête. Tout est calculé sur le téléphone (MediaPipe) : aucune image ne quitte
// l'appareil, rien n'est enregistré. La caméra est coupée dès la fin.
import { button, h } from '../ui.js';

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const STEPS = [
  { id: 'center', text: 'Place ton visage dans le cercle' },
  { id: 'up', text: 'Lève la tête vers le haut' },
  { id: 'right', text: 'Tourne la tête vers la droite' },
  { id: 'left', text: 'Tourne la tête vers la gauche' },
];
const HOLD = 450; // ms à tenir la bonne position

let landmarkerP = null;
async function loadLandmarker() {
  if (!landmarkerP) {
    landmarkerP = (async () => {
      const { FaceLandmarker, FilesetResolver } = await import(`${VISION}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
      const make = (delegate) => FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numFaces: 2,
      });
      try { return await make('GPU'); } catch { return make('CPU'); }
    })();
    landmarkerP.catch(() => { landmarkerP = null; });
  }
  return landmarkerP;
}

// Position de la tête à partir des points du visage, dans l'image affichée en miroir.
// yaw : 0,5 = de face, plus grand = tournée vers la droite (à l'écran). pitch : plus petit = tête levée.
export function poseFrom(lm) {
  const nose = lm[1]; const l = lm[234]; const r = lm[454]; const top = lm[10]; const chin = lm[152];
  const w = r.x - l.x;
  return {
    yaw: 1 - (nose.x - l.x) / w,
    pitch: (nose.y - top.y) / (chin.y - top.y),
    cx: 1 - (l.x + r.x) / 2, cy: (top.y + chin.y) / 2,
    size: Math.abs(w),
  };
}

// Direction actuelle par rapport à la position de départ (de face).
export function directionOf(p, base) {
  if (!base) return 'center';
  const dy = p.yaw - base.yaw;
  const dp = p.pitch - base.pitch;
  if (dp < -0.07 && Math.abs(dy) < 0.16) return 'up';
  if (dy > 0.13) return 'right';
  if (dy < -0.13) return 'left';
  if (Math.abs(dy) < 0.06 && Math.abs(dp) < 0.05) return 'center';
  return 'moving';
}

// Arcs du cercle : haut, droite, bas, gauche.
function ringSvg() {
  const R = 47; const C = 2 * Math.PI * R; const q = C / 4; const gap = 7;
  const arc = (id, angle) => `<circle data-arc="${id}" cx="50" cy="50" r="${R}" fill="none" stroke-width="3.2" stroke-linecap="round"
    stroke-dasharray="${q - gap} ${C}" transform="rotate(${angle - 45 + (gap / 2) * (360 / C)} 50 50)"/>`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${arc('up', -90)}${arc('right', 0)}${arc('down', 90)}${arc('left', 180)}</svg>`;
}

// Monte l'écran de vérification dans `host`. onDone() quand c'est réussi ; onLater() pour plus tard.
export function livenessView({ onDone, onLater }) {
  const video = h('video', { class: 'lv-video', playsinline: true, muted: true, autoplay: true });
  const ring = h('div', { class: 'lv-ring', html: ringSvg() });
  const msg = h('div', { class: 'lv-msg' }, 'Préparation de la caméra…');
  const sub = h('p', { class: 'small lv-sub' }, 'Rien n’est enregistré ni envoyé : tout se passe sur ton téléphone.');
  const dots = h('div', { class: 'lv-dots' }, STEPS.map((s) => h('i', { 'data-step': s.id })));
  const actions = h('div', { class: 'lv-actions' });
  const root = h('div', { class: 'lv' }, h('div', { class: 'lv-stage' }, video, ring), msg, dots, sub, actions);

  let stream = null;
  let raf = 0;
  let stopped = false;
  let step = 0;
  let holdSince = 0;
  let base = null;
  const baseSamples = [];
  const arcs = Object.fromEntries([...ring.querySelectorAll('[data-arc]')].map((el) => [el.dataset.arc, el]));
  const done = new Set();

  const paint = (current) => {
    for (const [id, el] of Object.entries(arcs)) {
      el.classList.toggle('ok', done.has(id) || (id === 'down' && done.size >= 3));
      el.classList.toggle('near', !done.has(id) && current === id);
    }
    dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < step || done.has(STEPS[i].id)));
  };

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  const fail = (text) => {
    stop();
    msg.textContent = text;
    actions.replaceChildren(
      button('Réessayer', () => { root.replaceWith(livenessView({ onDone, onLater })); }),
      onLater && button('Plus tard', () => onLater(), 'link'));
  };

  const finish = async () => {
    stop();
    ring.classList.add('all');
    msg.textContent = 'C’est bien toi ✓';
    navigator.vibrate?.([30, 40, 60]);
    actions.replaceChildren(h('p', { class: 'small', style: { textAlign: 'center' } }, 'Enregistrement…'));
    try { await onDone(); } catch (e) { fail(e.message || 'Impossible d’enregistrer. Réessaie.'); }
  };

  const onFrame = (p, faces) => {
    if (faces === 0) { msg.textContent = 'Place ton visage dans le cercle'; holdSince = 0; paint(null); return; }
    if (faces > 1) { msg.textContent = 'Une seule personne devant la caméra'; holdSince = 0; paint(null); return; }
    const target = STEPS[step];
    const inCircle = Math.abs(p.cx - 0.5) < 0.2 && Math.abs(p.cy - 0.5) < 0.22;
    if (target.id === 'center') {
      if (!inCircle) { msg.textContent = 'Centre ton visage dans le cercle'; holdSince = 0; return; }
      if (p.size < 0.22) { msg.textContent = 'Approche-toi un peu'; holdSince = 0; return; }
      msg.textContent = 'Ne bouge plus…';
      baseSamples.push(p);
      if (!holdSince) holdSince = performance.now();
      if (performance.now() - holdSince > 700) {
        const avg = (k) => baseSamples.slice(-12).reduce((a, x) => a + x[k], 0) / Math.min(12, baseSamples.length);
        base = { yaw: avg('yaw'), pitch: avg('pitch') };
        step++; holdSince = 0; navigator.vibrate?.(15);
      }
      return;
    }
    const dir = directionOf(p, base);
    paint(dir);
    msg.textContent = target.text;
    if (dir === target.id) {
      if (!holdSince) holdSince = performance.now();
      if (performance.now() - holdSince > HOLD) {
        done.add(target.id);
        step++; holdSince = 0; navigator.vibrate?.(15);
        paint(null);
        if (step >= STEPS.length) finish();
      }
    } else holdSince = 0;
  };

  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) { fail('La caméra n’est pas disponible sur cet appareil.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    } catch {
      fail('Autorise la caméra pour continuer (réglages du téléphone → Cœur All In → Caméra).');
      return;
    }
    if (stopped) { stop(); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    msg.textContent = 'Chargement…';
    // Point d'entrée de test : window.__caiFakePose() renvoie une position simulée.
    const fake = window.__caiFakePose;
    let lmk = null;
    if (!fake) {
      try { lmk = await loadLandmarker(); } catch { fail('Impossible de charger la vérification. Vérifie ta connexion.'); return; }
    }
    if (stopped) return;
    msg.textContent = STEPS[0].text;
    paint(null);
    let last = -1;
    const loop = () => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      if (fake) { const f = fake(); onFrame(f, f ? 1 : 0); return; }
      if (video.readyState < 2 || video.currentTime === last) return;
      last = video.currentTime;
      const r = lmk.detectForVideo(video, performance.now());
      const faces = r.faceLandmarks?.length || 0;
      onFrame(faces === 1 ? poseFrom(r.faceLandmarks[0]) : null, faces);
    };
    loop();
  })();

  root.stop = stop;
  return root;
}
