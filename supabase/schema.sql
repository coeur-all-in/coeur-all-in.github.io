-- Cœur All In — schéma Supabase
-- À coller tel quel dans Supabase → SQL Editor → Run. Peut être relancé sans risque (mise à jour).
-- Pré-requis : Authentication → Sign In / Providers → Email activé, « Confirm email » désactivé
-- (sinon chaque inscription attend un e-mail de confirmation).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- Tables

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null,                     -- profil complet (prénom, physique, caractère…)
  gender text,                             -- sexe inscrit sur la pièce d'identité (rempli à la vérification)
  seeking text[] not null,
  birthdate date not null,
  age_min int not null default 18,
  age_max int not null default 99,
  city text,
  lat double precision,
  lng double precision,
  max_km int not null default 30,
  availability int[] not null default '{6,5,4}',
  active boolean not null default true,    -- false = en pause, n'est plus proposé
  updated_at timestamptz not null default now()
);

create table if not exists public.dates (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references public.profiles(id) on delete cascade,
  b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  date_at timestamptz not null,
  closed_by uuid[] not null default '{}',  -- chaque personne « referme » le date de son côté
  objectives jsonb not null default '{}',
  score int
);
alter table public.dates add column if not exists demo_offset_ms bigint;  -- mode démo : avance du temps partagée par les deux
create index if not exists dates_a_idx on public.dates(a);
create index if not exists dates_b_idx on public.dates(b);

create table if not exists public.answers (
  date_id uuid not null references public.dates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (date_id, user_id, key)
);

create table if not exists public.reports (
  id bigserial primary key,
  date_id uuid references public.dates(id) on delete set null,
  reporter uuid not null default auth.uid(),
  reason text,
  created_at timestamptz not null default now()
);

-- Le sexe vient de la vérification d'identité (plus demandé dans le questionnaire).
alter table public.profiles alter column gender drop not null;
alter table public.profiles add column if not exists verified boolean not null default false;
-- Présence : tant que l'appli est ouverte, pas de notification push (bannière dans l'appli à la place).
alter table public.profiles add column if not exists in_app_until timestamptz;

-- Recherche progressive : depuis quand la personne attend, et dernière ouverture de l'appli.
alter table public.profiles add column if not exists searching_since timestamptz default now();
alter table public.profiles add column if not exists last_seen timestamptz default now();
create index if not exists profiles_searching_idx on public.profiles(searching_since) where searching_since is not null;

-- ---------------------------------------------------------------- Helpers

-- Admins (mode démo, vérifications d'identité). Défini tôt : des règles plus bas s'en servent.
create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

-- Nombre d'éléments communs entre deux tableaux JSON de textes.
create or replace function public.jcommon(x jsonb, y jsonb) returns int
language sql immutable as $$
  select count(*)::int
  from jsonb_array_elements_text(case when jsonb_typeof(x) = 'array' then x else '[]'::jsonb end) e
  where e in (select jsonb_array_elements_text(case when jsonb_typeof(y) = 'array' then y else '[]'::jsonb end))
$$;

-- Distance en km (Haversine). Sans coordonnées : même ville = 0, sinon très loin.
create or replace function public.km(lat1 float8, lng1 float8, lat2 float8, lng2 float8, c1 text, c2 text) returns float8
language sql immutable as $$
  select case
    when lat1 is null or lat2 is null or lng1 is null or lng2 is null then
      case when lower(trim(coalesce(c1, ''))) <> '' and lower(trim(c1)) = lower(trim(coalesce(c2, ''))) then 0 else 1e6 end
    else 2 * 6371 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
  end
$$;

-- Affinités générales sur 100 (35 % du score final) — même logique que js/matching.js.
create or replace function public.base_score(p jsonb, q jsonb) returns int
language plpgsql immutable as $$
declare
  s numeric := 0;
  gap int := 0;
  t text;
  k1 text := coalesce(p->>'kids', '');
  k2 text := coalesce(q->>'kids', '');
begin
  -- intention
  if p->>'intent' = q->>'intent' then s := s + 20;
  elsif p->>'intent' = 'voir' or q->>'intent' = 'voir' then s := s + 12; end if;
  -- valeurs, centres d'intérêt, ambitions
  s := s + least(public.jcommon(p->'values', q->'values'), 3) / 3.0 * 20;
  s := s + least(public.jcommon(p->'interests', q->'interests'), 3) / 3.0 * 15;
  s := s + least(public.jcommon(p->'ambitions', q->'ambitions'), 2) / 2.0 * 10;
  -- caractère
  foreach t in array array['social', 'tempo', 'plan', 'talk'] loop
    gap := gap + abs(coalesce((p->'traits'->>t)::int, 3) - coalesce((q->'traits'->>t)::int, 3));
  end loop;
  s := s + (1 - gap / 16.0) * 15;
  -- enfants
  if k1 = k2 then s := s + 10;
  elsif k1 = 'peutetre' or k2 = 'peutetre' then s := s + 6;
  elsif (k1 = 'non' and k2 = 'veux') or (k1 = 'veux' and k2 = 'non') then s := s + 0;
  else s := s + 4; end if;
  -- habitudes
  s := s + (case when p->>'smoke' = q->>'smoke' then 1 when 'parfois' in (p->>'smoke', q->>'smoke') then 0.6 else 0.1 end) * 5;
  s := s + (case when p->>'drink' = q->>'drink' then 1 when 'parfois' in (p->>'drink', q->>'drink') then 0.6 else 0.1 end) * 5;
  return round(s);
end $$;

-- À quel point q correspond à ce que p recherche (0 → 1). Vide = « peu importe ».
create or replace function public.desire(p jsonb, q jsonb) returns numeric
language plpgsql immutable as $$
declare
  w jsonb := coalesce(p->'want', '{}'::jsonb);
  tot numeric := 0;
  acc numeric := 0;
  o int;
  d numeric;
  n int := 0;
  tsum numeric := 0;
  k text;
  v int;
  h int := nullif(q->>'height', '')::int;
begin
  if jsonb_array_length(coalesce(w->'styles', '[]')) > 0 then
    o := public.jcommon(w->'styles', q->'style');
    tot := tot + 0.25; acc := acc + 0.25 * (case when o > 0 then 0.6 + 0.4 * least(o, 2) / 2.0 else 0.15 end);
  end if;
  if jsonb_array_length(coalesce(w->'builds', '[]')) > 0 then
    tot := tot + 0.15; acc := acc + 0.15 * (case when (w->'builds') ? coalesce(q->>'build', '') then 1 else 0.25 end);
  end if;
  if (w->>'heightMin') is not null and (w->>'heightMax') is not null and h is not null then
    d := greatest((w->>'heightMin')::int - h, h - (w->>'heightMax')::int, 0);
    tot := tot + 0.15; acc := acc + 0.15 * greatest(0, 1 - d / 12.0);
  end if;
  for k, v in select key, value::int from jsonb_each_text(coalesce(w->'traits', '{}')) loop
    if v <> 0 then
      n := n + 1;
      tsum := tsum + 1 - abs(v - coalesce((q->'traits'->>k)::int, 3)) / 4.0;
    end if;
  end loop;
  if n > 0 then tot := tot + 0.2; acc := acc + 0.2 * tsum / n; end if;
  if jsonb_array_length(coalesce(w->'values', '[]')) > 0 then
    tot := tot + 0.15; acc := acc + 0.15 * (0.25 + 0.75 * least(public.jcommon(w->'values', q->'values'), 2) / 2.0);
  end if;
  if jsonb_array_length(coalesce(w->'interests', '[]')) > 0 then
    tot := tot + 0.05; acc := acc + 0.05 * (0.4 + 0.6 * least(public.jcommon(w->'interests', q->'interests'), 2) / 2.0);
  end if;
  if coalesce(w->>'smoke', 'egal') <> 'egal' then
    tot := tot + 0.1;
    acc := acc + 0.1 * (case q->>'smoke' when 'jamais' then 1
      when 'parfois' then (case when w->>'smoke' = 'plutot' then 0.6 else 0.3 end)
      else (case when w->>'smoke' = 'plutot' then 0.3 else 0 end) end);
  end if;
  return case when tot > 0 then acc / tot else 0.7 end;
end $$;

-- Score final sur 100 : 65 % « ce que chacun recherche chez l'autre » (dans les deux sens) + 35 % affinités.
create or replace function public.match_score(p jsonb, q jsonb) returns int
language sql immutable as $$
  select round(65 * (public.desire(p, q) + public.desire(q, p)) / 2 + 0.35 * public.base_score(p, q))::int
$$;

-- Une personne est « prise » si elle a un date qu'elle n'a pas refermé (et pas trop vieux).
create or replace function public.is_busy(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dates d
    where (d.a = uid or d.b = uid)
      and not (uid = any(d.closed_by))
      and d.date_at > now() - interval '2 days')
$$;

-- ---------------------------------------------------------------- Matching progressif
--
-- Plus on attend, plus les critères s'assouplissent. Le niveau retenu pour un couple est celui
-- de la personne qui attend depuis le plus longtemps (elle « ouvre » la recherche pour les deux).
--   niveau | attente     | distance        | âge      | compatibilité min | soir commun
--   0      | < 1 min     | x1              | exact    | 50 / 100          | obligatoire
--   1      | < 3 min     | x1,5            | ± 2 ans  | 35                | obligatoire
--   2      | < 7 min     | x2              | ± 4 ans  | 20                | non
--   3      | < 15 min    | x4              | ± 8 ans  | 0                 | non
--   4      | ≥ 15 min    | sans limite     | tout âge | 0                 | non   → n'importe qui
-- Jamais assoupli : le genre recherché (dans les deux sens), la majorité, ne pas revoir quelqu'un déjà proposé.

create or replace function public.search_level(since timestamptz) returns int
language sql stable as $$
  select case
    when since is null or now() - since < interval '1 minute' then 0
    when now() - since < interval '3 minutes' then 1
    when now() - since < interval '7 minutes' then 2
    when now() - since < interval '15 minutes' then 3
    else 4 end
$$;
create or replace function public.lvl_km(l int) returns numeric language sql immutable as $$ select (array[1, 1.5, 2, 4, 100000]::numeric[])[l + 1] $$;
create or replace function public.lvl_age(l int) returns int language sql immutable as $$ select (array[0, 2, 4, 8, 200])[l + 1] $$;
create or replace function public.lvl_score(l int) returns int language sql immutable as $$ select (array[50, 35, 20, 0, 0])[l + 1] $$;

-- Cherche et crée un date pour `uid`. Usage interne (appelé par find_match et par la tâche planifiée).
create or replace function public.match_for(uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  ml int;
  cand record;
  common int[];
  d_day date;
  new_id uuid;
  objs text[] := array['vingt', 'souvenir', 'fourire', 'chanson', 'ailleurs', 'fierte', 'enfant', 'plat'];
  i int;
  j int;
  paris_today date := (now() at time zone 'Europe/Paris')::date;
begin
  select * into me from profiles where id = uid for update skip locked;
  if me.id is null or not me.active or not me.verified or me.gender is null or me.searching_since is null or public.is_busy(uid) then return null; end if;
  ml := public.search_level(me.searching_since);

  select p.id, p.availability, x.sc into cand
  from profiles p
  cross join lateral (
    select public.match_score(me.data, p.data) as sc,
           greatest(ml, public.search_level(p.searching_since)) as lv,
           public.km(me.lat, me.lng, p.lat, p.lng, me.city, p.city) as d,
           extract(year from age(p.birthdate))::int as page,
           extract(year from age(me.birthdate))::int as mage
  ) x
  where p.id <> me.id and p.active and p.verified
    and p.searching_since is not null
    and p.last_seen > now() - interval '14 days'
    and p.gender = any(me.seeking) and me.gender = any(p.seeking)
    and x.page >= 18 and x.mage >= 18
    and x.page between me.age_min - public.lvl_age(x.lv) and me.age_max + public.lvl_age(x.lv)
    and x.mage between p.age_min - public.lvl_age(x.lv) and p.age_max + public.lvl_age(x.lv)
    and x.d <= least(me.max_km, p.max_km) * public.lvl_km(x.lv)
    and x.sc >= public.lvl_score(x.lv)
    and (x.lv >= 2 or me.availability && p.availability)
    and not exists (select 1 from dates d where (d.a = me.id and d.b = p.id) or (d.a = p.id and d.b = me.id))
    and not public.is_busy(p.id)
  order by x.sc desc, p.searching_since asc
  limit 1
  for update of p skip locked;

  if cand.id is null then return null; end if;

  -- Jour du date : jeudi, vendredi ou samedi communs (samedi sinon), au moins 3 jours après, 20h heure de Paris.
  select array_agg(x) into common from unnest(array[6, 5, 4]) x
  where x = any(me.availability) and x = any(cand.availability);
  if common is null then common := array[6]; end if;
  for k in 3..16 loop
    d_day := paris_today + k;
    exit when extract(dow from d_day)::int = any(common);
  end loop;

  i := 1 + floor(random() * array_length(objs, 1))::int;
  j := 1 + floor(random() * (array_length(objs, 1) - 1))::int;
  if j >= i then j := j + 1; end if;

  insert into dates (a, b, date_at, objectives, score)
  values (me.id, cand.id, (d_day + time '20:00') at time zone 'Europe/Paris',
          jsonb_build_object(me.id::text, objs[i], cand.id::text, objs[j]), cand.sc)
  returning id into new_id;
  update profiles set searching_since = null where id in (me.id, cand.id);
  return new_id;
end $$;

-- Appelée par l'appli : renvoie le date en cours, en crée un si possible,
-- sinon l'état de la recherche (niveau d'assouplissement) pour l'afficher.
drop function if exists public.find_match();
create or replace function public.find_match() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me profiles;
  existing uuid;
  new_id uuid;
  l int;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'Profil manquant'; end if;

  select d.id into existing from dates d
  where (d.a = me.id or d.b = me.id) and not (me.id = any(d.closed_by)) and d.date_at > now() - interval '2 days'
  order by d.created_at desc limit 1;
  if existing is not null then return jsonb_build_object('date_id', existing); end if;

  if not me.verified then return jsonb_build_object('date_id', null, 'verify', true); end if;
  update profiles set last_seen = now(), searching_since = coalesce(searching_since, now()) where id = me.id;
  if not me.active then return jsonb_build_object('date_id', null, 'paused', true); end if;

  new_id := public.match_for(me.id);
  if new_id is not null then return jsonb_build_object('date_id', new_id); end if;

  select public.search_level(searching_since) into l from profiles where id = me.id;
  return jsonb_build_object(
    'date_id', null,
    'level', l,
    'since', (select searching_since from profiles where id = me.id),
    'km', case when l >= 4 then null else round(me.max_km * public.lvl_km(l)) end,
    'age_pad', public.lvl_age(l),
    'min_score', public.lvl_score(l),
    'waiting', (select count(*) from profiles p where p.active and p.verified and p.searching_since is not null and p.id <> me.id
                and p.last_seen > now() - interval '14 days' and p.gender = any(me.seeking) and me.gender = any(p.seeking))
  );
end $$;

-- Tâche planifiée : chaque minute, tente un match pour chaque personne en attente,
-- en commençant par celles qui attendent depuis le plus longtemps. Marche même appli fermée.
create or replace function public.match_waiting() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from profiles
           where active and searching_since is not null and last_seen > now() - interval '14 days'
           order by searching_since loop
    if public.match_for(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Refermer un date de son côté (refus, fin de soirée…). On peut ensuite rechercher.
create or replace function public.close_date(p_date uuid) returns void
language sql security definer set search_path = public as $$
  update dates set closed_by = array_append(closed_by, auth.uid())
  where id = p_date and auth.uid() in (a, b) and not (auth.uid() = any(closed_by));
  update profiles set searching_since = now(), last_seen = now() where id = auth.uid();
$$;

-- Supprimer son compte : efface l'utilisateur et, en cascade, son profil, ses dates et ses réponses.
create or replace function public.delete_account() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid()
$$;

-- Plus de numéros de téléphone : on supprime la table et la fonction s'ils existent (données inutiles).
drop function if exists public.partner_phone(uuid);
drop table if exists public.contacts;

-- ---------------------------------------------------------------- Sécurité (RLS)

alter table public.profiles enable row level security;
alter table public.dates enable row level security;
alter table public.answers enable row level security;
alter table public.reports enable row level security;

create or replace function public.in_date(p_date uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dates d where d.id = p_date and auth.uid() in (d.a, d.b))
$$;

create or replace function public.shares_date(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dates d
    where (d.a = auth.uid() and d.b = other) or (d.b = auth.uid() and d.a = other))
$$;

drop policy if exists "profil: soi ou son date" on public.profiles;
create policy "profil: soi ou son date" on public.profiles for select
  using (id = auth.uid() or public.shares_date(id));
drop policy if exists "profil: créer le sien" on public.profiles;
create policy "profil: créer le sien" on public.profiles for insert with check (id = auth.uid());
drop policy if exists "profil: modifier le sien" on public.profiles;
create policy "profil: modifier le sien" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "profil: supprimer le sien" on public.profiles;
create policy "profil: supprimer le sien" on public.profiles for delete using (id = auth.uid());

-- Le sexe, la vérification et la présence ne s'écrivent jamais depuis l'appli (seulement par le serveur).
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, data, seeking, birthdate, age_min, age_max, city, lat, lng, max_km, availability, active, updated_at)
  on public.profiles to authenticated;
grant update (id, data, seeking, birthdate, age_min, age_max, city, lat, lng, max_km, availability, active, updated_at)
  on public.profiles to authenticated;

drop policy if exists "date: participants" on public.dates;
create policy "date: participants" on public.dates for select using (auth.uid() in (a, b));

drop policy if exists "réponses: lire celles de son date" on public.answers;
create policy "réponses: lire celles de son date" on public.answers for select using (public.in_date(date_id));
drop policy if exists "réponses: écrire les siennes" on public.answers;
create policy "réponses: écrire les siennes" on public.answers for insert
  with check (user_id = auth.uid() and public.in_date(date_id));
drop policy if exists "réponses: modifier les siennes" on public.answers;
create policy "réponses: modifier les siennes" on public.answers for update
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.in_date(date_id));

drop policy if exists "signalement: créer" on public.reports;
create policy "signalement: créer" on public.reports for insert with check (reporter = auth.uid());

revoke all on function public.find_match() from public, anon;
revoke all on function public.match_for(uuid) from public, anon, authenticated;
revoke all on function public.match_waiting() from public, anon, authenticated;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
revoke all on function public.close_date(uuid) from public, anon;
grant execute on function public.find_match() to authenticated;
grant execute on function public.close_date(uuid) to authenticated;

-- ---------------------------------------------------------------- Tâche planifiée (pg_cron)
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'cai-match') then
    perform cron.unschedule('cai-match');
  end if;
  perform cron.schedule('cai-match', '* * * * *', 'select public.match_waiting()');
exception when others then
  raise notice 'pg_cron indisponible (%). Le matching se fera quand les gens ouvrent l''appli.', sqlerrm;
end $$;

-- Optionnel : supprimer les anciens comptes de test anonymes (avant les comptes e-mail).
-- delete from auth.users where is_anonymous;

-- ================================================================ Admins
-- Les admins voient le mode démo (voyage dans le temps). Ajouter un admin :
--   insert into public.admins select id from auth.users where email = 'adresse@exemple.fr' on conflict do nothing;

-- ================================================================ Discussion
-- Messages entre les deux personnes d'un date : la discussion ouvre 1 h avant le rendez-vous.
create table if not exists public.messages (
  id bigserial primary key,
  date_id uuid not null references public.dates(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_date_idx on public.messages(date_id, id);
alter table public.messages enable row level security;

drop policy if exists "messages: lire ceux de son date" on public.messages;
create policy "messages: lire ceux de son date" on public.messages for select using (public.in_date(date_id));
drop policy if exists "messages: écrire si les deux ont dit oui" on public.messages;
drop policy if exists "messages: écrire à partir d'1 h avant" on public.messages;
create policy "messages: écrire à partir d'1 h avant" on public.messages for insert with check (
  user_id = auth.uid() and public.in_date(date_id)
  and (exists (select 1 from dates d where d.id = messages.date_id
               and now() + coalesce(d.demo_offset_ms, 0) * interval '1 millisecond' >= d.date_at - interval '1 hour')
       or public.is_admin())
  and (select count(*) from answers x where x.date_id = messages.date_id and x.key = 'accept' and x.value = 'true'::jsonb) = 2
  and not exists (select 1 from dates d where d.id = messages.date_id and auth.uid() = any(d.closed_by))
  and not exists (select 1 from answers x where x.date_id = messages.date_id and x.key = 'ended')
);

-- ================================================================ Notifications push
-- Chaque minute : due_pushes() calcule les messages à envoyer (match, puis chaque carte à son heure),
-- puis la fonction Edge « push » les envoie aux téléphones abonnés. Voir supabase/functions/push.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- Messages déjà envoyés (un seul envoi par carte et par personne).
create table if not exists public.push_log (
  date_id uuid not null references public.dates(id) on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (date_id, user_id, key)
);

-- Clés VAPID (générées automatiquement par la fonction push au premier passage) et secret de la tâche planifiée.
create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  vapid_public text,
  vapid_private_jwk jsonb,
  cron_secret text not null default encode(gen_random_bytes(24), 'hex'),
  function_url text
);
insert into public.push_config (id, function_url)
values (1, 'https://tdkxdhzdiuhlhfiyharv.supabase.co/functions/v1/push')
on conflict (id) do nothing;

alter table public.push_subscriptions enable row level security;
alter table public.push_log enable row level security;
alter table public.push_config enable row level security;   -- aucune règle : lisible seulement côté serveur
revoke all on public.push_config from anon, authenticated;
revoke all on public.push_log from anon, authenticated;

drop policy if exists "push: mes abonnements" on public.push_subscriptions;
create policy "push: mes abonnements" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- La clé publique, pour que l'appli puisse s'abonner.
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select vapid_public from push_config where id = 1
$$;
grant execute on function public.push_public_key() to anon, authenticated;

-- File de notifications ponctuelles (ex. notification test de l'admin).
create table if not exists public.push_queue (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.push_queue enable row level security;
revoke all on public.push_queue from anon, authenticated;

-- Horodatage en millisecondes (réponse JSON) → timestamptz.
create or replace function public.ms_ts(v jsonb) returns timestamptz
language sql immutable as $$
  select case when v is not null and jsonb_typeof(v) = 'number' then to_timestamp((v::text)::numeric / 1000) end
$$;

-- La personne a l'appli ouverte (signal envoyé toutes les 10 s par l'appli) ?
create or replace function public.is_present(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select in_app_until > now() from profiles where id = uid), false)
$$;

create or replace function public.set_presence(p_where text) returns void
language sql security definer set search_path = public as $$
  update profiles set in_app_until = case when p_where = 'away' then null else now() + interval '30 seconds' end,
                      last_seen = now()
  where id = auth.uid()
$$;
revoke all on function public.set_presence(text) from public, anon;
grant execute on function public.set_presence(text) to authenticated;

-- Tout ce qui est dû et pas encore envoyé (cartes, arrivées, fin du date, messages).
-- Les heures suivent js/timeline.js, en heure de Paris. Les jeux partent de l'arrivée des deux
-- (bouton « Je suis arrivé·e ») + 30 min ; sans arrivée des deux à 20h45, on démarre à 20h45.
drop function if exists public.pending_pushes();
create or replace function public.pending_pushes()
returns table (user_id uuid, date_id uuid, key text, at timestamptz, body text, vnow timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with d as (
    select dt.id, dt.a, dt.b, dt.created_at, dt.closed_by, dt.date_at, (dt.date_at at time zone 'Europe/Paris')::date as dday,
           now() + coalesce(dt.demo_offset_ms, 0) * interval '1 millisecond' as vn
    from dates dt
    where dt.date_at > now() - interval '2 days'
  ),
  p as (
    select d.*, u.uid, case when u.uid = d.a then d.b else d.a end as other
    from d cross join lateral (values (d.a), (d.b)) as u(uid)
    where not (u.uid = any(d.closed_by))
  ),
  s as (
    select p.*,
      (select count(*) = 2 from answers x where x.date_id = p.id and x.key = 'accept' and x.value = 'true'::jsonb) as both_ok,
      (select max(x.updated_at) from answers x where x.date_id = p.id and x.key = 'accept') as ok_at,
      (select count(*) = 2 from answers x where x.date_id = p.id and x.key = 'again') as both_again,
      (select max(x.updated_at) from answers x where x.date_id = p.id and x.key = 'again') as again_at,
      (select count(*) = 2 from answers x where x.date_id = p.id and x.key = 'guessed') as both_guessed,
      (select max(x.updated_at) from answers x where x.date_id = p.id and x.key = 'guessed') as guessed_at,
      public.ms_ts((select x.value from answers x where x.date_id = p.id and x.user_id = p.uid and x.key = 'arrived')) as my_arr,
      public.ms_ts((select x.value from answers x where x.date_id = p.id and x.user_id = p.other and x.key = 'arrived')) as their_arr,
      (select public.ms_ts(x.value->'at') from answers x where x.date_id = p.id and x.key = 'ended' order by x.updated_at limit 1) as ended_at,
      (select x.user_id from answers x where x.date_id = p.id and x.key = 'ended' order by x.updated_at limit 1) as ended_by,
      coalesce((select pr.data->>'firstName' from profiles pr where pr.id = p.other), 'Ton date') as oname
    from p
  ),
  t as (
    select s.*,
      case when s.my_arr is not null and s.their_arr is not null
           then least(greatest(s.my_arr, s.their_arr), s.date_at + interval '45 minutes')
           else s.date_at + interval '45 minutes' end as st
    from s
  ),
  m as (
    select t.id as m_date, t.uid as m_user, k.key as m_key, k.at as m_at, k.body as m_body, t.vn as m_now
    from t cross join lateral (values
      ('invite',   t.created_at, 'Quelqu’un a pensé à toi. Ouvre vite.', true),
      ('cadrage',  greatest(t.created_at, t.ok_at), 'C’est calé : vous avez dit oui tous les deux.', t.both_ok),
      ('tonTour',  greatest(t.created_at, ((t.dday - 3) + time '10:00') at time zone 'Europe/Paris'), 'À ton tour. Réponse attendue avant demain midi.', t.both_ok),
      ('phrase',   greatest(t.created_at + interval '2 hours', ((t.dday - 2) + time '12:00') at time zone 'Europe/Paris'), 'Ce qu’on a écrit pour toi est arrivé.', t.both_ok),
      ('lieu',     ((t.dday - 1) + time '20:00') at time zone 'Europe/Paris', 'Le lieu est fixé. Ton pari et ton petit mot t’attendent.', t.both_ok),
      ('regles',   (t.dday + time '10:00') at time zone 'Europe/Paris', 'Les règles, avant ce soir.', t.both_ok),
      ('objectif', (t.dday + time '14:00') at time zone 'Europe/Paris', 'Ton objectif secret. Personne d’autre ne le sait.', t.both_ok),
      ('chat',     t.date_at - interval '1 hour', 'La discussion est ouverte. Vous vous voyez dans une heure.', t.both_ok),
      ('arrive',   t.their_arr, t.oname || ' est arrivé·e. Appuie sur « Je suis arrivé·e » dès que tu y es.', t.both_ok and t.their_arr is not null and t.my_arr is null),
      ('start',    greatest(t.my_arr, t.their_arr), 'Vous êtes là tous les deux : le date commence. Premier jeu dans 30 min.', t.both_ok and t.my_arr is not null and t.their_arr is not null),
      ('jeu1',     t.st + interval '30 minutes', 'Premier jeu.', t.both_ok),
      ('jeu2',     t.st + interval '60 minutes', 'Deuxième jeu.', t.both_ok),
      ('jeu3',     t.st + interval '90 minutes', 'Troisième jeu. Et vous pouvez parler boulot.', t.both_ok),
      ('jeu4',     t.st + interval '120 minutes', 'Quatrième jeu.', t.both_ok),
      ('pari',     t.st + interval '135 minutes', 'On rouvre les paris.', t.both_ok),
      ('reveal',   t.st + interval '160 minutes', 'On révèle les objectifs.', t.both_ok),
      ('score',    greatest(t.st + interval '160 minutes', t.guessed_at), 'Les points sont comptés : qui a gagné ?', t.both_ok and t.both_guessed),
      ('fin',      t.ended_at, t.oname || ' a mis fin au date.', t.ended_by = t.other),
      ('apres',    ((t.dday + 1) + time '11:00') at time zone 'Europe/Paris', 'Et maintenant ? Une dernière question.', t.both_ok),
      ('verdict',  greatest(((t.dday + 1) + time '11:00') at time zone 'Europe/Paris', t.again_at), 'Vous avez répondu tous les deux.', t.both_again)
    ) as k(key, at, body, ready)
    where k.ready and k.at is not null and k.at <= t.vn
      and (t.ended_at is null or k.key = 'fin' or k.at <= t.ended_at)
    union all
    -- Nouveaux messages de la discussion (pour la personne qui les reçoit).
    select mm.date_id, case when mm.user_id = dt.a then dt.b else dt.a end, 'msg:' || mm.id, mm.created_at,
           coalesce(pr.data->>'firstName', 'Ton date') || ' : ' || left(mm.body, 90), now()
    from messages mm
    join dates dt on dt.id = mm.date_id
    left join profiles pr on pr.id = mm.user_id
    where mm.created_at > now() - interval '15 minutes'
      and not ((case when mm.user_id = dt.a then dt.b else dt.a end) = any(dt.closed_by))
  )
  select m.m_user, m.m_date, m.m_key, m.m_at, m.m_body, m.m_now from m
  where not exists (select 1 from push_log l where l.date_id = m.m_date and l.user_id = m.m_user and l.key = m.m_key);
end $$;
revoke all on function public.pending_pushes() from public, anon, authenticated;

-- Messages dus maintenant : les note comme envoyés et renvoie, pour chaque personne, le plus récent
-- (si plusieurs cartes se sont débloquées d'un coup, un seul message). Ignore ce qui a plus de 3 h,
-- et ce qui concerne quelqu'un qui a l'appli ouverte (il le voit déjà, en bannière).
create or replace function public.due_card_pushes() returns table (user_id uuid, date_id uuid, key text, body text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (select * from public.pending_pushes()),
  ins as (
    insert into push_log (date_id, user_id, key)
    select c.date_id, c.user_id, c.key from c
    on conflict do nothing
    returning push_log.date_id, push_log.user_id, push_log.key
  )
  select distinct on (c.user_id) c.user_id, c.date_id, c.key, c.body
  from ins join c on c.date_id = ins.date_id and c.user_id = ins.user_id and c.key = ins.key
  where c.at > c.vnow - interval '3 hours'
    and not public.is_present(c.user_id)
  order by c.user_id, c.at desc;
end $$;
revoke all on function public.due_card_pushes() from public, anon, authenticated;

-- Tout ce qu'il faut envoyer maintenant : cartes + messages + file ponctuelle.
create or replace function public.due_pushes() returns table (user_id uuid, date_id uuid, key text, body text)
language plpgsql security definer set search_path = public as $$
begin
  return query select * from public.due_card_pushes();
  return query
    with q as (
      update push_queue set sent_at = now() where sent_at is null and created_at > now() - interval '1 hour'
      returning push_queue.id, push_queue.user_id, push_queue.body
    )
    select q.user_id, null::uuid, 'queue:' || q.id, q.body from q;
end $$;
revoke all on function public.due_pushes() from public, anon, authenticated;

-- Réveille la fonction push tout de suite (appel HTTP asynchrone, envoyé après la transaction).
create or replace function public.kick_push() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := (select function_url from public.push_config where id = 1),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select cron_secret from public.push_config where id = 1)),
    body := '{}'::jsonb);
exception when others then null;  -- pg_net absent : la tâche planifiée prendra le relais
end $$;
revoke all on function public.kick_push() from public, anon, authenticated;

-- Appelée toutes les 10 secondes : n'appelle la fonction push que s'il y a quelque chose à envoyer
-- (une carte dont l'heure est passée, un message, une notification test).
create or replace function public.kick_if_due() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.pending_pushes())
     or exists (select 1 from push_queue where sent_at is null and created_at > now() - interval '1 hour') then
    perform public.kick_push();
  end if;
end $$;
revoke all on function public.kick_if_due() from public, anon, authenticated;

-- Notifications instantanées : un message, une arrivée, une fin de date, une avance du temps (démo)
-- déclenchent l'envoi immédiatement, sans attendre la tâche planifiée.
create or replace function public.trg_kick_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.kick_push();
  return null;
end $$;
drop trigger if exists messages_kick on public.messages;
create trigger messages_kick after insert on public.messages for each row execute function public.trg_kick_push();
drop trigger if exists answers_kick on public.answers;
create trigger answers_kick after insert or update on public.answers for each row
  when (new.key in ('accept', 'arrived', 'ended', 'again', 'guessed')) execute function public.trg_kick_push();
drop trigger if exists dates_kick on public.dates;
create trigger dates_kick after update of demo_offset_ms on public.dates for each row execute function public.trg_kick_push();
drop trigger if exists queue_kick on public.push_queue;
create trigger queue_kick after insert on public.push_queue for each row execute function public.trg_kick_push();

-- Tâche planifiée : toutes les 10 secondes, vérifie s'il y a une carte à envoyer (pg_cron + pg_net).
do $$
begin
  create extension if not exists pg_net;
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'cai-push') then
    perform cron.unschedule('cai-push');
  end if;
  begin
    perform cron.schedule('cai-push', '10 seconds', 'select public.kick_if_due()');
  exception when others then
    -- pg_cron trop ancien pour les secondes : chaque minute.
    perform cron.schedule('cai-push', '* * * * *', 'select public.kick_if_due()');
  end;
exception when others then
  raise notice 'pg_net / pg_cron indisponible (%). Active-les dans Database → Extensions puis relance ce script.', sqlerrm;
end $$;

-- Temps réel (Supabase Realtime) : messages, réponses et avance du temps arrivent instantanément dans l'appli.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'answers', 'dates'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
exception when others then
  raise notice 'Realtime indisponible (%). L’appli se mettra à jour toutes les quelques secondes.', sqlerrm;
end $$;

create table if not exists public.admins (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;
grant execute on function public.is_admin() to authenticated;

-- Admin (mode démo) : passer directement à la recherche la plus large, pour tester sans attendre 15 min.
create or replace function public.admin_skip_search() returns void
language sql security definer set search_path = public as $$
  update profiles set searching_since = now() - interval '1 day'
  where id = auth.uid() and public.is_admin() and searching_since is not null
$$;
revoke all on function public.admin_skip_search() from public, anon;
grant execute on function public.admin_skip_search() to authenticated;

-- Admin (mode démo) : liste des comptes, pour choisir son match.
drop function if exists public.admin_list_users();
create or replace function public.admin_list_users() returns table (id uuid, first_name text, email text, city text, gender text, busy boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.data->>'firstName', u.email::text, p.city, p.gender, public.is_busy(p.id)
  from profiles p join auth.users u on u.id = p.id
  where public.is_admin() and p.id <> auth.uid()
  order by p.updated_at desc
  limit 200
$$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- Admin (mode démo) : crée un date avec la personne choisie (les dates en cours des deux sont refermés).
create or replace function public.admin_match_with(target uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  new_id uuid;
  objs text[] := array['vingt', 'souvenir', 'fourire', 'chanson', 'ailleurs', 'fierte', 'enfant', 'plat'];
  i int := 1 + floor(random() * 8)::int;
  j int := 1 + floor(random() * 7)::int;
begin
  if not public.is_admin() then raise exception 'Réservé aux admins'; end if;
  if target is null or target = me or not exists (select 1 from profiles where id = target) then raise exception 'Personne introuvable'; end if;
  if j >= i then j := j + 1; end if;
  update dates d set closed_by = array(select distinct unnest(d.closed_by || array[d.a, d.b]))
  where (d.a in (me, target) or d.b in (me, target)) and d.date_at > now() - interval '2 days';
  insert into dates (a, b, date_at, objectives, score)
  values (me, target, (((now() at time zone 'Europe/Paris')::date + 3) + time '20:00') at time zone 'Europe/Paris',
          jsonb_build_object(me::text, objs[i], target::text, objs[j]),
          (select public.match_score(a.data, b.data) from profiles a, profiles b where a.id = me and b.id = target))
  returning id into new_id;
  update profiles set searching_since = null where id in (me, target);
  return new_id;
end $$;
revoke all on function public.admin_match_with(uuid) from public, anon;
grant execute on function public.admin_match_with(uuid) to authenticated;

-- Admin (mode démo) : avance le temps du date pour les deux personnes (cartes et notifications comprises).
create or replace function public.admin_set_demo_offset(p_date uuid, ms bigint) returns void
language sql security definer set search_path = public as $$
  update dates set demo_offset_ms = ms
  where id = p_date and public.is_admin() and auth.uid() in (a, b)
$$;
revoke all on function public.admin_set_demo_offset(uuid, bigint) from public, anon;
grant execute on function public.admin_set_demo_offset(uuid, bigint) to authenticated;

insert into public.admins select id from auth.users where email = 'fa67hussain@gmail.com' on conflict do nothing;

-- Nettoyage : retirer le numéro des anciens profils.
update public.profiles set data = data - 'phone' where data ? 'phone';

-- ================================================================ Diagnostic (admin)
-- Vérifie chaque maillon : tâches planifiées, fonction push, clés, abonnements, derniers envois.
create or replace function public.admin_diagnostics() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  out jsonb := '{}'::jsonb;
  me uuid := auth.uid();
  v jsonb;
begin
  if not public.is_admin() then raise exception 'Réservé aux admins'; end if;
  out := out || jsonb_build_object(
    'schema_ok', true,
    'demo_column', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dates' and column_name = 'demo_offset_ms'),
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'vapid', (select vapid_public is not null from push_config where id = 1),
    'function_url', (select function_url from push_config where id = 1),
    'my_subscriptions', (select count(*) from push_subscriptions where user_id = me),
    'all_subscriptions', (select count(*) from push_subscriptions),
    'last_push', (select max(sent_at) from push_log),
    'pushes_last_hour', (select count(*) from push_log where sent_at > now() - interval '1 hour')
  );
  begin
    execute $q$ select coalesce(jsonb_agg(jsonb_build_object('job', jobname, 'schedule', schedule, 'active', active)), '[]'::jsonb) from cron.job where jobname like 'cai-%' $q$ into v;
    out := out || jsonb_build_object('cron_jobs', v);
    execute $q$ select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select j.jobname as job, d.status, d.return_message as message, d.start_time as at
      from cron.job_run_details d join cron.job j on j.jobid = d.jobid
      where j.jobname like 'cai-%' order by d.start_time desc limit 4) x $q$ into v;
    out := out || jsonb_build_object('cron_runs', v);
  exception when others then out := out || jsonb_build_object('cron_error', sqlerrm);
  end;
  begin
    execute $q$ select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select status_code, left(coalesce(content, error_msg, ''), 160) as body, created as at
      from net._http_response order by created desc limit 3) x $q$ into v;
    out := out || jsonb_build_object('function_responses', v);
  exception when others then out := out || jsonb_build_object('net_error', sqlerrm);
  end;
  return out;
end $$;
revoke all on function public.admin_diagnostics() from public, anon;
grant execute on function public.admin_diagnostics() to authenticated;

-- Admin : notification test, pour soi et pour son match en cours.
create or replace function public.admin_test_push() returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  other uuid;
begin
  if not public.is_admin() then raise exception 'Réservé aux admins'; end if;
  insert into push_queue (user_id, body) values (me, 'Notification test : tout fonctionne ✓');
  select case when d.a = me then d.b else d.a end into other from dates d
  where (d.a = me or d.b = me) and not (me = any(d.closed_by)) and d.date_at > now() - interval '2 days'
  order by d.created_at desc limit 1;
  if other is not null then insert into push_queue (user_id, body) values (other, 'Notification test envoyée par l''admin ✓'); end if;
  return case when other is null then 1 else 2 end;
end $$;
revoke all on function public.admin_test_push() from public, anon;
grant execute on function public.admin_test_push() to authenticated;

-- ================================================================ Vérification d'identité
-- Chaque personne envoie une photo de sa pièce d'identité + un selfie (stockage privé « id-docs »).
-- Un admin compare, indique le sexe inscrit sur le document, valide ou refuse. Les photos sont alors supprimées.
create table if not exists public.verifications (
  user_id uuid primary key references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  sex text check (sex in ('homme', 'femme')),
  doc_path text,
  selfie_path text,
  note text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.verifications enable row level security;
revoke all on public.verifications from anon, authenticated;

create or replace function public.my_verification() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('status', v.status, 'note', v.note) from verifications v where v.user_id = auth.uid()),
    case when (select verified from profiles where id = auth.uid()) then jsonb_build_object('status', 'approved')
         else jsonb_build_object('status', 'none') end)
$$;
revoke all on function public.my_verification() from public, anon;
grant execute on function public.my_verification() to authenticated;

create or replace function public.submit_verification(p_doc text, p_selfie text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if split_part(p_doc, '/', 1) <> auth.uid()::text or split_part(p_selfie, '/', 1) <> auth.uid()::text then
    raise exception 'Chemin invalide';
  end if;
  insert into verifications (user_id, status, doc_path, selfie_path, submitted_at, note, sex, decided_at)
  values (auth.uid(), 'pending', p_doc, p_selfie, now(), null, null, null)
  on conflict (user_id) do update set status = 'pending', doc_path = excluded.doc_path, selfie_path = excluded.selfie_path,
    submitted_at = now(), note = null, sex = null, decided_at = null
  where verifications.status <> 'approved';
end $$;
revoke all on function public.submit_verification(text, text) from public, anon;
grant execute on function public.submit_verification(text, text) to authenticated;

drop function if exists public.admin_verifications();
create or replace function public.admin_verifications()
returns table (user_id uuid, first_name text, birthdate date, email text, city text, doc_path text, selfie_path text, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select v.user_id, p.data->>'firstName', p.birthdate, u.email::text, p.city, v.doc_path, v.selfie_path, v.submitted_at
  from verifications v
  join auth.users u on u.id = v.user_id
  left join profiles p on p.id = v.user_id
  where public.is_admin() and v.status = 'pending'
  order by v.submitted_at
$$;
revoke all on function public.admin_verifications() from public, anon;
grant execute on function public.admin_verifications() to authenticated;

-- Décision de l'admin. Renvoie les chemins des photos, que l'appli supprime aussitôt du stockage.
create or replace function public.admin_decide_verification(p_user uuid, p_ok boolean, p_sex text, p_note text) returns text[]
language plpgsql security definer set search_path = public as $$
declare
  paths text[];
begin
  if not public.is_admin() then raise exception 'Réservé aux admins'; end if;
  if p_ok and p_sex not in ('homme', 'femme') then raise exception 'Sexe manquant'; end if;
  select array[doc_path, selfie_path] into paths from verifications where user_id = p_user;
  update verifications set status = case when p_ok then 'approved' else 'rejected' end,
    sex = case when p_ok then p_sex end, note = p_note, decided_at = now(), doc_path = null, selfie_path = null
  where user_id = p_user;
  if p_ok then
    update profiles set gender = p_sex, verified = true where id = p_user;
    insert into push_queue (user_id, body) values (p_user, 'Ton identité est vérifiée ✓ Je commence à te chercher quelqu’un.');
  else
    update profiles set verified = false where id = p_user;
    insert into push_queue (user_id, body) values (p_user, 'Ta vérification d’identité n’a pas pu être validée. Ouvre l’appli pour renvoyer tes photos.');
  end if;
  return coalesce(paths, '{}');
end $$;
revoke all on function public.admin_decide_verification(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_decide_verification(uuid, boolean, text, text) to authenticated;

-- Stockage privé des documents : chacun dépose dans son dossier ; seuls les admins peuvent les lire.
do $$
begin
  insert into storage.buckets (id, name, public) values ('id-docs', 'id-docs', false) on conflict (id) do nothing;
  drop policy if exists "id-docs: déposer les siens" on storage.objects;
  create policy "id-docs: déposer les siens" on storage.objects for insert to authenticated
    with check (bucket_id = 'id-docs' and (storage.foldername(name))[1] = auth.uid()::text);
  drop policy if exists "id-docs: remplacer les siens" on storage.objects;
  create policy "id-docs: remplacer les siens" on storage.objects for update to authenticated
    using (bucket_id = 'id-docs' and (storage.foldername(name))[1] = auth.uid()::text);
  drop policy if exists "id-docs: lire (soi ou admin)" on storage.objects;
  create policy "id-docs: lire (soi ou admin)" on storage.objects for select to authenticated
    using (bucket_id = 'id-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
  drop policy if exists "id-docs: supprimer (soi ou admin)" on storage.objects;
  create policy "id-docs: supprimer (soi ou admin)" on storage.objects for delete to authenticated
    using (bucket_id = 'id-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
exception when others then
  raise notice 'Stockage indisponible (%). La vérification d’identité ne pourra pas recevoir de photos.', sqlerrm;
end $$;
