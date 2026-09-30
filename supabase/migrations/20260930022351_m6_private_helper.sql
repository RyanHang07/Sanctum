-- Keep the RLS helper out of the exposed API schema.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_partnered(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.partnerships
    where status <> 'ended'
      and ((user_id = auth.uid() and partner_id = other) or (partner_id = auth.uid() and user_id = other))
  );
$$;
revoke execute on function private.is_partnered(uuid) from public, anon;
grant execute on function private.is_partnered(uuid) to authenticated;

drop policy "own or partner profile" on public.profiles_user;
create policy "own or partner profile" on public.profiles_user for select to authenticated
  using (id = (select auth.uid()) or private.is_partnered(id));

drop policy "see my requests or my partner's" on public.unlock_requests;
create policy "see my requests or my partner's" on public.unlock_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.is_partnered(user_id));

drop function public.is_partnered(uuid);
