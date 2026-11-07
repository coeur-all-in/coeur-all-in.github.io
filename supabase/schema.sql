-- Cœur All In — schéma Supabase
-- À coller tel quel dans Supabase → SQL Editor → Run. Peut être relancé sans risque (mise à jour).
-- Pré-requis : Authentication → Sign In / Providers → Email activé, « Confirm email » désactivé
-- (sinon chaque inscription attend un e-mail de confirmation).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- Tables

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null,                     -- profil complet (prénom, physique, caractère…)
  gender text,                             -- homme / femme (questionnaire)
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

-- verified : vérification du visage faite (la personne a tourné la tête devant la caméra).
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
  if public.in_pending_setup(uid) then return null; end if;
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
    and not public.in_pending_setup(p.id)
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
  if public.in_pending_setup(me.id) then return jsonb_build_object('date_id', null, 'setup_pending', true); end if;
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

-- La vérification (visage) et la présence ne s'écrivent jamais directement depuis l'appli.
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, data, gender, seeking, birthdate, age_min, age_max, city, lat, lng, max_km, availability, active, updated_at)
  on public.profiles to authenticated;
grant update (id, data, gender, seeking, birthdate, age_min, age_max, city, lat, lng, max_km, availability, active, updated_at)
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

-- ================================================================ Vérification « vraie personne »
-- L'appli allume la caméra et demande de tourner la tête (haut, droite, gauche). Tout se passe sur le
-- téléphone : aucune photo ni vidéo n'est envoyée ni stockée. Quand c'est réussi, l'appli le signale ici.
-- (Anciennes vérifications par pièce d'identité : supprimées.)
drop function if exists public.admin_verifications();
drop function if exists public.admin_decide_verification(uuid, boolean, text, text);
drop function if exists public.submit_verification(text, text);
drop table if exists public.verifications;

create or replace function public.complete_liveness() returns void
language sql security definer set search_path = public as $$
  update profiles set verified = true where id = auth.uid()
$$;
revoke all on function public.complete_liveness() from public, anon;
grant execute on function public.complete_liveness() to authenticated;

create or replace function public.my_verification() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', case when coalesce((select verified from profiles where id = auth.uid()), false) then 'approved' else 'none' end)
$$;
revoke all on function public.my_verification() from public, anon;
grant execute on function public.my_verification() to authenticated;

-- ================================================================ Supprimer une discussion
-- Chacun peut supprimer une ancienne discussion de son côté, définitivement.
-- Quand les deux l'ont supprimée, les messages sont effacés de la base.
alter table public.dates add column if not exists chat_deleted_by uuid[] not null default '{}';
create or replace function public.delete_chat(p_date uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d dates;
begin
  select * into d from dates where id = p_date and auth.uid() in (a, b);
  if d.id is null then raise exception 'Discussion introuvable'; end if;
  update dates set chat_deleted_by = array(select distinct unnest(chat_deleted_by || auth.uid())) where id = p_date
  returning * into d;
  if d.a = any(d.chat_deleted_by) and d.b = any(d.chat_deleted_by) then
    delete from messages where date_id = p_date;
  end if;
end $$;
revoke all on function public.delete_chat(uuid) from public, anon;
grant execute on function public.delete_chat(uuid) to authenticated;
-- Les messages d'une discussion supprimée de mon côté ne me sont plus montrés.
drop policy if exists "messages: lire ceux de son date" on public.messages;
create policy "messages: lire ceux de son date" on public.messages for select using (
  public.in_date(date_id)
  and not exists (select 1 from dates d where d.id = messages.date_id and auth.uid() = any(d.chat_deleted_by)));

-- ================================================================ Amis
create table if not exists public.friendships (
  id bigserial primary key,
  requester uuid not null references auth.users on delete cascade,
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
create unique index if not exists friendships_pair_idx on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
revoke all on public.friendships from anon, authenticated;

create or replace function public.is_friend(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships f where f.status = 'accepted'
    and ((f.requester = auth.uid() and f.addressee = other) or (f.addressee = auth.uid() and f.requester = other)))
$$;

-- Ajouter un ami par son e-mail.
create or replace function public.friend_request(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  other uuid;
  oname text;
  f friendships;
begin
  if me is null then raise exception 'Connexion requise'; end if;
  select u.id into other from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if other is null then return jsonb_build_object('status', 'notfound'); end if;
  if other = me then return jsonb_build_object('status', 'self'); end if;
  oname := coalesce((select data->>'firstName' from profiles where id = other), split_part(p_email, '@', 1));
  select * into f from friendships where least(requester, addressee) = least(me, other) and greatest(requester, addressee) = greatest(me, other);
  if f.id is not null then
    if f.status = 'accepted' then return jsonb_build_object('status', 'already', 'name', oname); end if;
    if f.addressee = me then  -- l'autre m'avait déjà demandé : on devient amis
      update friendships set status = 'accepted' where id = f.id;
      insert into push_queue (user_id, body) values (other, coalesce((select data->>'firstName' from profiles where id = me), 'Quelqu’un') || ' a accepté ta demande d’ami.');
      return jsonb_build_object('status', 'accepted', 'name', oname);
    end if;
    return jsonb_build_object('status', 'pending', 'name', oname);
  end if;
  insert into friendships (requester, addressee) values (me, other);
  insert into push_queue (user_id, body) values (other, coalesce((select data->>'firstName' from profiles where id = me), 'Quelqu’un') || ' veut t’ajouter en ami sur Cœur All In.');
  return jsonb_build_object('status', 'sent', 'name', oname);
end $$;

create or replace function public.friend_respond(p_id bigint, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare f friendships;
begin
  select * into f from friendships where id = p_id and addressee = auth.uid() and status = 'pending';
  if f.id is null then raise exception 'Demande introuvable'; end if;
  if p_ok then
    update friendships set status = 'accepted' where id = p_id;
    insert into push_queue (user_id, body) values (f.requester, coalesce((select data->>'firstName' from profiles where id = auth.uid()), 'Quelqu’un') || ' a accepté ta demande d’ami.');
  else
    delete from friendships where id = p_id;
  end if;
end $$;

create or replace function public.friend_remove(p_id bigint) returns void
language sql security definer set search_path = public as $$
  delete from friendships where id = p_id and auth.uid() in (requester, addressee)
$$;

drop function if exists public.my_friends();
create or replace function public.my_friends()
returns table (id bigint, other uuid, name text, email text, status text, incoming boolean)
language sql stable security definer set search_path = public as $$
  select f.id, o.id, coalesce(p.data->>'firstName', split_part(u.email, '@', 1)), u.email::text, f.status, f.addressee = auth.uid()
  from friendships f
  cross join lateral (select case when f.requester = auth.uid() then f.addressee else f.requester end as id) o
  join auth.users u on u.id = o.id
  left join profiles p on p.id = o.id
  where auth.uid() in (f.requester, f.addressee)
  order by f.status desc, f.created_at desc
$$;

-- ================================================================ « Je matche pour mon ami »
-- A1 et A2 (amis dans l'appli) se choisissent. A1 invite son ami B1 (e-mail), A2 invite B2.
-- Si B1 et B2 acceptent, A1 écrit la fiche de B1 et A2 celle de B2 (A1 voit la fiche de B2, A2 celle de B1).
-- Puis un date normal est créé entre B1 et B2, qui ne savent pas qui est l'autre.
alter table public.dates add column if not exists setup_id uuid;
alter table public.dates add column if not exists fiches jsonb not null default '{}';

create table if not exists public.setups (
  id uuid primary key default gen_random_uuid(),
  a1 uuid not null references auth.users on delete cascade,
  a2 uuid not null references auth.users on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'dated', 'cancelled')),
  b1_email text, b2_email text,
  b1 uuid references auth.users on delete set null,
  b2 uuid references auth.users on delete set null,
  b1_token text unique, b2_token text unique,
  b1_status text check (b1_status in ('invited', 'accepted', 'declined')),
  b2_status text check (b2_status in ('invited', 'accepted', 'declined')),
  fiche1 jsonb, fiche2 jsonb,
  date_id uuid references public.dates on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.setups enable row level security;
revoke all on public.setups from anon, authenticated;

-- E-mails d'invitation : non utilisés pour l'instant (les invitations passent par un lien à partager).
-- La file reste prête si un service d'envoi est branché plus tard.
create table if not exists public.mail_queue (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  html text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.mail_queue enable row level security;
revoke all on public.mail_queue from anon, authenticated;

create or replace function public.first_name(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select data->>'firstName' from profiles where id = uid), 'Quelqu’un')
$$;

create or replace function public.setup_propose(p_friend uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not public.is_friend(p_friend) then raise exception 'Ajoute d’abord cette personne en ami.'; end if;
  if exists (select 1 from setups where status in ('proposed', 'accepted')
             and ((a1 = auth.uid() and a2 = p_friend) or (a1 = p_friend and a2 = auth.uid()))) then
    raise exception 'Vous avez déjà un match en préparation tous les deux.';
  end if;
  insert into setups (a1, a2) values (auth.uid(), p_friend) returning id into new_id;
  insert into push_queue (user_id, body) values (p_friend, public.first_name(auth.uid()) || ' veut organiser un date avec toi : chacun présente un ami. Ouvre l’appli.');
  return new_id;
end $$;

create or replace function public.setup_respond(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s setups;
begin
  select * into s from setups where id = p_id and a2 = auth.uid() and status = 'proposed';
  if s.id is null then raise exception 'Proposition introuvable'; end if;
  update setups set status = case when p_ok then 'accepted' else 'cancelled' end, updated_at = now() where id = p_id;
  insert into push_queue (user_id, body) values (s.a1, public.first_name(auth.uid()) ||
    case when p_ok then ' est partant·e : invite maintenant ton ami à rencontrer le sien.' else ' ne peut pas pour ce match.' end);
end $$;

create or replace function public.setup_cancel(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update setups set status = 'cancelled', updated_at = now()
  where id = p_id and auth.uid() in (a1, a2) and status in ('proposed', 'accepted')
$$;

-- A invite son ami B par e-mail. Renvoie le jeton du lien d'invitation (à partager aussi par message).
create or replace function public.setup_invite(p_id uuid, p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  s setups;
  side int;
  tok text := encode(gen_random_bytes(18), 'hex');
  mail text := lower(trim(p_email));
  bid uuid;
  link text;
  mname text := public.first_name(auth.uid());
begin
  select * into s from setups where id = p_id and status = 'accepted' and auth.uid() in (a1, a2);
  if s.id is null then raise exception 'Match introuvable'; end if;
  if mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresse e-mail invalide.'; end if;
  side := case when s.a1 = auth.uid() then 1 else 2 end;
  if (side = 1 and s.b1_status = 'accepted') or (side = 2 and s.b2_status = 'accepted') then raise exception 'Ton ami a déjà accepté.'; end if;
  select id into bid from auth.users where lower(email) = mail;
  if bid in (s.a1, s.a2) then raise exception 'Invite quelqu’un d’autre que vous deux.'; end if;
  if side = 1 then update setups set b1_email = mail, b1_token = tok, b1_status = 'invited', b1 = null, updated_at = now() where id = p_id;
  else update setups set b2_email = mail, b2_token = tok, b2_status = 'invited', b2 = null, updated_at = now() where id = p_id; end if;
  link := 'https://coeur-all-in.github.io/?invite=' || tok;
  insert into mail_queue (to_email, subject, html) values (mail, mname || ' veut te présenter quelqu’un',
    '<p>Salut,</p><p><b>' || mname || '</b> pense à toi : avec un ami, ils veulent vous présenter l’un à l’autre sur <b>Cœur All In</b>, '
    || 'un rendez-vous sans photo, guidé par des cartes et des jeux.</p><p><a href="' || link || '">Voir la proposition</a></p>'
    || '<p>Si tu acceptes, il te faudra l’appli (gratuite, elle s’installe depuis ce lien).</p>');
  if bid is not null then insert into push_queue (user_id, body) values (bid, mname || ' veut te présenter quelqu’un. Ouvre l’appli.'); end if;
  return tok;
end $$;

-- Ce qu'une invitation montre (même sans compte) : seulement qui t'invite.
create or replace function public.invite_info(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('from', public.first_name(case when s.b1_token = p_token then s.a1 else s.a2 end),
    'status', case when s.status = 'cancelled' then 'cancelled'
                   when s.b1_token = p_token then coalesce(s.b1_status, 'invited') else coalesce(s.b2_status, 'invited') end)
  from setups s where p_token is not null and (s.b1_token = p_token or s.b2_token = p_token)
$$;

create or replace function public.invite_respond(p_token text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  s setups;
  side int;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Crée d’abord ton compte.'; end if;
  select * into s from setups where (b1_token = p_token or b2_token = p_token) and status = 'accepted';
  if s.id is null then raise exception 'Invitation expirée.'; end if;
  side := case when s.b1_token = p_token then 1 else 2 end;
  if me in (s.a1, s.a2) or me is not distinct from (select case when side = 1 then s.b2 else s.b1 end) then raise exception 'Cette invitation est pour quelqu’un d’autre.'; end if;
  if p_ok and not exists (select 1 from profiles where id = me) then raise exception 'Termine d’abord ton portrait.'; end if;
  if p_ok and not coalesce((select verified from profiles where id = me), false) then raise exception 'Fais d’abord la vérification du visage.'; end if;
  if side = 1 then update setups set b1 = case when p_ok then me end, b1_status = case when p_ok then 'accepted' else 'declined' end, updated_at = now() where id = s.id;
  else update setups set b2 = case when p_ok then me end, b2_status = case when p_ok then 'accepted' else 'declined' end, updated_at = now() where id = s.id; end if;
  insert into push_queue (user_id, body) values (case when side = 1 then s.a1 else s.a2 end,
    public.first_name(me) || case when p_ok then ' a accepté ! Écris sa fiche dès que l’autre accepte aussi.' else ' a refusé. Tu peux inviter quelqu’un d’autre.' end);
  select * into s from setups where id = s.id;
  if s.b1_status = 'accepted' and s.b2_status = 'accepted' then
    insert into push_queue (user_id, body) values (s.a1, 'Les deux ont accepté : écris la fiche de ' || public.first_name(s.b1) || '.'),
                                                  (s.a2, 'Les deux ont accepté : écris la fiche de ' || public.first_name(s.b2) || '.');
  end if;
end $$;

-- Invitations reçues dans l'appli (par e-mail du compte).
drop function if exists public.my_invites();
create or replace function public.my_invites() returns table (token text, from_name text)
language sql stable security definer set search_path = public as $$
  select case when lower(s.b1_email) = lower(u.email) then s.b1_token else s.b2_token end,
         public.first_name(case when lower(s.b1_email) = lower(u.email) then s.a1 else s.a2 end)
  from setups s join auth.users u on u.id = auth.uid()
  where s.status = 'accepted'
    and ((lower(s.b1_email) = lower(u.email) and s.b1_status = 'invited') or (lower(s.b2_email) = lower(u.email) and s.b2_status = 'invited'))
$$;

-- A écrit la fiche de son ami. Quand les deux fiches sont là, le date est créé.
create or replace function public.setup_fiche(p_id uuid, p_fiche jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  s setups;
  side int;
  common int[];
  d_day date;
  objs text[] := array['vingt', 'souvenir', 'fourire', 'chanson', 'ailleurs', 'fierte', 'enfant', 'plat'];
  i int := 1 + floor(random() * 8)::int;
  j int := 1 + floor(random() * 7)::int;
  new_id uuid;
  paris_today date := (now() at time zone 'Europe/Paris')::date;
begin
  select * into s from setups where id = p_id and auth.uid() in (a1, a2) and status = 'accepted';
  if s.id is null then raise exception 'Match introuvable'; end if;
  if s.b1_status is distinct from 'accepted' or s.b2_status is distinct from 'accepted' then raise exception 'Les deux amis doivent d’abord accepter.'; end if;
  side := case when s.a1 = auth.uid() then 1 else 2 end;
  if side = 1 then update setups set fiche1 = p_fiche, updated_at = now() where id = p_id;
  else update setups set fiche2 = p_fiche, updated_at = now() where id = p_id; end if;
  select * into s from setups where id = p_id;
  if s.fiche1 is null or s.fiche2 is null then
    insert into push_queue (user_id, body) values (case when side = 1 then s.a2 else s.a1 end,
      public.first_name(auth.uid()) || ' a écrit sa fiche. À toi d’écrire celle de ton ami.');
    return 'waiting';
  end if;
  if public.is_busy(s.b1) or public.is_busy(s.b2) then
    update setups set note = 'busy' where id = p_id;
    return 'busy';
  end if;
  -- Jour du date : jeudi, vendredi ou samedi communs, au moins 3 jours après, 20h (Paris).
  select array_agg(x) into common from unnest(array[6, 5, 4]) x
  where x = any(coalesce((select availability from profiles where id = s.b1), '{6,5,4}'))
    and x = any(coalesce((select availability from profiles where id = s.b2), '{6,5,4}'));
  if common is null then common := array[6]; end if;
  for k in 3..16 loop
    d_day := paris_today + k;
    exit when extract(dow from d_day)::int = any(common);
  end loop;
  if j >= i then j := j + 1; end if;
  insert into dates (a, b, date_at, objectives, setup_id, fiches)
  values (s.b1, s.b2, (d_day + time '20:00') at time zone 'Europe/Paris',
          jsonb_build_object(s.b1::text, objs[i], s.b2::text, objs[j]), s.id,
          jsonb_build_object(s.b1::text, s.fiche1, s.b2::text, s.fiche2))
  returning id into new_id;
  update setups set status = 'dated', date_id = new_id, note = null, updated_at = now() where id = p_id;
  update profiles set searching_since = null where id in (s.b1, s.b2);
  insert into push_queue (user_id, body) values (s.a1, 'Le date est créé ! Tes deux amis viennent de recevoir leur première carte.'),
                                                (s.a2, 'Le date est créé ! Tes deux amis viennent de recevoir leur première carte.');
  return 'dated';
end $$;

-- Tout ce que voit un organisateur (A) de ses matchs pour amis.
-- Chacun voit la fiche de son ami ET celle de l'autre ami. Jamais l'e-mail de l'autre ami.
create or replace function public.my_setups() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'updated' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'status', s.status, 'note', s.note, 'updated', s.updated_at,
      'side', case when s.a1 = auth.uid() then 1 else 2 end,
      'mine', s.a1 = auth.uid(),
      'friend', public.first_name(case when s.a1 = auth.uid() then s.a2 else s.a1 end),
      'my_email', case when s.a1 = auth.uid() then s.b1_email else s.b2_email end,
      'my_token', case when s.a1 = auth.uid() then s.b1_token else s.b2_token end,
      'my_b_status', case when s.a1 = auth.uid() then s.b1_status else s.b2_status end,
      'their_b_status', case when s.a1 = auth.uid() then s.b2_status else s.b1_status end,
      'my_b_name', case when (case when s.a1 = auth.uid() then s.b1 else s.b2 end) is not null then public.first_name(case when s.a1 = auth.uid() then s.b1 else s.b2 end) end,
      'their_b_name', case when (case when s.a1 = auth.uid() then s.b2 else s.b1 end) is not null then public.first_name(case when s.a1 = auth.uid() then s.b2 else s.b1 end) end,
      'my_fiche', case when s.a1 = auth.uid() then s.fiche1 else s.fiche2 end,
      'their_fiche', case when s.a1 = auth.uid() then s.fiche2 else s.fiche1 end,
      'date_at', (select date_at from dates where id = s.date_id)
    ) as x
    from setups s where auth.uid() in (s.a1, s.a2) and s.updated_at > now() - interval '30 days'
  ) t
$$;

-- E-mails à envoyer (appelée par la fonction push).
create or replace function public.due_mails() returns table (id bigint, to_email text, subject text, html text)
language sql security definer set search_path = public as $$
  update mail_queue set sent_at = now()
  where mail_queue.id in (select q.id from mail_queue q where q.sent_at is null and q.created_at > now() - interval '1 day' limit 20)
  returning mail_queue.id, mail_queue.to_email, mail_queue.subject, mail_queue.html
$$;
revoke all on function public.due_mails() from public, anon, authenticated;
drop trigger if exists mail_kick on public.mail_queue;
create trigger mail_kick after insert on public.mail_queue for each row execute function public.trg_kick_push();

do $$
declare f text;
begin
  foreach f in array array['friend_request(text)', 'friend_respond(bigint, boolean)', 'friend_remove(bigint)', 'my_friends()',
    'setup_propose(uuid)', 'setup_respond(uuid, boolean)', 'setup_cancel(uuid)', 'setup_invite(uuid, text)',
    'invite_respond(text, boolean)', 'my_invites()', 'setup_fiche(uuid, jsonb)', 'my_setups()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.invite_info(text) to anon, authenticated;

-- Une personne invitée qui a accepté un match organisé par ses amis attend ce date :
-- elle n'entre pas dans la recherche aléatoire en attendant.
create or replace function public.in_pending_setup(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from setups s where s.status = 'accepted'
    and ((s.b1 = uid and s.b1_status = 'accepted') or (s.b2 = uid and s.b2_status = 'accepted')))
$$;
