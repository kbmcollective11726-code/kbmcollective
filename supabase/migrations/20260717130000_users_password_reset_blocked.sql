-- Per-user block for self-serve password reset emails (bot / inbox flood protection).
alter table public.users
  add column if not exists password_reset_blocked boolean not null default false;

comment on column public.users.password_reset_blocked is
  'When true, send-app-password-reset (and similar self-serve reset) skips sending email. Always returns success to avoid enumeration.';

create index if not exists users_password_reset_blocked_idx
  on public.users (password_reset_blocked)
  where password_reset_blocked = true;
