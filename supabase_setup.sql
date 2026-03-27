-- Supabase SQL Editor에서 실행하세요
-- Run this in Supabase Dashboard → SQL Editor

create table work_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  log_date date not null,
  type text not null default '일반',
  start_time text,
  end_time text,
  ext_mins int default 0,
  note text,
  created_at timestamptz default now(),
  unique(user_id, log_date)
);

-- Row Level Security: 본인 데이터만 접근 가능
alter table work_logs enable row level security;

create policy "users_own_logs" on work_logs
  for all using (auth.uid() = user_id);
