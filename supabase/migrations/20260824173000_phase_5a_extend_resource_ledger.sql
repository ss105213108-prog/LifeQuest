-- LifeQuest Phase 5A: extend the existing authoritative ledger for future economy writes.
-- Existing Phase 4 values remain valid and no resource mutation is performed here.

alter table public.resource_ledger drop constraint resource_ledger_reason;
alter table public.resource_ledger add constraint resource_ledger_reason check (reason in (
  'daily_reward', 'daily_failure', 'habit_reward', 'habit_damage',
  'death_penalty', 'boss_reward', 'achievement_reward', 'reversal',
  'item_purchase', 'item_use', 'ticket_redemption', 'ticket_refund',
  'economy_reward', 'economy_compensation'
));

alter table public.resource_ledger drop constraint resource_ledger_source_type;
alter table public.resource_ledger add constraint resource_ledger_source_type check (source_type in (
  'daily_entry_revision', 'habit_event', 'death', 'boss_action', 'achievement',
  'reversal', 'system', 'economy_transaction', 'reward_ticket'
));

comment on constraint resource_ledger_reason on public.resource_ledger is
  'Phase 4 reasons plus Phase 5 economy-compatible reasons; Phase 5A creates no ledger rows.';
