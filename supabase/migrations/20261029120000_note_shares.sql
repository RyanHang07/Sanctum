-- v0.2: a note shared as a live, read-only link: sanctum-partner/n/<token>#<key>.
-- END-TO-END ENCRYPTED: the app encrypts the note (title and blocks) and its images with a
-- key that lives only in the link's #fragment, which browsers never send to a server. This
-- table stores ciphertext; nobody with database access can read a shared note.
-- The owner writes it from the app while it's shared; anyone with the link reads the
-- ciphertext through get_note_share until it expires (1 hour to 7 days, chosen when sharing).
-- Images: encrypted blobs in the private "note-shares" bucket under <owner>/<token>/, fetched
-- through signed URLs that expire with the link. The page hears edits on the Realtime
-- broadcast topic "note-share:<token>".

create table public.note_shares (
  token      text primary key check (length(token) >= 32),
  owner      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- base64url(iv || AES-GCM ciphertext) of {"title", "doc"}; empty until the first push.
  cipher     text not null default '' check (length(cipher) <= 3000000),
  -- Image id -> signed URL of its encrypted bytes.
  images     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- At most a week (plus a little slack for clocks).
  constraint note_shares_expiry check (expires_at <= created_at + interval '7 days 1 hour')
);
create index note_shares_owner on public.note_shares (owner);
create index note_shares_expires on public.note_shares (expires_at);

alter table public.note_shares enable row level security;

-- The owner, signed in, does everything with their own shares; nobody else touches the table.
create policy "owner manages own shares" on public.note_shares
  for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- Anyone with the link: that one share's ciphertext, only until it expires.
create or replace function public.get_note_share(share_token text)
returns table (cipher text, images jsonb, updated_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.cipher, s.images, s.updated_at, s.expires_at
  from public.note_shares s
  where s.token = share_token and s.expires_at > now();
$$;
revoke all on function public.get_note_share(text) from public;
grant execute on function public.get_note_share(text) to anon, authenticated;

-- Expired shares are cleared whenever someone shares a note (cheap, no cron needed).
create or replace function public.prune_note_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.note_shares where expires_at < now() - interval '1 hour';
  return null;
end;
$$;
-- Only the trigger runs it, never a client.
revoke all on function public.prune_note_shares() from public, anon, authenticated;
create trigger note_shares_prune
  after insert on public.note_shares
  for each statement execute function public.prune_note_shares();

-- Images: a private bucket of encrypted blobs; the owner writes and removes only under
-- their own folder. (Readers get signed URLs, which expire with the link.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-shares', 'note-shares', false, 12582912, array['application/octet-stream'])
on conflict (id) do nothing;

create policy "owner manages own share images" on storage.objects
  for all to authenticated
  using (bucket_id = 'note-shares' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'note-shares' and (storage.foldername(name))[1] = auth.uid()::text);

-- Link holders read only through get_note_share; the table itself is never open to anon
-- (RLS already returns nothing; this removes the default grant too).
revoke all on table public.note_shares from anon;
