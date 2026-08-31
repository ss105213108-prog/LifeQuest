-- LifeQuest Phase 4A: remove broad table privileges inherited by Phase 3 objects.
-- Authenticated members retain SELECT-own access through RLS; writes remain server-only.

revoke select, insert, update, delete, truncate, references, trigger
  on table public.daily_drafts, public.custom_habits, public.rule_preferences
  from anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.daily_drafts, public.custom_habits, public.rule_preferences
  from authenticated;

grant select on table public.daily_drafts, public.custom_habits, public.rule_preferences
  to authenticated;

