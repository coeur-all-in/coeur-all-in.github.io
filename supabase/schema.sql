-- Cœur All In — schéma Supabase
-- À coller tel quel dans Supabase → SQL Editor → Run. Peut être relancé sans risque (mise à jour).
-- Pré-requis : Authentication → Sign In / Providers → Email activé, « Confirm email » désactivé
-- (sinon chaque inscription attend un e-mail de confirmation).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- Tables

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  data jsonb not null,                     -- profil complet (prénom, physique, caractère…)
  gender text not null,
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

-- Le numéro n'est lisible par personne via l'API : seulement par partner_phone(), à 19h30 le jour J.
create table if not exists public.contacts (
  id uuid primary key references auth.users on delete cascade,
  phone text
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

-- Recherche progressive : depuis quand la personne attend, et dernière ouverture de l'appli.
alter table public.profiles add column if not exists searching_since timestamptz default now();
alter table public.profiles add column if not exists last_seen timestamptz default now();
create index if not exists profiles_searching_idx on public.profiles(searching_since) where searching_since is not null;

-- ---------------------------------------------------------------- Helpers

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

-- Score de compatibilité sur 100 — même logique que js/matching.js.
create or replace function public.match_score(p jsonb, q jsonb) returns int
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
-- Plus une personne attend, plus ses critères s'assouplissent :
--   niveau | attente      | distance | âge     | compatibilité min | soir commun
--   0      | < 10 min     | x1       | exact   | 55 / 100          | obligatoire
--   1      | < 1 h        | x1,5     | ± 2 ans | 40                | obligatoire
--   2      | < 6 h        | x2       | ± 4 ans | 25                | non
--   3      | < 24 h       | x3       | ± 6 ans | 0                 | non
--   4      | au-delà      | x5       | ± 10 ans| 0                 | non
-- Jamais assoupli : le genre recherché (dans les deux sens), la majorité, ne pas revoir quelqu'un déjà proposé.
-- Chaque personne est jugée avec SON propre niveau : on assouplit pour celui qui attend, pas pour l'autre.

create or replace function public.search_level(since timestamptz) returns int
language sql stable as $$
  select case
    when since is null or now() - since < interval '10 minutes' then 0
    when now() - since < interval '1 hour' then 1
    when now() - since < interval '6 hours' then 2
    when now() - since < interval '24 hours' then 3
    else 4 end
$$;
create or replace function public.lvl_km(l int) returns numeric language sql immutable as $$ select (array[1, 1.5, 2, 3, 5]::numeric[])[l + 1] $$;
create or replace function public.lvl_age(l int) returns int language sql immutable as $$ select (array[0, 2, 4, 6, 10])[l + 1] $$;
create or replace function public.lvl_score(l int) returns int language sql immutable as $$ select (array[55, 40, 25, 0, 0])[l + 1] $$;

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
  if me.id is null or not me.active or me.searching_since is null or public.is_busy(uid) then return null; end if;
  ml := public.search_level(me.searching_since);

  select p.id, p.availability, x.sc into cand
  from profiles p
  cross join lateral (
    select public.match_score(me.data, p.data) as sc,
           public.search_level(p.searching_since) as pl,
           public.km(me.lat, me.lng, p.lat, p.lng, me.city, p.city) as d,
           extract(year from age(p.birthdate))::int as page,
           extract(year from age(me.birthdate))::int as mage
  ) x
  where p.id <> me.id and p.active
    and p.searching_since is not null
    and p.last_seen > now() - interval '14 days'
    and p.gender = any(me.seeking) and me.gender = any(p.seeking)
    and x.page >= 18 and x.mage >= 18
    and x.page between me.age_min - public.lvl_age(ml) and me.age_max + public.lvl_age(ml)
    and x.mage between p.age_min - public.lvl_age(x.pl) and p.age_max + public.lvl_age(x.pl)
    and x.d <= least(me.max_km * public.lvl_km(ml), p.max_km * public.lvl_km(x.pl), 300)
    and x.sc >= greatest(public.lvl_score(ml), public.lvl_score(x.pl))
    and (greatest(ml, x.pl) >= 2 or me.availability && p.availability)
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

  update profiles set last_seen = now(), searching_since = coalesce(searching_since, now()) where id = me.id;
  if not me.active then return jsonb_build_object('date_id', null, 'paused', true); end if;

  new_id := public.match_for(me.id);
  if new_id is not null then return jsonb_build_object('date_id', new_id); end if;

  select public.search_level(searching_since) into l from profiles where id = me.id;
  return jsonb_build_object(
    'date_id', null,
    'level', l,
    'since', (select searching_since from profiles where id = me.id),
    'km', round(me.max_km * public.lvl_km(l)),
    'age_pad', public.lvl_age(l),
    'min_score', public.lvl_score(l),
    'waiting', (select count(*) from profiles p where p.active and p.searching_since is not null and p.id <> me.id
                and p.last_seen > now() - interval '14 days' and p.gender = any(me.seeking) and me.gender = any(p.seeking))
  );
end $$;

-- Tâche planifiée : toutes les 5 minutes, tente un match pour chaque personne en attente,
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

-- Le numéro de l'autre, seulement à partir de 19h30 le jour J, et si les deux ont dit oui.
create or replace function public.partner_phone(p_date uuid) returns text
language sql stable security definer set search_path = public as $$
  select c.phone
  from dates d
  join contacts c on c.id = case when d.a = auth.uid() then d.b else d.a end
  where d.id = p_date
    and auth.uid() in (d.a, d.b)
    and now() >= d.date_at - interval '30 minutes'
    and (select count(*) from answers x where x.date_id = d.id and x.key = 'accept' and x.value = 'true'::jsonb) = 2
$$;

-- ---------------------------------------------------------------- Sécurité (RLS)

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
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

drop policy if exists "contact: le sien" on public.contacts;
create policy "contact: le sien" on public.contacts for all using (id = auth.uid()) with check (id = auth.uid());

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
revoke all on function public.partner_phone(uuid) from public, anon;
grant execute on function public.find_match() to authenticated;
grant execute on function public.close_date(uuid) to authenticated;
grant execute on function public.partner_phone(uuid) to authenticated;

-- ---------------------------------------------------------------- Tâche planifiée (pg_cron)
do $$
begin
  create extension if not exists pg_cron;
  if exists (select 1 from cron.job where jobname = 'cai-match') then
    perform cron.unschedule('cai-match');
  end if;
  perform cron.schedule('cai-match', '*/5 * * * *', 'select public.match_waiting()');
exception when others then
  raise notice 'pg_cron indisponible (%). Le matching se fera quand les gens ouvrent l''appli.', sqlerrm;
end $$;

-- Optionnel : supprimer les anciens comptes de test anonymes (avant les comptes e-mail).
-- delete from auth.users where is_anonymous;
