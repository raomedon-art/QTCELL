-- Supabase Dashboard > SQL Editor에서 한 번 실행합니다.
-- 이 스키마는 현재의 '이름만 입력하는 로그인' UI와 호환되는 공유 저장소용입니다.
-- 주의: 이름 로그인은 실제 사용자 인증이 아니므로, 민감한 자료를 운영하기 전에는
-- Supabase Auth 기반 개인 계정과 authenticated 전용 RLS 정책으로 강화해야 합니다.

create table if not exists public.qtcell_records (
  id uuid primary key,
  title text not null default '',
  meeting_date date,
  speaker text not null default '',
  passage text not null default '',
  visibility text not null default 'church',
  summary text not null default '',
  content_html text not null default '',
  file_name text,
  file_type text,
  file_size bigint,
  file_path text,
  owner text not null default '',
  created_at timestamptz not null default now(),
  view_count bigint not null default 0 check (view_count >= 0)
);

create table if not exists public.qtcell_members (
  id text primary key,
  name text not null unique,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

insert into public.qtcell_members (id, name, role, created_at)
values ('member-kim-gyeongrae', '김경래', 'admin', '2026-08-14T00:00:00.000Z')
on conflict (name) do nothing;

alter table public.qtcell_records enable row level security;
alter table public.qtcell_members enable row level security;

drop policy if exists "qtcell records can be read" on public.qtcell_records;
drop policy if exists "qtcell records can be inserted" on public.qtcell_records;
drop policy if exists "qtcell records can be updated" on public.qtcell_records;
drop policy if exists "qtcell records can be deleted" on public.qtcell_records;
drop policy if exists "qtcell members can be read" on public.qtcell_members;
drop policy if exists "qtcell members can be inserted" on public.qtcell_members;

create policy "qtcell records can be read"
on public.qtcell_records for select to anon, authenticated using (true);

create policy "qtcell records can be inserted"
on public.qtcell_records for insert to anon, authenticated with check (true);

create policy "qtcell records can be updated"
on public.qtcell_records for update to anon, authenticated using (true) with check (true);

create policy "qtcell records can be deleted"
on public.qtcell_records for delete to anon, authenticated using (true);

create policy "qtcell members can be read"
on public.qtcell_members for select to anon, authenticated using (true);

create policy "qtcell members can be inserted"
on public.qtcell_members for insert to anon, authenticated with check (true);

grant select, insert, update, delete on table public.qtcell_records to anon, authenticated;
grant select, insert on table public.qtcell_members to anon, authenticated;

create or replace function public.increment_qtcell_view_count(p_record_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.qtcell_records
  set view_count = view_count + 1
  where id = p_record_id
  returning view_count;
$$;

revoke all on function public.increment_qtcell_view_count(uuid) from public;
grant execute on function public.increment_qtcell_view_count(uuid) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('qtcell-files', 'qtcell-files', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

drop policy if exists "qtcell files can be read" on storage.objects;
drop policy if exists "qtcell files can be inserted" on storage.objects;
drop policy if exists "qtcell files can be updated" on storage.objects;
drop policy if exists "qtcell files can be deleted" on storage.objects;

create policy "qtcell files can be read"
on storage.objects for select to anon, authenticated
using (bucket_id = 'qtcell-files');

create policy "qtcell files can be inserted"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'qtcell-files');

create policy "qtcell files can be updated"
on storage.objects for update to anon, authenticated
using (bucket_id = 'qtcell-files') with check (bucket_id = 'qtcell-files');

create policy "qtcell files can be deleted"
on storage.objects for delete to anon, authenticated
using (bucket_id = 'qtcell-files');
