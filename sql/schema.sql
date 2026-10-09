-- Vigía Web — schema. Ejecutar UNA vez en el SQL editor de Supabase
-- (proyecto cobraya: citfpecrrvptnzkkmmja). Tablas con prefijo vigia_*,
-- no tocan nada existente.

create table if not exists vigia_sites (
  id uuid default gen_random_uuid() primary key,
  owner_email text not null,
  url text not null,
  label text,
  plan text not null default 'free' check (plan in ('free','premium')),
  premium_until timestamptz,
  telegram_chat_id text,
  last_status text,
  last_checked_at timestamptz,
  last_alert_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists vigia_sites_owner_idx on vigia_sites (owner_email);
create index if not exists vigia_sites_due_idx on vigia_sites (last_checked_at nulls first);

create table if not exists vigia_checks (
  id bigint generated always as identity primary key,
  site_id uuid not null references vigia_sites(id) on delete cascade,
  checked_at timestamptz default now(),
  ok boolean,
  status text,
  status_code int,
  response_ms int,
  ssl_days_left int,
  error text
);
create index if not exists vigia_checks_site_idx on vigia_checks (site_id, checked_at desc);

create table if not exists vigia_payments (
  id bigint generated always as identity primary key,
  owner_email text not null,
  tx_hash text unique not null,
  chain text not null default 'tron',
  amount_usd numeric,
  status text not null default 'pending',
  verified_at timestamptz default now(),
  created_at timestamptz default now()
);

-- RLS activado; el acceso va por service_role desde las serverless functions.
alter table vigia_sites enable row level security;
alter table vigia_checks enable row level security;
alter table vigia_payments enable row level security;
