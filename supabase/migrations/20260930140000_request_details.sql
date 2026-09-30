-- The partner's approve screen shows the session and its time left (PartnerApprove.dc.html),
-- so the desktop app records them with the request.
alter table public.unlock_requests add column if not exists profile_name text;
alter table public.unlock_requests add column if not exists ends_at timestamptz;
