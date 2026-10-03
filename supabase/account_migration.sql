-- ============================================================
-- Migration: optioneel account (inloggen met Google of mail)
--
-- Wat het oplevert: je opgeslagen groepen, eigen competities, het lopende
-- toernooi en de beheersleutels van je live toernooi, inschrijving en
-- clubcompetities gaan mee naar een ander toestel, en zijn niet weg als je
-- browsergegevens gewist worden.
--
-- Run in Supabase Dashboard -> SQL Editor. Veilig om opnieuw te draaien.
-- Zie supabase/ACCOUNT.md voor de instellingen in het dashboard die erbij
-- horen (Google, redirect-url, mailsjabloon).
-- ============================================================

-- ── 1. De tabel ─────────────────────────────────────────────
-- Eén rij per ding dat meegaat: een groep, een competitie, een sleutel.
-- Per rij in plaats van één grote rij per account, zodat twee toestellen
-- die tegelijk iets anders wijzigen elkaars werk niet overschrijven.
--
-- updated_at is de klok van het toestel in milliseconden. De nieuwste wint,
-- per rij. Verwijderen is een rij met deleted=true (een "grafsteen"), anders
-- komt een groep die je op je telefoon weggooide terug van je laptop.
create table if not exists public.account_items (
  user_id    uuid   not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text   not null check (kind in ('group','comp','cc','signup','live')),
  item_key   text   not null check (char_length(item_key) between 1 and 100),
  data       jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,
  primary key (user_id, kind, item_key),
  -- Ruim genoeg voor een toernooi van 40 spelers, te krap om er een
  -- opslagdienst van te maken.
  constraint account_items_size check (data is null or pg_column_size(data) <= 524288)
);

-- ── 2. Rechten ──────────────────────────────────────────────
-- Twee sloten. Supabase geeft elke nieuwe tabel in public standaard aan
-- anon én authenticated; dat draaien we hier expliciet terug. Een policy
-- die ooit per ongeluk te ruim wordt komt dan nog steeds niet langs anon.
alter table public.account_items enable row level security;
revoke all on public.account_items from public, anon;
grant select, insert, update, delete on public.account_items to authenticated;

drop policy if exists "Own rows read"   on public.account_items;
drop policy if exists "Own rows insert" on public.account_items;
drop policy if exists "Own rows update" on public.account_items;
drop policy if exists "Own rows delete" on public.account_items;

create policy "Own rows read" on public.account_items
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Own rows insert" on public.account_items
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Own rows update" on public.account_items
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own rows delete" on public.account_items
  for delete to authenticated using (user_id = (select auth.uid()));

-- ── 3. Een plafond per account ──────────────────────────────
-- 20 groepen, een handvol competities en sleutels: een echte organisator
-- komt nooit in de buurt van 1000 rijen.
create or replace function public.account_items_cap()
returns trigger language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.account_items where user_id = new.user_id) >= 1000 then
    raise exception 'account_items_cap' using errcode = '54000';
  end if;
  return new;
end $$;
revoke all on function public.account_items_cap() from public, anon, authenticated;

drop trigger if exists account_items_cap on public.account_items;
create trigger account_items_cap before insert on public.account_items
  for each row execute function public.account_items_cap();

-- ── 4. Synchroniseren in één rondje ─────────────────────────
-- Schrijft wat het toestel meestuurt, maar alleen waar het nieuwer is dan
-- wat er al staat, en geeft daarna alles van dit account terug.
--
-- security invoker: de policies hierboven gelden gewoon. auth.uid() bepaalt
-- van wie de rijen zijn; er is geen parameter om iemand anders aan te wijzen.
create or replace function public.account_sync(p_items jsonb default '[]'::jsonb)
returns setof public.account_items
language plpgsql security invoker set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    if jsonb_array_length(p_items) > 500 then
      raise exception 'too_many_items' using errcode = '54000';
    end if;
    insert into public.account_items as a (user_id, kind, item_key, data, deleted, updated_at)
    -- distinct on: twee keer dezelfde sleutel in één rondje zou Postgres
    -- weigeren ("cannot affect row a second time"). De nieuwste telt.
    select distinct on (i.kind, i.item_key)
           me, i.kind, i.item_key,
           case when coalesce(i.deleted, false) then null else i.data end,
           coalesce(i.deleted, false), i.updated_at
    from jsonb_to_recordset(p_items)
         as i(kind text, item_key text, data jsonb, deleted boolean, updated_at bigint)
    where i.kind is not null and i.item_key is not null and i.updated_at is not null
    order by i.kind, i.item_key, i.updated_at desc
    on conflict (user_id, kind, item_key) do update
      set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at
      where a.updated_at < excluded.updated_at;
  end if;

  -- Grafstenen hoeven niet eeuwig te blijven: na een half jaar heeft elk
  -- toestel dat nog meedoet hem gezien.
  delete from public.account_items
   where user_id = me and deleted
     and updated_at < (extract(epoch from now()) * 1000)::bigint - 180::bigint * 86400000;

  return query select * from public.account_items where user_id = me;
end $$;
revoke all on function public.account_sync(jsonb) from public, anon;
grant execute on function public.account_sync(jsonb) to authenticated;

-- ── 5. Account verwijderen ──────────────────────────────────
-- Alleen de service_role mag in auth.users schrijven, en die sleutel hoort
-- nooit in de app. Deze functie draait met de rechten van wie hem aanmaakt
-- (postgres, in de SQL editor) en verwijdert alleen het account dat de
-- aanroep doet. De cascade op account_items neemt de opgeslagen kopieën mee.
--
-- Live toernooien, inschrijvingen en clubcompetities hangen niet aan een
-- account en blijven bestaan; wie de link heeft kan ze nog steeds bekijken.
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  delete from auth.users where id = me;
  if not found then
    raise exception 'account_not_found';
  end if;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
