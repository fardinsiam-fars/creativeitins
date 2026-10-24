-- Folder system migration for the Film & Media Homework Portal.
-- Run in Supabase Dashboard > SQL Editor while signed in as project owner.
-- This preserves existing batches, students, and submissions.
create table if not exists public.teacher_folders (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 80),
 created_at timestamptz not null default now(),
 unique (teacher_id, name)
);
alter table public.batches add column if not exists folder_id uuid references public.teacher_folders(id) on delete set null;
alter table public.teacher_folders enable row level security;
drop policy if exists "teachers manage own folders" on public.teacher_folders;
create policy "teachers manage own folders" on public.teacher_folders for all to authenticated
using (public.current_role()='teacher' and teacher_id=auth.uid())
with check (public.current_role()='teacher' and teacher_id=auth.uid());
drop policy if exists "teachers manage batches" on public.batches;
create policy "teachers manage batches" on public.batches for all to authenticated
using (public.current_role()='teacher' and (teacher_id=auth.uid() or teacher_id is null))
with check (public.current_role()='teacher' and (teacher_id=auth.uid() or teacher_id is null)
 and (folder_id is null or exists(select 1 from public.teacher_folders f where f.id=folder_id and f.teacher_id=auth.uid())));
notify pgrst, 'reload schema';
