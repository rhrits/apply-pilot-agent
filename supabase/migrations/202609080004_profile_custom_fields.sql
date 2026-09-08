alter table public.profiles add column if not exists custom_fields jsonb not null default '[]'::jsonb;
