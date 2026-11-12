-- Failed/successful login attempts for rate limiting (edge function only).
create table if not exists public.auth_login_attempts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip text,
  success boolean not null default false,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists auth_login_attempts_email_failed_created_idx
  on public.auth_login_attempts (email, created_at desc)
  where success = false;

create index if not exists auth_login_attempts_ip_failed_created_idx
  on public.auth_login_attempts (ip, created_at desc)
  where success = false and ip is not null;

alter table public.auth_login_attempts enable row level security;

revoke all on public.auth_login_attempts from anon, authenticated;

comment on table public.auth_login_attempts is
  'Login attempts for rate limits; managed by login-rate-limit edge function.';
