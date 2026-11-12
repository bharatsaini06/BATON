-- Baton — workspace schema with Row-Level Security (Round 3).
-- Run this once in Supabase: SQL Editor → New query → paste → Run. It is safe to run again.
--
-- How access works
--   * Every request made for a signed-in person reaches Postgres with THAT person's token, so the
--     policies below decide what they can read or change. The server cannot widen them by mistake.
--   * Roles per workspace: owner > lead > member.
--       member  reads handovers published for the Member role, and Member-tagged captured items
--       lead    also reads/writes projects, Lead handovers, connectors, share links, invitations
--       owner   also changes roles and removes members
--   * The service key is used only by the server for: creating a workspace with its first owner,
--     accepting an invitation, inbound webhooks, and opening a handover through a signed link.

create extension if not exists pgcrypto;

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner', 'lead', 'member')),
  email text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists memberships_user on public.memberships(user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner', 'lead', 'member')),
  token text not null unique,
  invited_by uuid not null,
  invited_by_name text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.projects (
  id text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  data jsonb not null,               -- the project without Private sources (those stay in the author's browser)
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
create index if not exists projects_org on public.projects(org_id);

create table if not exists public.packages (
  id text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  project_id text not null,
  version int not null,
  role text not null check (role in ('member', 'lead')),   -- the successor role the handover was filtered for
  title text not null,
  data jsonb not null,
  published_by uuid,
  published_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists packages_org on public.packages(org_id);

create table if not exists public.package_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  package_id text not null references public.packages(id) on delete cascade,
  kind text not null check (kind in ('ack', 'flag', 'question')),
  payload jsonb not null default '{}'::jsonb,
  by_user uuid,                      -- set when a signed-in member acted
  by_name text not null,
  link_id uuid,                      -- set when the action came through a signed share link
  created_at timestamptz not null default now()
);
create index if not exists package_events_pkg on public.package_events(package_id);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  package_id text not null references public.packages(id) on delete cascade,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  opens int not null default 0,
  last_opened_at timestamptz
);
create index if not exists share_links_pkg on public.share_links(package_id);

create table if not exists public.connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('discord', 'slack', 'github')),
  label text,
  external_id text,                  -- Discord server id, Slack team id or GitHub owner/name
  secret text not null,              -- webhook secret (GitHub) or one-time link code (chat)
  project_id text,
  default_access text not null default 'member' check (default_access in ('member', 'lead')),
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  linked_at timestamptz
);
create index if not exists connectors_org on public.connectors(org_id);
create index if not exists connectors_ext on public.connectors(kind, external_id);

create table if not exists public.capture_events (
  id text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  connector_id uuid references public.connectors(id) on delete set null,
  source text not null check (source in ('discord', 'slack', 'github')),
  kind text not null check (kind in ('decision', 'risk', 'task', 'contact', 'note')),
  text text not null,
  why text,
  owner text,
  due text,
  author text not null,
  access text not null check (access in ('member', 'lead')),
  url text,
  ref text,
  project_id text,
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists capture_org on public.capture_events(org_id, created_at desc);
create index if not exists capture_ref on public.capture_events(connector_id, ref);

-- The caller's role in a workspace (null when not a member). SECURITY DEFINER so policies on
-- memberships can use it without recursing into themselves.
create or replace function public.baton_role(org uuid) returns text
  language sql stable security definer set search_path = public
  as $$ select role from public.memberships where org_id = org and user_id = auth.uid() $$;
revoke all on function public.baton_role(uuid) from public;
grant execute on function public.baton_role(uuid) to authenticated, service_role;

alter table public.orgs            enable row level security;
alter table public.memberships     enable row level security;
alter table public.invites         enable row level security;
alter table public.projects        enable row level security;
alter table public.packages        enable row level security;
alter table public.package_events  enable row level security;
alter table public.share_links     enable row level security;
alter table public.connectors      enable row level security;
alter table public.capture_events  enable row level security;

-- Signed-in people get table access only through the policies below; anonymous visitors get none.
revoke all on public.orgs, public.memberships, public.invites, public.projects, public.packages,
  public.package_events, public.share_links, public.connectors, public.capture_events from anon;
grant select on public.orgs to authenticated;
grant select, update, delete on public.memberships to authenticated;
grant select, insert, delete on public.invites to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update on public.packages to authenticated;
grant select, insert on public.package_events to authenticated;
grant select, insert, update on public.share_links to authenticated;
grant select, insert, update, delete on public.connectors to authenticated;
grant select, update on public.capture_events to authenticated;
grant all on public.orgs, public.memberships, public.invites, public.projects, public.packages,
  public.package_events, public.share_links, public.connectors, public.capture_events to service_role;

-- orgs: members can see their workspaces
drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select to authenticated using (public.baton_role(id) is not null);

-- memberships: members see the member list; only an owner changes roles or removes people
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships for select to authenticated using (public.baton_role(org_id) is not null);
drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated
  using (public.baton_role(org_id) = 'owner') with check (public.baton_role(org_id) = 'owner');
drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships for delete to authenticated using (public.baton_role(org_id) = 'owner');

-- invites: leads and owners manage them; a lead may only invite Members
drop policy if exists invites_read on public.invites;
create policy invites_read on public.invites for select to authenticated using (public.baton_role(org_id) in ('owner', 'lead'));
drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites for insert to authenticated
  with check (invited_by = auth.uid() and (public.baton_role(org_id) = 'owner' or (public.baton_role(org_id) = 'lead' and role = 'member')));
drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites for delete to authenticated using (public.baton_role(org_id) in ('owner', 'lead'));

-- projects (raw working material): leads and owners only
drop policy if exists projects_all on public.projects;
create policy projects_all on public.projects for all to authenticated
  using (public.baton_role(org_id) in ('owner', 'lead')) with check (public.baton_role(org_id) in ('owner', 'lead'));

-- packages: a Member reads only handovers filtered for Members; leads and owners read and publish all
drop policy if exists packages_read on public.packages;
create policy packages_read on public.packages for select to authenticated
  using (public.baton_role(org_id) in ('owner', 'lead') or (role = 'member' and public.baton_role(org_id) = 'member'));
drop policy if exists packages_insert on public.packages;
create policy packages_insert on public.packages for insert to authenticated
  with check (public.baton_role(org_id) in ('owner', 'lead') and published_by = auth.uid());
drop policy if exists packages_update on public.packages;
create policy packages_update on public.packages for update to authenticated
  using (public.baton_role(org_id) in ('owner', 'lead')) with check (public.baton_role(org_id) in ('owner', 'lead') and published_by = auth.uid());

-- package events (acknowledgements, flags, questions): written as yourself, on a handover you may read
drop policy if exists package_events_read on public.package_events;
create policy package_events_read on public.package_events for select to authenticated
  using (exists (select 1 from public.packages p where p.id = package_id));   -- packages_read applies inside
drop policy if exists package_events_insert on public.package_events;
create policy package_events_insert on public.package_events for insert to authenticated
  with check (by_user = auth.uid() and link_id is null
    and exists (select 1 from public.packages p where p.id = package_id and p.org_id = package_events.org_id));

-- share links: leads and owners create and revoke
drop policy if exists share_links_read on public.share_links;
create policy share_links_read on public.share_links for select to authenticated using (public.baton_role(org_id) in ('owner', 'lead'));
drop policy if exists share_links_insert on public.share_links;
create policy share_links_insert on public.share_links for insert to authenticated
  with check (public.baton_role(org_id) in ('owner', 'lead') and created_by = auth.uid());
drop policy if exists share_links_update on public.share_links;
create policy share_links_update on public.share_links for update to authenticated
  using (public.baton_role(org_id) in ('owner', 'lead')) with check (public.baton_role(org_id) in ('owner', 'lead'));

-- connectors (hold webhook secrets): leads and owners only
drop policy if exists connectors_all on public.connectors;
create policy connectors_all on public.connectors for all to authenticated
  using (public.baton_role(org_id) in ('owner', 'lead')) with check (public.baton_role(org_id) in ('owner', 'lead'));

-- captured items: Lead-tagged items are invisible to Members; only leads and owners triage
drop policy if exists capture_read on public.capture_events;
create policy capture_read on public.capture_events for select to authenticated
  using (public.baton_role(org_id) in ('owner', 'lead') or (access = 'member' and public.baton_role(org_id) = 'member'));
drop policy if exists capture_update on public.capture_events;
create policy capture_update on public.capture_events for update to authenticated
  using (public.baton_role(org_id) in ('owner', 'lead')) with check (public.baton_role(org_id) in ('owner', 'lead'));

-- make the new tables visible to the API immediately
notify pgrst, 'reload schema';
