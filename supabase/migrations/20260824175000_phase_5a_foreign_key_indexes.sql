-- Phase 5A: cover composite economy foreign keys in their declared column order.
-- These indexes support FK checks and the later Phase 5B transaction paths.

create index economy_transactions_reversal_user_idx
  on public.economy_transactions(reversal_of_transaction_id, user_id)
  where reversal_of_transaction_id is not null;

create index economy_transactions_ticket_user_idx
  on public.economy_transactions(ticket_id, user_id)
  where ticket_id is not null;

create index player_reward_tickets_acquisition_user_idx
  on public.player_reward_tickets(acquisition_transaction_id, user_id);
