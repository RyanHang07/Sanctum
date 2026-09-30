-- M7: the user withdraws their own pending unlock request ("Never mind, stay sealed").
create or replace function public.cancel_unlock_request(rid uuid)
returns void language sql security definer set search_path = public as $$
  update unlock_requests set status = 'expired', resolved_at = now()
  where id = rid and user_id = auth.uid() and status = 'pending';
$$;
revoke execute on function public.cancel_unlock_request(uuid) from public, anon;
grant execute on function public.cancel_unlock_request(uuid) to authenticated;

-- Only someone with a live partner can ask.
drop policy "create my requests" on public.unlock_requests;
create policy "create my requests" on public.unlock_requests for insert to authenticated
  with check (
    user_id = (select auth.uid()) and status = 'pending'
    and exists (select 1 from public.partnerships p where p.user_id = (select auth.uid()) and p.status <> 'ended')
  );
