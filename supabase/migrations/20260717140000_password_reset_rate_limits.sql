-- Track self-serve password reset requests for rate limiting (edge function only).
create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_requests_email_created_idx
  on public.password_reset_requests (email, created_at desc);

create index if not exists password_reset_requests_ip_created_idx
  on public.password_reset_requests (ip, created_at desc)
  where ip is not null;

alter table public.password_reset_requests enable row level security;

revoke all on public.password_reset_requests from anon, authenticated;

comment on table public.password_reset_requests is
  'Self-serve password reset attempts for rate limits; written by send-app-password-reset.';
