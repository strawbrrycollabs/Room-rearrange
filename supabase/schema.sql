-- RoomShift schema. Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).

create table if not exists public.rooms (
  id text primary key,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  data jsonb not null,                    -- the whole room: corners, openings, layouts
  client_updated_at bigint not null,      -- ms timestamp from the device that last edited it (last write wins)
  deleted boolean not null default false, -- soft delete so other devices learn about it
  created_at timestamptz not null default now()
);
create index if not exists rooms_owner_idx on public.rooms (owner);

create table if not exists public.shares (
  token text primary key check (char_length(token) >= 20),
  room_id text not null references public.rooms (id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists shares_room_idx on public.shares (room_id);

alter table public.rooms enable row level security;
alter table public.shares enable row level security;

drop policy if exists "rooms: owner full access" on public.rooms;
create policy "rooms: owner full access" on public.rooms
  for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "shares: owner full access" on public.shares;
create policy "shares: owner full access" on public.shares
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid() and exists (select 1 from public.rooms r where r.id = room_id and r.owner = auth.uid()));

-- Anyone holding a share token can read that one room (view-only), and nothing else.
create or replace function public.get_shared_room(p_token text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select r.data
  from public.shares s
  join public.rooms r on r.id = s.room_id
  where s.token = p_token and not r.deleted
$$;

revoke all on function public.get_shared_room(text) from public;
grant execute on function public.get_shared_room(text) to anon, authenticated;
