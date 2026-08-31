-- Phase 6B-2: only postgres future defaults and the three approved MAINTAIN grants.
-- No policy/ownership/schema/service_role ACL changes. supabase_admin is deliberately untouched.
-- Rollback, if explicitly approved later: restore only ACLs from phase6b2-before.json
-- in a new migration. Do not roll back by broad GRANT ALL on existing objects.
begin;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;
-- Schema-level revoke cannot override PostgreSQL's implicit global PUBLIC EXECUTE.
alter default privileges for role postgres
  revoke execute on functions from public;
revoke maintain on table public.daily_drafts, public.custom_habits, public.rule_preferences
  from anon, authenticated;
commit;
