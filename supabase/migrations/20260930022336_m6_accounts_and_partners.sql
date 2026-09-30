-- Sanctum M6: optional accounts and the accountability partner (SPEC 4.6, 5.2).
-- RLS on every table. PINs are only touched by Edge Functions (service role).

create table public.profiles_user (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  timezone text,
  created_at timestamptz not null default now()
);

create table public.partnerships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  partner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'removal_requested', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (user_id <> partner_id)
);
-- Exactly one live partner per user.
create unique index partnerships_one_live on public.partnerships(user_id) where status <> 'ended';
create index partnerships_partner on public.partnerships(partner_id);

create table public.invites (
  token text primary key default encode(extensions.gen_random_bytes(18), 'hex'),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '48 hours',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_user on public.invites(user_id);

create table public.pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table public.unlock_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  level int not null default 3,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index unlock_requests_user on public.unlock_requests(user_id, created_at desc);

create table public.daily_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  focus_min int not null default 0,
  idle_min int not null default 0,
  distracted_min int not null default 0,
  sessions_completed int not null default 0,
  sessions_broken int not null default 0,
  top_categories jsonb not null default '{}'::jsonb,
  primary key (user_id, date)
);

create table public.streaks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current int not null default 0,
  longest int not null default 0,
  last_counted_date date
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  emailed boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient on public.notifications(recipient_id, created_at desc);

alter table public.profiles_user enable row level security;
alter table public.partnerships enable row level security;
alter table public.invites enable row level security;
alter table public.pins enable row level security;
alter table public.unlock_requests enable row level security;
alter table public.daily_summaries enable row level security;
alter table public.streaks enable row level security;
alter table public.notifications enable row level security;

-- Is `other` my live partner, or am I theirs? (Moved to the private schema next.)
create or replace function public.is_partnered(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from partnerships
    where status <> 'ended'
      and ((user_id = auth.uid() and partner_id = other) or (partner_id = auth.uid() and user_id = other))
  );
$$;

create policy "own or partner profile" on public.profiles_user for select to authenticated
  using (id = (select auth.uid()) or public.is_partnered(id));
create policy "update own profile" on public.profiles_user for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "see my partnerships" on public.partnerships for select to authenticated
  using (user_id = (select auth.uid()) or partner_id = (select auth.uid()));

create policy "see my invites" on public.invites for select to authenticated using (user_id = (select auth.uid()));
create policy "create my invites" on public.invites for insert to authenticated with check (user_id = (select auth.uid()));
create policy "delete my invites" on public.invites for delete to authenticated using (user_id = (select auth.uid()));

-- pins: no policies. Edge Functions only.

create policy "see my requests or my partner's" on public.unlock_requests for select to authenticated
  using (user_id = (select auth.uid()) or public.is_partnered(user_id));
create policy "create my requests" on public.unlock_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');

create policy "own summaries" on public.daily_summaries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own streak" on public.streaks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "see my notifications" on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
create policy "mark my notifications read" on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));

-- A profile row for every account, with its email for the partner to see.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles_user (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Removing a partner needs that partner's approval (SPEC 4.6), so the user can only ask.
create or replace function public.request_partner_removal()
returns void language sql security definer set search_path = public as $$
  update partnerships set status = 'removal_requested'
  where user_id = auth.uid() and status = 'active';
$$;

-- The user withdraws a removal request.
create or replace function public.cancel_partner_removal()
returns void language sql security definer set search_path = public as $$
  update partnerships set status = 'active'
  where user_id = auth.uid() and status = 'removal_requested';
$$;

-- The partner ends it: approving a removal request, or stepping down on their own.
create or replace function public.end_partnership(pid uuid)
returns void language sql security definer set search_path = public as $$
  update partnerships set status = 'ended', ended_at = now()
  where id = pid and partner_id = auth.uid() and status <> 'ended';
$$;

revoke execute on function public.request_partner_removal() from public, anon;
revoke execute on function public.cancel_partner_removal() from public, anon;
revoke execute on function public.end_partnership(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.request_partner_removal() to authenticated;
grant execute on function public.cancel_partner_removal() to authenticated;
grant execute on function public.end_partnership(uuid) to authenticated;
