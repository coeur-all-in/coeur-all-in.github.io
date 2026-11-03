// Création / modification du portrait : 7 étapes courtes.
import {
  AMBITIONS, BUILDS, EYES, GENDERS, HABITS, HAIR_COLORS, HAIR_LENGTHS, INTENTS, INTERESTS, KIDS,
  ORIGINS, SEEKING, STYLES, TRAITS, VALUES, forms, portraitText,
} from '../content.js';
import { age } from '../matching.js';
import { button, h, icon, toast } from '../ui.js';

// ---------- Champs réutilisables ----------
function chips(options, get, set, { multi = false, max = 99 } = {}) {
  const wrap = h('div', { class: 'chips' });
  const norm = options.map((o) => (typeof o === 'string' ? { id: o, label: o } : o));
  const render = () => {
    wrap.replaceChildren(...norm.map((o) => {
      const v = get();
      const on = multi ? (v || []).includes(o.id) : v === o.id;
      return h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(on),
        onclick: () => {
          if (multi) {
            const cur = new Set(get() || []);
            if (cur.has(o.id)) cur.delete(o.id);
            else if (cur.size >= max) { toast(`${max} maximum`); return; }
            else cur.add(o.id);
            set([...cur]);
          } else set(o.id);
          render();
        },
      }, o.label);
    }));
  };
  render();
  return wrap;
}

function field(label, ...control) {
  return h('div', { class: 'field' }, h('label', {}, label), ...control);
}

function text(get, set, attrs = {}) {
  return h(attrs.multiline ? 'textarea' : 'input', {
    class: 'input', value: get() ?? '', ...attrs, multiline: null,
    oninput: (e) => set(e.target.value),
  }, attrs.multiline ? (get() ?? '') : null);
}

function range(get, set, { min, max, step = 1, fmt = (v) => v, left, right }) {
  const val = h('span', { class: 'range-val' }, fmt(get()));
  const input = h('input', {
    type: 'range', class: 'range', min, max, step, value: get(),
    oninput: (e) => { set(Number(e.target.value)); val.textContent = fmt(Number(e.target.value)); },
  });
  return { val, node: h('div', {}, input, (left || right) && h('div', { class: 'range-row' }, h('span', {}, left), h('span', {}, right))) };
}

// ---------- Les étapes ----------
function steps(p) {
  const f = () => forms(p.gender);
  return [
    {
      eyebrow: 'Pour commencer', title: 'Toi',
      render: () => [
        field('Ton prénom (c’est tout ce qu’on saura de ton nom)', text(() => p.firstName, (v) => { p.firstName = v; }, { placeholder: 'Marie', autocomplete: 'given-name', maxlength: 30 })),
        field('Ta date de naissance', text(() => p.birthdate, (v) => { p.birthdate = v; }, { type: 'date', max: new Date().toISOString().slice(0, 10) })),
        field('Tu es', chips(GENDERS, () => p.gender, (v) => { p.gender = v; })),
        field('Tu aimerais rencontrer', chips(SEEKING, () => p.seeking, (v) => { p.seeking = v; }, { multi: true })),
        h('div', { class: 'field' }, h('label', {}, 'Entre quel âge et quel âge ?'),
          h('div', { class: 'row2' },
            text(() => p.ageMin, (v) => { p.ageMin = Number(v); }, { type: 'number', min: 18, max: 99, inputmode: 'numeric', 'aria-label': 'Âge minimum' }),
            text(() => p.ageMax, (v) => { p.ageMax = Number(v); }, { type: 'number', min: 18, max: 99, inputmode: 'numeric', 'aria-label': 'Âge maximum' }))),
      ],
      validate: () => {
        if (!p.firstName?.trim()) return 'Ton prénom, s’il te plaît.';
        if (!p.birthdate) return 'Ta date de naissance est nécessaire.';
        if (age(p.birthdate) < 18) return 'Cœur All In est réservé aux personnes majeures.';
        if (!p.gender) return 'Dis-moi qui tu es.';
        if (!p.seeking?.length) return 'Dis-moi qui tu aimerais rencontrer.';
        if (!(p.ageMin >= 18 && p.ageMax >= p.ageMin)) return 'La tranche d’âge ne va pas (18 ans minimum).';
        return null;
      },
    },
    {
      eyebrow: 'Pour se retrouver', title: 'Où',
      render: () => {
        const geo = h('div', { class: 'small', style: { marginTop: '8px' } }, p.lat ? 'Position enregistrée ✓' : '');
        const km = range(() => p.maxKm, (v) => { p.maxKm = v; }, { min: 2, max: 100, fmt: (v) => `${v} km` });
        return [
          field('Ta ville', text(() => p.city, (v) => { p.city = v; }, { placeholder: 'Paris', autocomplete: 'address-level2' }),
            button('Utiliser ma position', () => {
              if (!navigator.geolocation) { geo.textContent = 'Géolocalisation indisponible.'; return; }
              geo.textContent = 'Localisation…';
              navigator.geolocation.getCurrentPosition(
                (pos) => { p.lat = +pos.coords.latitude.toFixed(3); p.lng = +pos.coords.longitude.toFixed(3); geo.textContent = 'Position enregistrée ✓ (arrondie à ~100 m)'; },
                () => { geo.textContent = 'Position refusée — la ville suffira.'; },
                { timeout: 10000 });
            }, 'link'), geo),
          h('div', { class: 'field' }, h('label', {}, 'Distance maximum ', km.val), km.node),
          field('Les soirs où tu es libre', chips(
            [{ id: 4, label: 'Jeudi' }, { id: 5, label: 'Vendredi' }, { id: 6, label: 'Samedi' }],
            () => p.availability, (v) => { p.availability = v; }, { multi: true })),
          h('p', { class: 'small' }, 'Le rendez-vous est toujours à 20h. L’heure, je ne la négocie pas.'),
        ];
      },
      validate: () => {
        if (!p.city?.trim()) return 'Ta ville est nécessaire pour trouver quelqu’un près de toi.';
        if (!p.availability?.length) return 'Choisis au moins un soir.';
        return null;
      },
    },
    {
      eyebrow: 'Pour te reconnaître', title: 'Ton physique',
      render: () => {
        const ht = range(() => p.height, (v) => { p.height = v; }, { min: 140, max: 210, fmt: (v) => `${Math.floor(v / 100)}m${String(v % 100).padStart(2, '0')}` });
        return [
          h('p', { class: 'small', style: { margin: '0 0 22px' } }, 'Pas de photo. Ces infos ne sont révélées que la veille du date, pour que vous puissiez vous reconnaître.'),
          h('div', { class: 'field' }, h('label', {}, 'Ta taille ', ht.val), ht.node),
          field('Ta silhouette', chips(BUILDS, () => p.build, (v) => { p.build = v; })),
          field('Tes cheveux', chips(HAIR_COLORS, () => p.hairColor, (v) => { p.hairColor = v; })),
          field('Leur longueur', chips(HAIR_LENGTHS, () => p.hairLength, (v) => { p.hairLength = v; })),
          field('Tes yeux', chips(EYES, () => p.eyes, (v) => { p.eyes = v; })),
          field('Tes origines (facultatif)', chips(ORIGINS, () => p.origins, (v) => { p.origins = v; }, { multi: true, max: 3 })),
          field('Un détail pour te reconnaître (facultatif)', text(() => p.distinctive, (v) => { p.distinctive = v; }, { placeholder: 'Un foulard jaune, toujours', maxlength: 60 })),
        ];
      },
      validate: () => (!p.build || !p.hairColor || !p.eyes ? 'Silhouette, cheveux et yeux, au minimum.' : null),
    },
    {
      eyebrow: 'Ce qui te ressemble', title: 'Ton style',
      render: () => [
        field('Ton style vestimentaire (3 max)', chips(STYLES, () => p.style, (v) => { p.style = v; }, { multi: true, max: 3 })),
        field('Tes trois valeurs', chips(VALUES, () => p.values, (v) => { p.values = v; }, { multi: true, max: 3 })),
        field('Ce que tu aimes faire (6 max)', chips(INTERESTS, () => p.interests, (v) => { p.interests = v; }, { multi: true, max: 6 })),
      ],
      validate: () => {
        if (!p.style?.length) return 'Choisis au moins un style.';
        if ((p.values?.length || 0) < 3) return 'Choisis trois valeurs.';
        if ((p.interests?.length || 0) < 2) return 'Choisis au moins deux centres d’intérêt.';
        return null;
      },
    },
    {
      eyebrow: 'Ce qu’on dira de toi', title: 'Ton caractère',
      render: () => {
        const prev = h('div', { class: 'preview' });
        const upd = () => { prev.textContent = portraitText(p) || 'Ton portrait apparaîtra ici.'; };
        const sliders = TRAITS.map((t) => {
          const r = range(() => p.traits[t.id], (v) => { p.traits[t.id] = v; }, { min: 1, max: 5, left: t.left, right: t.right, fmt: () => '' });
          return h('div', { class: 'field' }, r.node);
        });
        const pf = (label, key, ph) => h('div', { class: 'field' }, h('label', {}, label),
          h('div', { class: 'prefix' }, h('span', {}, key === 'unforgivable' ? 'sauf' : key === 'first' ? `${f().Il} est` : f().Il),
            text(() => p.portrait[key], (v) => { p.portrait[key] = v; upd(); }, { placeholder: ph, maxlength: 110 })));
        upd();
        return [
          ...sliders,
          h('div', { class: 'section-label' }, 'Ton portrait'),
          h('p', { class: 'small', style: { margin: '0 0 18px' } }, 'Écris comme si un ami parlait de toi. C’est ce que lira la personne choisie, sans photo.'),
          pf('Ce qu’on remarque dès les premières minutes', 'first', 'calme, au point que ça se remarque'),
          pf('Ce que tu fais avec les gens', 'people', 'pose beaucoup de questions et écoute vraiment'),
          pf('Tu pardonnes à peu près tout, sauf…', 'unforgivable', 'l’esprit fermé'),
          prev,
        ];
      },
      validate: () => {
        const pr = p.portrait;
        if (!pr.first?.trim() || !pr.people?.trim() || !pr.unforgivable?.trim()) return 'Les trois phrases du portrait sont nécessaires.';
        return null;
      },
    },
    {
      eyebrow: 'Où tu vas', title: 'Ta vie',
      render: () => [
        field('Ton métier (gardé secret jusqu’à la fin du date)', text(() => p.job, (v) => { p.job = v; }, { placeholder: 'Architecte', maxlength: 50 })),
        field('Tes ambitions (3 max)', chips(AMBITIONS, () => p.ambitions, (v) => { p.ambitions = v; }, { multi: true, max: 3 })),
        field('Ce que tu cherches', chips(INTENTS, () => p.intent, (v) => { p.intent = v; })),
        field('Les enfants', chips(KIDS, () => p.kids, (v) => { p.kids = v; })),
        h('div', { class: 'row2' },
          field('Tabac', chips(HABITS, () => p.smoke, (v) => { p.smoke = v; })),
          field('Alcool', chips(HABITS, () => p.drink, (v) => { p.drink = v; }))),
      ],
      validate: () => (!p.ambitions?.length || !p.intent || !p.kids || !p.smoke || !p.drink ? 'Il manque une réponse.' : null),
    },
    {
      eyebrow: 'Dernière chose', title: 'Le jour J',
      render: () => [
        field('Ton numéro de téléphone', text(() => p.phone, (v) => { p.phone = v; }, { type: 'tel', placeholder: '06 12 34 56 78', autocomplete: 'tel' })),
        h('p', { class: 'small', style: { margin: '-10px 0 26px' } }, 'Il n’est donné à la personne qu’à 19h30 le jour du date, juste pour se trouver.'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.consent18, onchange: (e) => { p.consent18 = e.target.checked; } }),
          h('span', {}, 'J’ai 18 ans ou plus.')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.consentData, onchange: (e) => { p.consentData = e.target.checked; } }),
          h('span', {}, 'J’accepte que ces informations (y compris les facultatives, comme mes origines) servent uniquement à trouver la bonne personne. Je peux tout supprimer à tout moment.')),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.consentSafety, onchange: (e) => { p.consentSafety = e.target.checked; } }),
          h('span', {}, 'Je m’engage à respecter l’autre, à venir ou prévenir, et à rester dans un lieu public au premier rendez-vous.')),
      ],
      validate: () => {
        if (!/^[+\d][\d\s.-]{7,}$/.test(p.phone || '')) return 'Ton numéro semble incomplet.';
        if (!p.consent18 || !p.consentData || !p.consentSafety) return 'Les trois cases sont nécessaires.';
        return null;
      },
    },
  ];
}

export function defaults(existing) {
  return {
    firstName: '', birthdate: '', gender: null, seeking: [], ageMin: 24, ageMax: 38,
    city: '', lat: null, lng: null, maxKm: 25, availability: [5, 6],
    height: 172, build: null, hairColor: null, hairLength: null, eyes: null, origins: [], distinctive: '',
    style: [], values: [], interests: [],
    traits: { social: 3, tempo: 3, plan: 3, talk: 3 },
    portrait: { first: '', people: '', unforgivable: '' },
    job: '', ambitions: [], intent: null, kids: null, smoke: null, drink: null, phone: '',
    consent18: false, consentData: false, consentSafety: false,
    ...structuredClone(existing || {}),
  };
}

// Monte l'assistant dans `root`. onDone(profile) est appelé à la fin.
export function onboarding(root, { initial, onDone, onCancel, startStep = 0 }) {
  const p = defaults(initial);
  const all = steps(p);
  let i = startStep;

  const render = () => {
    const s = all[i];
    const err = h('div', { class: 'error', role: 'alert' });
    const next = button(i === all.length - 1 ? (initial ? 'Enregistrer' : 'Trouver quelqu’un') : 'Continuer', async () => {
      const e = s.validate();
      if (e) { err.textContent = e; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (i < all.length - 1) { i++; render(); window.scrollTo(0, 0); return; }
      next.disabled = true;
      try { await onDone(cleanup(p)); } catch (ex) { next.disabled = false; err.textContent = ex.message; }
    });
    root.replaceChildren(h('main', { class: 'screen' },
      h('div', { class: 'topbar' },
        h('button', { class: 'icon-btn', 'aria-label': 'Retour', onclick: () => { if (i > 0) { i--; render(); } else onCancel?.(); } }, icon(i > 0 || onCancel ? 'back' : 'heart')),
        h('div', { class: 'small' }, `${i + 1} / ${all.length}`)),
      h('div', { class: 'progress' }, all.map((_, k) => h('i', { class: k <= i ? 'on' : '' }))),
      h('div', { class: 'eyebrow' }, s.eyebrow),
      h('h1', { class: 'title', style: { marginBottom: '28px' } }, s.title),
      s.render(),
      h('div', { class: 'spacer' }),
      err,
      next,
    ));
  };
  render();
}

function cleanup(p) {
  const out = { ...p, firstName: p.firstName.trim(), city: p.city.trim() };
  out.ageMin = Math.max(18, out.ageMin || 18);
  out.ageMax = Math.max(out.ageMin, out.ageMax || 99);
  return out;
}
