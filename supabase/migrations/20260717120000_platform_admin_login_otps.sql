-- One-time email codes for platform-admin cadmin login (not Supabase TOTP MFA).
create table if not exists public.platform_admin_login_otps (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists platform_admin_login_otps_expires_idx
  on public.platform_admin_login_otps (expires_at);

alter table public.platform_admin_login_otps enable row level security;

revoke all on public.platform_admin_login_otps from anon, authenticated;

comment on table public.platform_admin_login_otps is
  'Hashed email OTP for platform admin cadmin step-up; managed by platform-admin-email-otp edge function.';
