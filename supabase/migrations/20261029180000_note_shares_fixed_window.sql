-- v0.2 (pre-release pass): a share's window can't be stretched. The 7-day cap
-- (note_shares_expiry) compares expires_at with created_at, and both came from the client, so
-- an owner could set created_at in the future, or move either later with an update. Now
-- created_at is always the insert time, and neither changes after.

create or replace function public.note_shares_fix_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
    new.expires_at := old.expires_at;
  end if;
  return new;
end;
$$;
-- Only the trigger runs it, never a client.
revoke all on function public.note_shares_fix_window() from public, anon, authenticated;

create trigger note_shares_fix_window
  before insert or update on public.note_shares
  for each row execute function public.note_shares_fix_window();
