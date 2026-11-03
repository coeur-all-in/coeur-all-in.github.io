// Recherche d'adresses (autocomplétion) et cartes.
// - Villes : Géoplateforme IGN (data.geopf.fr), gratuite et sans clé ; Photon en secours.
// - Lieux (restos, bars, parcs, adresses) : Photon (OpenStreetMap), gratuit et sans clé.
// - Carte : Leaflet (embarqué dans vendor/) + fonds de carte CARTO / OpenStreetMap.
import { h } from './ui.js';

const PHOTON = 'https://photon.komoot.io/api/';
const GEOPF = 'https://data.geopf.fr/geocodage/search';

const uniq = (list) => {
  const seen = new Set();
  return list.filter((x) => { const k = x.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
};

// ---------- Villes ----------
export async function searchCity(q, signal) {
  try {
    const r = await fetch(`${GEOPF}?q=${encodeURIComponent(q)}&index=address&type=municipality&autocomplete=1&limit=6`, { signal });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const out = (j.features || []).map((f) => ({
      label: f.properties.city || f.properties.name || f.properties.label,
      sub: [f.properties.postcode, (f.properties.context || '').split(',').slice(1).join(',').trim()].filter(Boolean).join(' · '),
      city: f.properties.city || f.properties.name,
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    }));
    if (out.length) return uniq(out);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }
  // Secours (et villes hors de France) : Photon.
  const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&lang=fr&limit=8&layer=city&layer=locality`, { signal });
  const j = await r.json();
  return uniq((j.features || []).map((f) => {
    const p = f.properties;
    return {
      label: p.name, city: p.name,
      sub: [p.postcode, p.state, p.country].filter(Boolean).join(' · '),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    };
  })).slice(0, 6);
}

// ---------- Lieux ----------
const KIND = {
  restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', pub: 'Pub', fast_food: 'Snack', ice_cream: 'Glacier',
  park: 'Parc', garden: 'Jardin', museum: 'Musée', cinema: 'Cinéma', theatre: 'Théâtre', bakery: 'Boulangerie',
  viewpoint: 'Point de vue', attraction: 'À voir', biergarten: 'Terrasse', nightclub: 'Club', marketplace: 'Marché',
};

export async function searchPlace(q, near, signal) {
  const bias = near?.lat != null ? `&lat=${near.lat}&lon=${near.lng}&location_bias_scale=0.4` : '';
  const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&lang=fr&limit=7${bias}`, { signal });
  const j = await r.json();
  return uniq((j.features || []).map((f) => {
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const address = [street, [p.postcode, p.city || p.town || p.village].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const isAddress = p.osm_key === 'place' || p.type === 'house' || p.type === 'street';
    const name = p.name || street || p.city;
    return {
      label: name,
      sub: [KIND[p.osm_value] || (isAddress ? 'Adresse' : null), address].filter(Boolean).join(' · '),
      name, address: address || [p.city, p.country].filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
    };
  })).slice(0, 6);
}

// ---------- Liste déroulante ----------
// Branche une autocomplétion sur `input`. `search(q, signal)` → [{label, sub, …}] ; `onPick(item)`.
export function autocomplete(input, { search, onPick, minChars = 2 }) {
  const wrap = h('div', { class: 'ac' });
  const list = h('div', { class: 'ac-list', role: 'listbox', hidden: true });
  let ctrl = null;
  let timer = null;
  let items = [];
  let active = -1;

  const close = () => { list.hidden = true; active = -1; };
  const render = (state) => {
    list.hidden = false;
    if (state === 'loading' && !items.length) { list.replaceChildren(h('div', { class: 'ac-empty' }, 'Recherche…')); return; }
    if (state === 'error') { list.replaceChildren(h('div', { class: 'ac-empty' }, 'Recherche indisponible. Tu peux écrire l’adresse à la main.')); return; }
    if (!items.length) { list.replaceChildren(h('div', { class: 'ac-empty' }, 'Aucun résultat')); return; }
    list.replaceChildren(...items.map((it, i) => h('button', {
      type: 'button', class: `ac-item${i === active ? ' on' : ''}`, role: 'option',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => pick(it),
    }, h('span', { class: 'ac-label' }, it.label), it.sub && h('span', { class: 'ac-sub' }, it.sub))));
  };
  const pick = (it) => {
    input.value = it.label;
    items = [];
    close();
    onPick(it);
  };

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    ctrl?.abort();
    if (q.length < minChars) { items = []; close(); return; }
    render('loading');
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        items = await search(q, ctrl.signal);
        active = -1;
        if (document.activeElement === input) render();
      } catch (e) {
        if (e.name !== 'AbortError') { items = []; render('error'); }
      }
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { active = (active + 1) % items.length; render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  if (input.parentNode) input.replaceWith(wrap);
  wrap.append(input, list);
  return wrap;
}

// ---------- Carte ----------
let leafletReady = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletReady) {
    leafletReady = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet/leaflet.css';
      document.head.append(css);
      const s = document.createElement('script');
      s.src = 'vendor/leaflet/leaflet.js';
      s.onload = () => resolve(window.L);
      s.onerror = reject;
      document.head.append(s);
    });
  }
  return leafletReady;
}

const dark = () => ['minuit', 'noir'].includes(document.documentElement.getAttribute('data-theme'));

// Renvoie un bloc carte ; la carte se dessine dès que le bloc est dans la page.
export function mapBlock(points, { height = 210, zoom = 15 } = {}) {
  const pts = (Array.isArray(points) ? points : [points]).filter((p) => p && p.lat != null && p.lng != null);
  const el = h('div', { class: 'map', style: { height: `${height}px` } });
  if (!pts.length) return null;
  const draw = async () => {
    if (!el.isConnected) { requestAnimationFrame(draw); return; }
    try {
      const L = await loadLeaflet();
      const map = L.map(el, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: !L.Browser.mobile, tap: false });
      const style = dark() ? 'dark_all' : 'rastertiles/voyager';
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
        maxZoom: 19, subdomains: 'abcd',
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);
      const icon = L.divIcon({ className: 'pin', html: '<span></span>', iconSize: [34, 42], iconAnchor: [17, 40] });
      const markers = pts.map((p) => L.marker([p.lat, p.lng], { icon, title: p.label || '' }).addTo(map));
      if (pts.length > 1) map.fitBounds(L.featureGroup(markers).getBounds().pad(0.35));
      else map.setView([pts[0].lat, pts[0].lng], zoom);
      setTimeout(() => map.invalidateSize(), 200);
    } catch {
      el.replaceChildren(h('div', { class: 'ac-empty' }, 'Carte indisponible.'));
    }
  };
  requestAnimationFrame(draw);
  return el;
}
