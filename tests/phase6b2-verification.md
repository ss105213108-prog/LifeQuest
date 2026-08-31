# Phase 6B-2 authorized hardening verification

> **HISTORICAL VERIFICATION RECORD — 歷史驗證紀錄。**
> 此文件描述當時階段狀態，不代表目前 Final Release 狀態。下方的 WAITING AUTHORIZATION、NOT CLOSED、Edge v14、450／486 tests、residual 與權限觀察均保留原始時間語境，不改寫為後續版本或驗收數字。
> 後續 Portfolio 驗收狀態與證據限制見 [README preparation](../docs/README_PREPARATION.md)。歷史未解決項目不得僅因階段後來結案就推定已由平台修復；必須區分修復與風險接受。

Status: authorized local/DB work completed; WAITING AUTHORIZATION / NOT CLOSED.
Project: LifeQuest `jwpbwlrdzmfzjlbrktlc`.
Verified: 2026-08-29 Asia/Taipei.
Online Edge remains lifequest-command v14 ACTIVE, verify_jwt=true. No deployment this turn.

## Evidence and scope

- Baseline: 450 passed, 0 failed, 0 skipped.
- Final: 486 passed, 0 failed, 0 skipped; npm run check passed.
- Added 36 tests: 27 HTTP/contract tests, 4 recorded DB audit tests, 5 attack-harness guard tests.
- No existing test was deleted or skipped. Two existing Phase 6B-1 cases explicitly expected the former optional version policy; they retain their valid/invalid cases and now assert rejection plus zero RPC calls for the newly forbidden missing versions.
- Secret scan: 0 findings.
- Existing tracked source hash comparison: only backendContract.js, lifequest-command/index.ts, and tests/phase6b1-edge-security.test.js changed.
- Guest, UI, memberAuth, gameplay engines, economy definitions and transaction kernel files unchanged.

Snapshots contain schema/ACL/function definitions, not member rows or credentials:
- fixtures/phase6b2-before.json
- fixtures/phase6b2-after-privileges.json
- fixtures/phase6b2-after.json

Recorded-snapshot tests are offline assertions over actual captured live metadata, not a claim that npm test opens a live database.

## Exact privilege changes

Postgres-owned public future TABLE/SEQUENCE/FUNCTION defaults no longer grant to anon/authenticated/PUBLIC.
Postgres global FUNCTION PUBLIC EXECUTE was revoked as well; schema-level revocation cannot subtract the implicit global grant. This global setting necessarily applies to future postgres functions in all schemas; existing function ACLs are unchanged. Explicit service_role defaults and existing service_role permissions are preserved.

Only MAINTAIN was removed from anon/authenticated on daily_drafts, custom_habits and rule_preferences.
Their authenticated SELECT grant, own-user RLS policies and owner are unchanged.
All other existing table ACLs, all RPC ACLs, schema ACLs, RLS policies and ownership compare identical.

Only four private function bodies changed:
- select_main_quest
- update_member_profile
- execute_phase3_command
- execute_phase5b_economy_command

An exact text comparison proves each differs only by its reviewed mandatory-version guard before operation reservation; all remaining body text, locks, transactions, receipts and version comparisons are unchanged.

## New migrations only

| Local file prefix / name | Online version |
| --- | --- |
| 20260828155530_phase_6b2_postgres_privilege_hardening | 20260828155616 |
| 20260828155920_phase_6b2_mandatory_command_versions | 20260828160055 |

Online apply_migration assigned its own timestamps. Names and reviewed SQL establish the mapping.
All 25 pre-existing online migration version/name/SQL hashes are unchanged; now 27.
Do not db-push/replay historical files because their timestamps differ.
A rollback, if ever required, must be a new reviewed migration restoring the exact captured definitions/ACLs, not a blanket GRANT.
CLI could not create its global config under the local filesystem restrictions, so these two new migration files were created with apply_patch and applied individually via Supabase MCP; no blind CLI migration replay occurred.

## Command matrix / policy

| Group | Commands | expectedVersion |
| --- | --- | --- |
| Bootstrap | INITIALIZE_MEMBER_PROFILE | Optional, existing bootstrap exception |
| Profile | SELECT_MAIN_QUEST, UPDATE_PROFILE | Required |
| Phase 3 | SAVE_DAILY_DRAFT, CREATE_CUSTOM_HABIT, UPDATE_CUSTOM_HABIT, REMOVE_CUSTOM_HABIT, RESTORE_CUSTOM_HABIT, SET_RULE_ENABLED | Required |
| Phase 4 | REPORT_HABIT_EVENT, REVERSE_HABIT_EVENT, SUBMIT_DAILY_ENTRY | Required |
| Economy | PURCHASE_ITEM, USE_ITEM, EQUIP_ITEM, UNEQUIP_ITEM, REDEEM_REWARD_TICKET, USE_REWARD_TICKET, REVERSE_REWARD_TICKET | Required |
| Read | GET/bootstrap/catalog reads | Not required |

HTTP expectedVersion remains in If-Match, never duplicated in the envelope body.
Absent/invalid values produce INVALID_PAYLOAD before Auth/service client/RPC work.
Stale/future valid values retain VERSION_CONFLICT for new operations.
A completed identical request with its original non-null version retains duplicate behavior before the actual version comparison. New presence validation is not a new idempotency system.
Historical requests that omitted newly-required fields are not exempt from the tightened contract; no historical receipts were edited.

PURCHASE_ITEM and REDEEM_REWARD_TICKET require seenCatalogVersion, a positive safe integer, in client serialization, Edge validation and the existing service-only DB command.
Missing/invalid is INVALID_PAYLOAD. Existing stale catalog handling remains CATALOG_CHANGED and requires re-confirmation; no client price authority.

## Red -> green

- Missing If-Match HTTP tests: 18 failures before fix, all pass after; bootstrap exception remained valid.
- Missing catalog version: 2 failures before fix, both pass after.
- Recorded ACL test: failed on the implicit global FUNCTION PUBLIC EXECUTE gap, passes against live after snapshot.
- Live DB probes against a random UUID proven absent from auth.users previously reached receipt FK failure (23503) rather than rejecting the missing contract field. After the guards, they return INVALID_PAYLOAD before reservation.
- These probes never created a user or used an existing member.

## Live verification performed without accounts

1. phase6b2-db-contract-verification.sql:
   - service_role executes 3 missing expectedVersion cases and 12 invalid/missing catalog-version cases.
   - All return INVALID_PAYLOAD.
   - Zero rows for the absent probe identity across every user-owned public/private table.
   - The whole verification ends with ROLLBACK.
2. phase6b2-role-verification.sql:
   - 120 INSERT/UPDATE/DELETE planner permission probes: 20 tables x 2 Browser roles x 3 operations.
   - EXPLAIN without ANALYZE: no DML execution and no member identity impersonation.
   - anon SELECT denied; authenticated public-table SELECT permission retained; private receipts remain blocked.
   - Sensitive RPC planner calls denied for anon/authenticated and permitted for service_role.
3. All 20 application tables retain RLS. The 18 private member public tables keep own-user SELECT policies; active item_catalog is the deliberate authenticated catalog exception.
4. SECURITY DEFINER functions retain fixed search_path and restricted execution; no new definer function.
5. Advisor: existing INFO private.command_operations RLS-with-no-policy (intentional service-only table) and existing WARN Leaked Password Protection disabled. Auth release settings untouched.

These checks are NOT real JWT A/B isolation, successful Member Phase 3 end-to-end, or live stale-version/concurrent transaction verification. They do not replace those tests.

## A/B preparation and remaining authorization

helpers/phase6b2-attack-harness.cjs prepares an explicit-authorization, exact-two-user, exact-project runner. It does not create accounts or execute automatically.
It checks real session identity, own Profile positive control, bilateral cross-row reads, direct writes, foreign ticket/habit IDs, exclusive equipment ownership, forged ownership and sensitive RPC access.
The no-partial assertion compares both users' repositoryVersion, Gold, Gems, HP, totalXp, inventory, equipment, tickets, ledger, receipts, transactions and domain rows before/after each rejected attack. Wrong Auth/network errors cannot count as a passing ownership test.
The future authorized caller must supply an actual HTTP command adapter and read-only audit adapter with stable row ordering.

Required temporary fixtures (only after new authorization):
- Two randomly generated temporary accounts in the exact LifeQuest project, credentials cryptographically random and never logged.
- Normal bootstrap and minimum command-created Phase 3/gameplay/economy fixtures.
- Distinct owned inventory and verified real ticket/habit IDs; no existing member data as fixtures.
- Minimum auditable resources for positive-control economy requests.
- Full live matrix: own SELECT, A/B cross access, valid/stale/future/missing expectedVersion, duplicate original-version retry, reused ID/different payload, same-version concurrent requests, missing/invalid/stale/current catalog version, forbidden fields.
- For all rejected attacks compare complete before/after audit, including operation receipts and ledger, not just HTTP status.
- An exact duplicate after subsequent commands must not increment version or change resources; a new conflicting command must not leave a partial reservation.
- Existing member aggregate fingerprints are read-only controls, never transaction targets.
- Cleanup: exact newly-created user-ID allowlist, best-effort global sign-out, Auth admin deletion and cascade verification across all user tables/private receipts/ledger/transactions plus auth.users. No password-derivation recovery.
- Final residual verification must be zero for both allowlisted IDs.
- Current turn: 0 temporary accounts created, no cleanup deletion necessary.

The new local Edge contract is not deployed. Schedule an explicitly scoped deployment/validation before claiming production HTTP contract coverage.

## Unresolved platform default privileges

supabase_admin defaults are byte-for-byte unchanged: UNRESOLVED / PLATFORM-MANAGED PRIVILEGE ISSUE.
The postgres connection cannot safely manage this platform role and no elevation was attempted.

The remaining default ACL rows do not retroactively expose existing objects. Current LifeQuest public/private application table and RPC ACLs are hardened; the unresolved risk is future objects created by supabase_admin under those defaults, not a demonstrated existing application-row exposure. This is not a claim to audit every Supabase platform-owned schema.

Official guidance:
- [Supabase roles and unsupported superuser operations](https://supabase.com/docs/guides/database/postgres/roles-superuser): postgres is not a hosted superuser.
- [Supabase API security/default privileges](https://supabase.com/docs/guides/api/securing-your-api): grants plus RLS, opt-in defaults and platform-managed supabase_admin context.
- [PostgreSQL ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html): defaults affect future objects; schema grants add to global defaults and cannot subtract global PUBLIC EXECUTE.

Supported next step: ask Supabase Support through the project's support channel to confirm whether its platform rollout or a supported platform operation can remove/adjust these supabase_admin defaults. No verified user-controlled Dashboard switch was found that grants postgres this authority. Dashboard SQL Editor does not confer superuser capability. Do not promise Support will change them without confirmation.
Mitigation meanwhile: application migrations as postgres, explicit object grants, retain RLS and audit each new object. This is mitigation, not resolution. Disabling Data API/changing exposed schemas would affect LifeQuest and is NOT part of this change.
Closure remains blocked unless the platform item is resolved through a supported route or the user explicitly accepts the residual risk, and deployment/live A/B verification is completed.

## Stop

No Phase 6B-3 or 6C work. No Auth release-setting, Guest, Daily Correction or cactus change.
TEMP A/B TEST AUTHORIZATION REQUIRED.
