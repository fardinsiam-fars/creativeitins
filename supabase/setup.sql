-- Film & Media Homework Portal: Supabase schema and security policies
-- Run this entire file in Supabase Dashboard > SQL Editor as project owner.
create extension if not exists pgcrypto;

create table if not exists public.batches (
 id uuid primary key default gen_random_uuid(),
 code text not null unique,
 unlocked_through int not null default 0 check (unlocked_through between 0 and 29),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text,
 full_name text not null default '',
 role text not null default 'student' check (role in ('student','teacher')),
 batch_code text references public.batches(code) on update cascade on delete set null,
 created_at timestamptz not null default now()
);
alter table public.batches add column if not exists teacher_id uuid;
do $$ begin
 alter table public.batches add constraint batches_teacher_id_fkey
 foreign key (teacher_id) references public.profiles(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Teacher-owned folders; batches belong to a folder, while existing batches remain intact.
create table if not exists public.teacher_folders (
 id uuid primary key default gen_random_uuid(),
 teacher_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check (length(trim(name)) between 1 and 80),
 created_at timestamptz not null default now(),
 unique (teacher_id, name)
);
alter table public.batches add column if not exists folder_id uuid references public.teacher_folders(id) on delete set null;

create table if not exists public.lessons (
 id uuid primary key default gen_random_uuid(),
 number int not null unique check (number between 1 and 29),
 title text not null,
 summary text not null default '',
 body text not null default '',
 links jsonb not null default '[]'::jsonb check (jsonb_typeof(links)='array'),
 deadline timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
-- Per-batch class assignments with independent deadlines.
create table if not exists public.batch_lessons (
 batch_id uuid not null references public.batches(id) on delete cascade,
 lesson_id uuid not null references public.lessons(id) on delete cascade,
 deadline timestamptz,
 assigned_at timestamptz not null default now(),
 primary key(batch_id,lesson_id)
);

create table if not exists public.submissions (
 id uuid primary key default gen_random_uuid(),
 lesson_id uuid not null references public.lessons(id) on delete cascade,
 student_id uuid not null references public.profiles(id) on delete cascade,
 url text not null check (url ~* '^https?://'),
 submitted_at timestamptz not null default now(),
 unique (lesson_id, student_id)
);

create or replace function public.current_role() returns text language sql stable security definer set search_path=public as $$
 select role from public.profiles where id=auth.uid()
$$;
create or replace function public.enforce_student_submission() returns trigger language plpgsql security definer set search_path=public as $$
declare l public.lessons%rowtype; p public.profiles%rowtype; b public.batches%rowtype;
begin
 if auth.uid() is null or new.student_id <> auth.uid() then raise exception 'You may submit only for your own account'; end if;
 select * into l from public.lessons where id=new.lesson_id;
 if not found then raise exception 'Class not found'; end if;
 select bl.deadline into l.deadline
  from public.batch_lessons bl
  join public.batches bx on bx.id=bl.batch_id
  join public.profiles bp on bp.id=auth.uid()
  where bl.lesson_id=new.lesson_id and bx.code=bp.batch_code and bx.active=true;
  if not found then raise exception 'This class has not been assigned to your active batch'; end if;
  if l.deadline is not null and now() > l.deadline then raise exception 'The homework deadline has passed'; end if;
 select * into p from public.profiles where id=auth.uid();
 if p.role <> 'student' then raise exception 'Only student accounts may submit homework'; end if;
 select * into b from public.batches where code=p.batch_code and active=true;
 if not found then raise exception 'Your batch is inactive or not configured'; end if;
 if l.number > b.unlocked_through then raise exception 'This class is not unlocked for your batch'; end if;
 return new;
end $$;
drop trigger if exists submissions_enforce_rules on public.submissions;
create trigger submissions_enforce_rules before insert on public.submissions for each row execute function public.enforce_student_submission();

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare v_code text; v_name text; v_role text;
begin
 v_code := upper(trim(coalesce(new.raw_user_meta_data->>'batch_code','')));
 v_name := coalesce(new.raw_user_meta_data->>'full_name','');
 v_role := coalesce(new.raw_user_meta_data->>'role','student');
 if v_role <> 'student' then v_role := 'student'; end if;
 if v_code = '' then v_code := null; end if;
 insert into public.profiles(id,email,full_name,role,batch_code)
 values(new.id,new.email,v_name,'student',v_code)
 on conflict(id) do update set email=excluded.email, full_name=excluded.full_name, batch_code=excluded.batch_code;
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.batches enable row level security;
alter table public.teacher_folders enable row level security;
alter table public.profiles enable row level security;
alter table public.lessons enable row level security;
alter table public.submissions enable row level security;
alter table public.batch_lessons enable row level security;

drop policy if exists "teachers manage own folders" on public.teacher_folders;
create policy "teachers manage own folders" on public.teacher_folders for all to authenticated
using (public.current_role()='teacher' and teacher_id=auth.uid())
with check (public.current_role()='teacher' and teacher_id=auth.uid());

drop policy if exists "signed in users can read batches" on public.batches;
create policy "signed in users can read batches" on public.batches for select to authenticated using (true);
drop policy if exists "teachers manage batches" on public.batches;
create policy "teachers manage batches" on public.batches for all to authenticated
using (public.current_role()='teacher' and (teacher_id=auth.uid() or teacher_id is null))
with check (public.current_role()='teacher' and (teacher_id=auth.uid() or teacher_id is null)
 and (folder_id is null or exists(select 1 from public.teacher_folders f where f.id=folder_id and f.teacher_id=auth.uid())));

drop policy if exists "read own profile or teacher reads all" on public.profiles;
create policy "read own profile or teacher reads all" on public.profiles for select to authenticated using (id=auth.uid() or public.current_role()='teacher');
-- No client-side profile UPDATE policy: students must not be able to change
-- their batch or promote themselves to teacher.

drop policy if exists "signed in users read lessons" on public.lessons;
create policy "signed in users read lessons" on public.lessons for select to authenticated
using (
  public.current_role()='teacher'
  or exists (
    select 1 from public.profiles p
    join public.batches b on b.code=p.batch_code
    where p.id=auth.uid() and p.role='student' and b.active=true
      and public.lessons.number <= b.unlocked_through
  )
);
drop policy if exists "teachers manage lessons" on public.lessons;
create policy "teachers manage lessons" on public.lessons for all to authenticated using (public.current_role()='teacher') with check (public.current_role()='teacher');

drop policy if exists "students read assigned classes" on public.batch_lessons;
create policy "students read assigned classes" on public.batch_lessons for select to authenticated using (
 public.current_role()='teacher'
 or exists(select 1 from public.profiles p join public.batches b on b.code=p.batch_code
  where p.id=auth.uid() and b.id=batch_id and b.active=true)
);
drop policy if exists "teachers manage batch class assignments" on public.batch_lessons;
create policy "teachers manage batch class assignments" on public.batch_lessons for all to authenticated
using (public.current_role()='teacher' and exists(select 1 from public.batches b where b.id=batch_id and (b.teacher_id=auth.uid() or b.teacher_id is null)))
with check (public.current_role()='teacher' and exists(select 1 from public.batches b where b.id=batch_id and (b.teacher_id=auth.uid() or b.teacher_id is null)));

drop policy if exists "students read own submissions and teachers read all" on public.submissions;
create policy "students read own submissions and teachers read all" on public.submissions for select to authenticated using (student_id=auth.uid() or public.current_role()='teacher');
drop policy if exists "students insert own submission" on public.submissions;
create policy "students insert own submission" on public.submissions for insert to authenticated with check (student_id=auth.uid() and public.current_role()='student');
-- Intentionally no UPDATE or DELETE policy for submissions: submitted links are locked.

-- Batch capacity: 50 enrolled student profiles per batch.
create or replace function public.enforce_batch_capacity() returns trigger language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if new.batch_code is not null then
   perform pg_advisory_xact_lock(hashtext(new.batch_code));
   select count(*) into n from public.profiles where batch_code=new.batch_code and role='student' and id<>new.id;
   if n >= 50 then raise exception 'This batch is full (50 students maximum)'; end if;
   if not exists(select 1 from public.batches where code=new.batch_code and active=true) then raise exception 'Batch code not found or inactive'; end if;
 end if;
 return new;
end $$;
drop trigger if exists profile_batch_capacity on public.profiles;
create trigger profile_batch_capacity before insert or update of batch_code on public.profiles for each row execute function public.enforce_batch_capacity();

-- Create the starter batch. Safe to run repeatedly.
insert into public.batches(code,unlocked_through,active) values('PVE 2606',0,true) on conflict(code) do nothing;
-- Preserve existing class availability when upgrading an existing portal.
insert into public.batch_lessons(batch_id,lesson_id,deadline)
select b.id,l.id,l.deadline from public.batches b cross join public.lessons l
on conflict(batch_id,lesson_id) do nothing;

-- IMPORTANT: After signing up the teacher account in the website, run this once,
-- replacing the email with the teacher's actual account email:
-- update public.profiles set role='teacher', batch_code=null where email='teacher@example.com';
