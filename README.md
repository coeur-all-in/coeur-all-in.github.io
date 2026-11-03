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
| J, 19h | **La discussion** | Elle s'ouvre, juste pour se trouver (texte uniquement) |
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

### Mode en ligne (Supabase) — actif
1. *Authentication → Sign In / Providers → Email* : activé, **Confirm email désactivé**
   (le serveur d'e-mails gratuit de Supabase n'envoie qu'aux membres du projet ; pour activer la confirmation,
   brancher un SMTP comme Resend dans *Authentication → Emails → SMTP Settings*).
2. *Authentication → URL Configuration* : Site URL = `https://coeur-all-in.github.io`.
3. *SQL Editor* : exécuter [`supabase/schema.sql`](supabase/schema.sql). Le script peut être relancé à chaque mise à jour.
4. L'URL et la clé publique sont dans [`js/config.js`](js/config.js).

Comptes : e-mail + mot de passe (8 caractères min.), mot de passe oublié, déconnexion, suppression du compte.
Sécurité : règles RLS (chacun ne voit que son date), discussion ouverte seulement 1 h avant le date. Aucun numéro de téléphone n'est demandé.

## Matching : recherche progressive

Filtres stricts au début, puis élargis minute après minute. Le niveau d'un couple est celui de la personne
qui attend depuis le plus longtemps :

| Attente | Distance | Âge | Compatibilité min | Soir commun |
|---|---|---|---|---|
| < 1 min | x1 | exact | 50 | obligatoire |
| < 3 min | x1,5 | ± 2 ans | 40 | obligatoire |
| < 7 min | x2 | ± 4 ans | 20 | non |
| < 15 min | x4 | ± 8 ans | 0 | non |
| ≥ 15 min | sans limite | tout âge (18+) | 0 | non |

Jamais assouplis : le genre recherché (dans les deux sens), la majorité, ne jamais reproposer quelqu'un.
Score sur 100 : **65 % « ton type »** (style, silhouette, taille, caractère, valeurs, façon de vivre, tabac — ce que chacun recherche chez l'autre, dans les deux sens) + 35 % affinités générales (intention, valeurs, centres d'intérêt, caractère, ambitions, enfants, habitudes).
Les origines ne servent pas au score (donnée sensible, RGPD).
Une tâche planifiée (`pg_cron`, chaque minute) matche les personnes en attente même appli fermée.
Les comptes inactifs depuis 14 jours ne sont plus proposés.

## Notifications

- **Push (appli fermée)** : chaque minute, `pg_cron` appelle la fonction Edge [`push`](supabase/functions/push/index.ts),
  qui récupère les messages dus via `due_pushes()` (match trouvé, puis chaque carte à son heure, heure de Paris)
  et les envoie à tous les appareils abonnés (Web Push chiffré, VAPID, sans dépendance).
  Les clés VAPID sont générées automatiquement au premier passage et stockées dans `push_config` (lisible seulement côté serveur).
  Sur iPhone, il faut iOS 16.4+ et l'appli **installée sur l'écran d'accueil**.
- **Dans l'appli** : notification + pastille sur l'icône quand une carte arrive.
- **Rappels calendrier** (menu) : fichier `.ics` avec une alerte par carte.

### Déployer la fonction push
1. *Database → Extensions* : activer `pg_cron` et `pg_net`, puis relancer `supabase/schema.sql`.
2. *Edge Functions → Deploy a new function → Via Editor* : nom `push`, coller `supabase/functions/push/index.ts`, Deploy.
3. Dans les détails de la fonction : désactiver **Enforce JWT Verification** (la fonction vérifie son propre secret).

## Admins

Le mode démo (voyage dans le temps) n'est visible que pour les admins (table `admins`). Pour en ajouter un :

```sql
insert into public.admins select id from auth.users where email = 'adresse@exemple.fr' on conflict do nothing;
```

### Démo à deux (admin)
En mode démo, l'admin peut **choisir son match** (☰ → Choisir mon match) et **avancer le temps** depuis l'Accueil :
l'avance est enregistrée sur le date (`demo_offset_ms`), donc les deux personnes voient les mêmes cartes et reçoivent
les mêmes notifications. La carte du lieu et la discussion sont visibles avant l'heure pour l'admin.

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
position arrondie à ~100 m, aucun numéro de téléphone collecté.
