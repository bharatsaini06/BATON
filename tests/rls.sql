-- Row-Level Security test for supabase/schema.sql, run against a real PostgreSQL (tests/rls.sh).
-- Each check raises an exception on failure, so psql exits non-zero.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

create schema t;
-- fixtures (inserted as the table owner, i.e. what the server does with the service key)
insert into orgs (id, name, created_by) values
  ('00000000-0000-0000-0000-0000000000a1', 'TechFest Club', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a2', 'Other Club',    '00000000-0000-0000-0000-000000000009');
insert into memberships (org_id, user_id, role, email, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'owner',  'owner@x.test',  'Olivia'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 'lead',   'lead@x.test',   'Leo'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000003', 'member', 'member@x.test', 'Mira'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000009', 'owner',  'zed@x.test',    'Zed');
insert into projects (id, org_id, title, data) values ('p_one', '00000000-0000-0000-0000-0000000000a1', 'Portal', '{"secret":"raw sources"}'), ('p_other', '00000000-0000-0000-0000-0000000000a2', 'Other', '{}');
insert into packages (id, org_id, project_id, version, role, title, data, published_by) values
  ('p_one-v1', '00000000-0000-0000-0000-0000000000a1', 'p_one', 1, 'member', 'Member handover', '{}', '00000000-0000-0000-0000-000000000002'),
  ('p_one-v2', '00000000-0000-0000-0000-0000000000a1', 'p_one', 2, 'lead',   'Lead handover',   '{"sponsor":"Rs 75,000"}', '00000000-0000-0000-0000-000000000002');
insert into connectors (id, org_id, kind, secret) values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'github', 'whsec-very-secret');
insert into share_links (id, org_id, package_id) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'p_one-v1');
insert into capture_events (id, org_id, source, kind, text, author, access) values
  ('cap_m', '00000000-0000-0000-0000-0000000000a1', 'discord', 'decision', 'Use Cloudflare', 'riya', 'member'),
  ('cap_l', '00000000-0000-0000-0000-0000000000a1', 'discord', 'decision', 'Sponsor pays 75k', 'riya', 'lead');
insert into invites (org_id, email, role, token, invited_by) values ('00000000-0000-0000-0000-0000000000a1', 'new@x.test', 'member', 'tok-1', '00000000-0000-0000-0000-000000000001');

create or replace function t.expect(label text, got bigint, want bigint) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got %, expected %', label, got, want; end if; raise notice 'ok   %', label; end $$;
create or replace function t.denied(label text, q text) returns void language plpgsql as $$
declare n bigint;
begin
  begin
    execute q; get diagnostics n = row_count;
  exception when insufficient_privilege or check_violation then raise notice 'ok   % (refused)', label; return;
  end;
  if n > 0 then raise exception 'FAIL %: statement changed % row(s) but should be refused', label, n; end if;
  raise notice 'ok   % (0 rows)', label;
end $$;
create or replace function t.allowed(label text, q text) returns void language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; if n < 1 then raise exception 'FAIL %: no row affected', label; end if; raise notice 'ok   %', label; end $$;
grant usage on schema t to authenticated, anon;
set client_min_messages = notice;

-- ---------------------------------------------------------------- anonymous: nothing at all
set role anon;
select t.denied('anon cannot read packages', 'select 1 from packages');
select t.denied('anon cannot read projects', 'select 1 from projects');
select t.denied('anon cannot read connectors', 'select 1 from connectors');
reset role;

-- ---------------------------------------------------------------- member (Mira)
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', false);
select t.expect('member sees own workspace only', (select count(*) from orgs), 1);
select t.expect('member sees the member list', (select count(*) from memberships), 3);
select t.expect('member cannot read raw projects', (select count(*) from projects), 0);
select t.expect('member reads Member handovers only', (select count(*) from packages), 1);
select t.expect('member cannot read the Lead handover', (select count(*) from packages where role = 'lead'), 0);
select t.expect('member cannot see connectors (webhook secrets)', (select count(*) from connectors), 0);
select t.expect('member cannot see share links', (select count(*) from share_links), 0);
select t.expect('member cannot see invitations', (select count(*) from invites), 0);
select t.expect('member sees Member-tagged captured items only', (select count(*) from capture_events), 1);
select t.denied('member cannot write a project', $q$insert into projects (id, org_id, title, data) values ('p_x', '00000000-0000-0000-0000-0000000000a1', 'x', '{}')$q$);
select t.denied('member cannot publish', $q$insert into packages (id, org_id, project_id, version, role, title, data, published_by) values ('x-v1', '00000000-0000-0000-0000-0000000000a1', 'x', 1, 'member', 't', '{}', '00000000-0000-0000-0000-000000000003')$q$);
select t.denied('member cannot promote themselves', $q$update memberships set role = 'owner' where user_id = '00000000-0000-0000-0000-000000000003'$q$);
select t.denied('member cannot create a share link', $q$insert into share_links (org_id, package_id, created_by) values ('00000000-0000-0000-0000-0000000000a1', 'p_one-v1', '00000000-0000-0000-0000-000000000003')$q$);
select t.denied('member cannot triage captured items', $q$update capture_events set status = 'dismissed'$q$);
select t.denied('member cannot add themselves to another workspace', $q$insert into memberships (org_id, user_id, role, email, name) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000003', 'owner', 'm', 'm')$q$);
select t.allowed('member acknowledges a handover as themselves', $q$insert into package_events (org_id, package_id, kind, payload, by_user, by_name) values ('00000000-0000-0000-0000-0000000000a1', 'p_one-v1', 'ack', '{"section":"plan"}', '00000000-0000-0000-0000-000000000003', 'Mira')$q$);
select t.denied('member cannot acknowledge as someone else', $q$insert into package_events (org_id, package_id, kind, by_user, by_name) values ('00000000-0000-0000-0000-0000000000a1', 'p_one-v1', 'ack', '00000000-0000-0000-0000-000000000002', 'Leo')$q$);
select t.denied('member cannot write events on the Lead handover', $q$insert into package_events (org_id, package_id, kind, by_user, by_name) values ('00000000-0000-0000-0000-0000000000a1', 'p_one-v2', 'flag', '00000000-0000-0000-0000-000000000003', 'Mira')$q$);

-- ---------------------------------------------------------------- lead (Leo)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', false);
select t.expect('lead reads projects of own workspace only', (select count(*) from projects), 1);
select t.expect('lead reads both handovers', (select count(*) from packages), 2);
select t.expect('lead sees all captured items', (select count(*) from capture_events), 2);
select t.expect('lead sees connectors', (select count(*) from connectors), 1);
select t.allowed('lead saves a project', $q$update projects set title = 'Portal v2' where id = 'p_one'$q$);
select t.allowed('lead publishes as themselves', $q$insert into packages (id, org_id, project_id, version, role, title, data, published_by) values ('p_one-v3', '00000000-0000-0000-0000-0000000000a1', 'p_one', 3, 'member', 't', '{}', '00000000-0000-0000-0000-000000000002')$q$);
select t.denied('lead cannot publish under another identity', $q$insert into packages (id, org_id, project_id, version, role, title, data, published_by) values ('p_one-v4', '00000000-0000-0000-0000-0000000000a1', 'p_one', 4, 'member', 't', '{}', '00000000-0000-0000-0000-000000000001')$q$);
select t.allowed('lead creates a share link', $q$insert into share_links (org_id, package_id, created_by) values ('00000000-0000-0000-0000-0000000000a1', 'p_one-v1', '00000000-0000-0000-0000-000000000002')$q$);
select t.allowed('lead revokes a share link', $q$update share_links set revoked_at = now() where id = '00000000-0000-0000-0000-0000000000d1'$q$);
select t.allowed('lead invites a Member', $q$insert into invites (org_id, email, role, token, invited_by) values ('00000000-0000-0000-0000-0000000000a1', 'a@x.test', 'member', 'tok-2', '00000000-0000-0000-0000-000000000002')$q$);
select t.denied('lead cannot invite an Owner', $q$insert into invites (org_id, email, role, token, invited_by) values ('00000000-0000-0000-0000-0000000000a1', 'b@x.test', 'owner', 'tok-3', '00000000-0000-0000-0000-000000000002')$q$);
select t.denied('lead cannot change roles', $q$update memberships set role = 'owner' where user_id = '00000000-0000-0000-0000-000000000002'$q$);
select t.denied('lead cannot remove members', $q$delete from memberships where user_id = '00000000-0000-0000-0000-000000000003'$q$);
select t.denied('lead cannot move a project into another workspace', $q$update projects set org_id = '00000000-0000-0000-0000-0000000000a2' where id = 'p_one'$q$);
select t.allowed('lead triages captured items', $q$update capture_events set status = 'added' where id = 'cap_m'$q$);

-- ---------------------------------------------------------------- owner (Olivia)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
select t.allowed('owner changes a role', $q$update memberships set role = 'lead' where user_id = '00000000-0000-0000-0000-000000000003'$q$);
select t.allowed('owner removes a member', $q$delete from memberships where user_id = '00000000-0000-0000-0000-000000000003'$q$);
select t.allowed('owner invites a Lead', $q$insert into invites (org_id, email, role, token, invited_by) values ('00000000-0000-0000-0000-0000000000a1', 'c@x.test', 'lead', 'tok-4', '00000000-0000-0000-0000-000000000001')$q$);

-- ---------------------------------------------------------------- outsider (Zed, owner of another workspace)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}', false);
select t.expect('outsider sees only their own workspace', (select count(*) from orgs), 1);
select t.expect('outsider sees none of our handovers', (select count(*) from packages), 0);
select t.expect('outsider sees none of our projects', (select count(*) from projects where org_id = '00000000-0000-0000-0000-0000000000a1'), 0);
select t.expect('outsider sees none of our captured items', (select count(*) from capture_events), 0);
select t.expect('outsider sees none of our members', (select count(*) from memberships where org_id = '00000000-0000-0000-0000-0000000000a1'), 0);
select t.denied('outsider cannot write into our workspace', $q$insert into projects (id, org_id, title, data) values ('p_evil', '00000000-0000-0000-0000-0000000000a1', 'x', '{}')$q$);
select t.denied('outsider cannot delete our project', $q$delete from projects where id = 'p_one'$q$);

-- ---------------------------------------------------------------- removed member (Mira again): access ended with the membership
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', false);
select t.expect('removed member sees no handovers', (select count(*) from packages), 0);
select t.expect('removed member sees no workspace', (select count(*) from orgs), 0);
reset role;
\echo RLS: all checks passed
