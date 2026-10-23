-- Run in the Supabase SQL editor as project owner. Never expose the service-role key.
create extension if not exists pgcrypto;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.site_content (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  title text not null,
  body text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) <= 254),
  check_type text not null check (check_type in ('Basic DBS','Standard DBS','Enhanced DBS','Not sure yet','Other question')),
  message text not null check (char_length(message) between 10 and 3000),
  consent boolean not null check (consent = true),
  email_status text not null default 'pending' check (email_status in ('pending','sent','failed')),
  created_at timestamptz not null default now()
);
create index if not exists enquiries_created_at_idx on public.enquiries(created_at desc);

alter table public.admins enable row level security;
alter table public.site_content enable row level security;
alter table public.faqs enable row level security;
alter table public.enquiries enable row level security;

-- Visitors can only read published page copy and active FAQs; enquiries are server-written.
drop policy if exists "Published content is public" on public.site_content;
create policy "Published content is public" on public.site_content for select to anon, authenticated using (true);
drop policy if exists "Active FAQs are public" on public.faqs;
create policy "Active FAQs are public" on public.faqs for select to anon, authenticated using (active = true);
-- An admin can only read their own membership row. Membership is provisioned by an owner.
drop policy if exists "Admins can read own membership" on public.admins;
create policy "Admins can read own membership" on public.admins for select to authenticated using (user_id = auth.uid());
-- The admins table cannot be modified by client roles. Provision membership from SQL Editor/service role.
drop policy if exists "Enquiries are private" on public.enquiries;
-- No anon/authenticated policies on enquiries: RLS denies all client reads and writes.

-- Authenticated admin CRUD policies for content. The server also performs a membership check.
drop policy if exists "Admins manage page content" on public.site_content;
create policy "Admins manage page content" on public.site_content for all to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));
drop policy if exists "Admins manage FAQs" on public.faqs;
create policy "Admins manage FAQs" on public.faqs for all to authenticated
using (exists (select 1 from public.admins a where a.user_id = auth.uid()))
with check (exists (select 1 from public.admins a where a.user_id = auth.uid()));

insert into public.site_content(slug,title,body) values
('home','Make your next|DBS check clearer.','A straightforward place to understand Basic, Standard and Enhanced DBS checks, and ask about the right next step.')
on conflict (slug) do nothing;
insert into public.faqs(question,answer,sort_order,active) values
('What is the difference between the three DBS check levels?','Each level can disclose a different scope of information. Basic checks cover unspent convictions and conditional cautions. Standard and Enhanced checks have broader scope and are only available for eligible roles.',1,true),
('Can any role have an Enhanced check?','No. The role must meet the legal eligibility criteria for that level. The appropriate level depends on the duties and the applicable rules.',2,true),
('What information should I include in an enquiry?','Tell us your name, how to contact you, and a general description of the role or question. Don’t send identity documents or sensitive personal data through this form.',3,true),
('Can I check an application live on this website?','This website does not provide a live application status check. Please use the appropriate official or provider channel for an existing application.',4,true);

-- Image storage bucket and policies. Create bucket once (public URLs are intended for public web assets).
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('site-assets','site-assets',true,4194304,array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update set public=true,file_size_limit=4194304,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Public can read site assets" on storage.objects;
create policy "Public can read site assets" on storage.objects for select to anon,authenticated using (bucket_id='site-assets');
drop policy if exists "Admins upload site assets" on storage.objects;
create policy "Admins upload site assets" on storage.objects for insert to authenticated
with check (bucket_id='site-assets' and exists (select 1 from public.admins a where a.user_id=auth.uid()));
drop policy if exists "Admins update site assets" on storage.objects;
create policy "Admins update site assets" on storage.objects for update to authenticated
using (bucket_id='site-assets' and exists (select 1 from public.admins a where a.user_id=auth.uid()))
with check (bucket_id='site-assets' and exists (select 1 from public.admins a where a.user_id=auth.uid()));
drop policy if exists "Admins delete site assets" on storage.objects;
create policy "Admins delete site assets" on storage.objects for delete to authenticated
using (bucket_id='site-assets' and exists (select 1 from public.admins a where a.user_id=auth.uid()));

-- Bootstrap after creating a Supabase Auth user; replace with that user's real UUID:
-- insert into public.admins(user_id) values ('YOUR-AUTH-USER-UUID');
