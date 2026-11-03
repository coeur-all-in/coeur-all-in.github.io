# Cœur All In

> Pas de photo. Pas de swipe. Un soir, une personne, et des cartes pour jouer le rendez-vous.

Appli de rencontre ludique, pensée pour le téléphone (PWA : elle s'installe sur l'écran d'accueil comme une appli).
Chacun dresse son portrait, l'algorithme propose **une seule personne**, puis l'appli envoie des **cartes** à des moments précis
jusqu'au rendez-vous et pendant la soirée : lieu, phrase, règles, objectif secret, quatre jeux, paris, révélations.

## Le déroulé (date un samedi à 20h)

| Quand | Carte | Ce qu'on fait |
|---|---|---|
| Au match | **Quelqu'un a pensé à toi** | On lit son portrait (sans photo). « J'y vais » / « Pas cette fois » |
| Dès que les deux disent oui | **C'est calé** | « Tu es toujours partant·e ? » |
| J-3, 10h | **À ton tour** | Proposer un lieu (ou laisser le choix) + une phrase sur soi. Avant J-2 midi |
| J-2, 12h | **Dans ses mots** | On lit la phrase de l'autre |
| J-1, 20h | **Le lieu est fixé** | Lieu, itinéraire, comment le/la reconnaître + **ton pari** à écrire |
| J, 10h | **Les règles** | Téléphone rangé, pas de boulot avant 21h30, pierre-feuille-ciseaux |
| J, 14h | **Objectif secret** | Chacun le sien. Bouton « Fait » pendant la soirée |
| J, 19h30 | **19h30** | Le numéro de l'autre, juste pour se trouver |
| J, 20h30 → 22h | **4 jeux** | Deux vérités · Yeux fermés · La question · Trente secondes (chrono intégré) |
| J, 22h15 | **Son pari** | On lit le pari de l'autre à voix haute, on tranche |
| J, 22h40 | **On révèle** | Les deux objectifs, à quelle heure ils ont été atteints, son métier |
| J+1, 11h | **Et maintenant ?** | « Je veux le/la revoir » — seul le oui réciproque est révélé |

Le jour du date se cale sur les soirs communs (jeudi, vendredi ou samedi), au moins 3 jours après le match.
Tout le déroulé est dans [`js/timeline.js`](js/timeline.js), tous les textes dans [`js/content.js`](js/content.js) et [`js/screens/cards.js`](js/screens/cards.js).
Les maquettes d'origine sont dans [`docs/cartes/`](docs/cartes).

## Deux modes

### Mode solo (par défaut, rien à configurer)
Tout est stocké sur le téléphone, la personne en face est **simulée** (10 profils fictifs dans `js/store/bots.js`).
Le **mode démo** (dans le menu) ajoute un bouton « Avancer au prochain message » pour vivre toute la semaine en 2 minutes.

### Mode multi-utilisateurs (Supabase, gratuit)
1. Créer un projet sur [supabase.com](https://supabase.com).
2. *Authentication → Sign In / Providers* : activer **Allow anonymous sign-ins**.
3. *SQL Editor* : coller et exécuter [`supabase/schema.sql`](supabase/schema.sql).
4. *Project Settings → API* : copier l'URL et la clé `anon` dans [`js/config.js`](js/config.js), commit, push.

Le schéma contient le matching en SQL (`find_match()`), les règles de sécurité (chacun ne voit que son date,
personne ne peut écrire à la place de l'autre) et le numéro qui ne se débloque qu'à 19h30 le jour J (`partner_phone()`).
Il a été testé sur Postgres 16.

## Matching

Filtres stricts dans les deux sens (genre recherché, tranche d'âge, distance), puis un score sur 100 :
intention 20 · valeurs 20 · centres d'intérêt 15 · caractère 15 · ambitions 10 · enfants 10 · tabac/alcool 10.
Les origines sont facultatives et **ne servent pas** au score (donnée sensible au sens du RGPD).

## Notifications

- Quand l'appli est ouverte ou revient au premier plan : notification système + pastille sur l'icône.
- **Rappels calendrier** (menu → « Rappels dans mon calendrier ») : un fichier `.ics` avec une alerte à chaque carte,
  fiable même appli fermée, sur iPhone comme sur Android.
- Push serveur (appli fermée) : le service worker gère déjà l'événement `push`. Il reste à ajouter une fonction
  planifiée (Supabase Edge Function + clés VAPID) qui envoie les messages aux heures de `timeline.js`. Prochaine étape conseillée.
  Sur iPhone, les notifications web ne marchent qu'une fois l'appli ajoutée à l'écran d'accueil (iOS 16.4+).

## Lancer en local

```bash
python3 -m http.server 8000
```
puis ouvrir http://localhost:8000. Aucune dépendance, aucun build : HTML, CSS et JavaScript natifs.

## Mise en ligne

Le site est en ligne sur **https://coeur-all-in.github.io**. Chaque push sur `main` le redéploie automatiquement
(GitHub Pages, *Settings → Pages → Deploy from a branch : main / root*). Le fichier `.nojekyll` sert les fichiers tels quels.

## Structure

```
index.html, manifest.webmanifest, sw.js   PWA (installable, hors ligne)
css/app.css                                le style des cartes
js/app.js                                  navigation, fil, menu, mode démo
js/screens/onboarding.js                   création du portrait (7 étapes)
js/screens/cards.js                        les 15 cartes
js/timeline.js                             quand arrive chaque carte
js/matching.js                             algorithme de compatibilité
js/content.js                              options du profil, jeux, objectifs secrets
js/store/                                  stockage : local (solo) ou Supabase
supabase/schema.sql                        base de données + sécurité
```

## Sécurité et confiance

18 ans minimum, premier rendez-vous toujours dans un lieu public, bouton « Un souci avec ce date ? »
(signaler, annuler, numéros d'urgence 17 / 112 / 114 / 3919), suppression du compte en un geste,
position arrondie à ~100 m, numéro révélé uniquement le jour J.
