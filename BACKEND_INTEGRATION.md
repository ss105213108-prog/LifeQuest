# LifeQuest Portfolio V1 — 後端接軌說明

文件分類：CURRENT。2026-08-31 依本機 source 核對；本輪只改文件，沒有查詢或修改線上 Supabase。早期 seam 範例已由下列現行說明取代，不以文件推動 implementation 變更。

## 1. Authoritative boundary

- Guest：UI 使用本機 Domain／GameApplication 與 `LocalStorageRepository`，遊戲存檔以 `lifequest_state` 為 authoritative source。離開 Guest 不刪存檔。
- Member：Supabase PostgreSQL 是遊戲資料的 authoritative source。UI 只提交玩家意圖，由 Server 計算及保存結果；Cloud bootstrap／response 驅動 Member projection。
- Member 使用本機儲存保存 Auth session、以 `member:<userId>` 隔離的 pending operation journal，以及必要的 UI 狀態。這些不是本機 authoritative 遊戲餘額；不能因此宣稱「Member 完全不使用 LocalStorage」。
- Guest 存檔不會自動 merge／overwrite 到 Member，也不會在 Member 連線失敗時拿來補 Cloud 資料。
- `RemoteCommandRepository.commit/replace` 拒絕整份 snapshot 寫回，`clear` 也不能直接刪遠端 state。未 command 化的 local transition 不可套到 Member。

依據：[gameApplication.js](gameApplication.js)、[memberAuth.js](memberAuth.js)、[guestMode.js](guestMode.js)、[supabaseClient.js](supabaseClient.js)。

## 2. 真正的 HTTP 路徑

```text
Member UI
  → Member auth coordinator / GameApplication
  → RemoteCommandRepository
  → createSupabaseTransport
  → lifequest-command Edge Function
  → service-only transactional RPC
  → PostgreSQL
  → authoritative projection / normalization / UI
```

| 行為 | Repository 邏輯 path | Supabase transport 實際目的地 |
| --- | --- | --- |
| bootstrap／reload | GET /v1/game/state | GET {projectUrl}/functions/v1/lifequest-command |
| mutation | POST /v1/game/commands | POST {projectUrl}/functions/v1/lifequest-command |

`memberAuth.js:createSupabaseTransport` 使用固定的 Edge endpoint；不是把上述邏輯 path 當成已部署 API。本文提到 bootstrap 是 GET 分支，不代表另一個實際部署的 `/bootstrap` URL。

## 3. Command contract

[backendContract.js](backendContract.js) 建立 envelope：

- `contractVersion`、`type`、`operationId`、`occurredAt`。
- `context.businessDate`、`context.timeZone`。
- `intentKey` 與玩家原始 `payload`。

`createApiRequest` 建立 POST、JSON body、`Content-Type`、`Idempotency-Key`、`X-LifeQuest-Contract-Version`。Repository 把 `expectedVersion` 寫入 `If-Match` header；不是 body 欄位。Transport 加入 session 的 Authorization 及 browser-safe apikey，文件不提供真實憑證。

例如 Daily 的 raw payload 只有：

```json
{
  "sleep": 8,
  "water": 2000,
  "exercise": 40,
  "study": 30,
  "expense": 120,
  "impulse": 0,
  "sugaryDrinks": 0
}
```

日期放在 envelope 的 `context.businessDate`，不在這份 payload 放 `date`。Client 不得提交 userId、EXP／HP／貨幣結果、結算獎勵或裝備 modifier 作為 authoritative input。

### 目前 Edge 開放的命令

| 類別 | Commands | RPC |
| --- | --- | --- |
| Profile | INITIALIZE_MEMBER_PROFILE / SELECT_MAIN_QUEST / UPDATE_PROFILE | initialize_member_profile / select_main_quest / update_member_profile |
| Phase 3 | SAVE_DAILY_DRAFT / CREATE_CUSTOM_HABIT / UPDATE_CUSTOM_HABIT / REMOVE_CUSTOM_HABIT / RESTORE_CUSTOM_HABIT / SET_RULE_ENABLED | execute_phase3_command |
| Gameplay | REPORT_HABIT_EVENT / REVERSE_HABIT_EVENT / SUBMIT_DAILY_ENTRY | execute_phase4b_command |
| Economy | PURCHASE_ITEM / USE_ITEM / EQUIP_ITEM / UNEQUIP_ITEM / REDEEM_REWARD_TICKET / USE_REWARD_TICKET / REVERSE_REWARD_TICKET | execute_phase5b_economy_command |

- 除 `INITIALIZE_MEMBER_PROFILE` 保留 bootstrap 例外，其餘 18 個 mutation commands 必須有非負安全整數版本。
- Purchase／Redeem 必須有正整數 `seenCatalogVersion`；Catalog 過期回 `CATALOG_CHANGED`，不偷偷改價成交。
- Contract 檔內另有歷史／預留名稱，不代表 Edge 已開放。例：`IMPORT_CLOUD_DATA` 不是現行 Member 路由；不要把 Guest 匯入或早期匯入白名單寫成已開放的 Cloud 功能。

## 4. Auth、Server calculation 與 transaction

[Edge index.ts](supabase/functions/lifequest-command/index.ts) 先檢查 method、body／envelope、版本與 Auth，使用 `auth.getUser()` 驗證呼叫者。service-role client 在 Auth 成功後才建立；RPC 的 `p_user_id` 來自已驗證的 user，不是 Client payload。

- Gameplay 使用 [phase4Domain.mjs](supabase/functions/_shared/phase4Domain.mjs) 計算 plan；SQL transaction 仍鎖定與重查 repository version、ownership 及寫入條件。
- Economy 由既有 RPC 取得 authoritative Catalog／resources 並處理交易，使用 [phase5EconomyDomain.mjs](supabase/functions/_shared/phase5EconomyDomain.mjs) 的相關 Domain foundation。
- Member root 是 serialization／version 邊界；current resources 在 player state，資源原因在 ledger，經濟生命週期在 economy transactions。
- 一次成功 mutation 的 domain writes、ledger、current state、receipt 及 repository version 在同一 DB transaction 成功或 rollback；不是 Edge 分別對每張表寫入。
- Browser 不能直接寫重要會員資料；會員資料採 own-user read policies，Catalog 有其明確的共享讀取規則。敏感 RPC 僅 Server 可執行。
- `private.command_operations` 是刻意的 server-only receipt store，不是 Browser 的一般資料表。

具體 schema／權限以 [migrations](supabase/migrations/) 為準，不應只靠本文件判斷線上權限。service-role、DB password、JWT／refresh token 都不得放入 Public Repo。

## 5. Idempotency、version conflict 與 response

- 同一 user + operationId + 相同 command：回 duplicate，不再次扣款／發物／發獎或增加版本。
- 同 operationId 換 command：`OPERATION_ID_REUSED`。
- 新操作使用 stale version：`VERSION_CONFLICT`。UI reload Cloud，由使用者重新確認，不把衝突交易自動重送。
- Unknown-result／response loss：pending journal 保留原 command 與 operationId，reload 後同 intent 的 retry 不換成新操作。
- 一般成功 mutation version +1；duplicate、rejected conflict、失敗／rollback 不額外增加版本。
- Duplicate 保留原操作結果，同時回傳目前 authoritative state；不要把舊 receipt snapshot 當最新會員餘額。
- Command response 可能只有局部 projection；`mergeMemberCloudState` 保留未回傳欄位，避免 Economy response 清掉 achievements 等完整資料。需要完整 state 時仍走 Cloud bootstrap。
- `repositoryVersion` 可出現在 response 頂層與 `state.meta`；不顯示於會員卷宗 UI，不代表機制已刪除。
- Account identity／runtime generation／較新 version 保護會拒絕不合時宜的 response，防止 A 的回應污染 B。

## 6. Bootstrap snapshot fence

GET 每個 attempt：

1. 讀 root 的 startRepositoryVersion。
2. 讀取完整 Member projection，包括 profile、drafts、habit events、resources、status、boss、achievements、economy 與 Catalog。
3. 再讀 endRepositoryVersion。
4. 兩者相同才回傳這份 projection，並使用通過 fence 的版本。
5. 不同則丟棄整份讀取結果，重新讀全部資料。

最多 **3 attempts**。仍不穩定時回 HTTP 409 `VERSION_CONFLICT`、`retryable: true` 與 currentVersion，不回 mixed projection。

這不是把多次 PostgREST read 變成一個 DB read transaction；一致性保護依賴影響會員 projection 的 authoritative mutations 在同一 transaction 更新 root version。相關回歸見 [bootstrap snapshot tests](tests/phase6c2-bootstrap-snapshot.test.js)。不應將此 fence 擴張宣稱成對任意平台／管理端寫入的保證。

## 7. Daily／Habit 時間與資料模型

- V1 使用 Asia/Taipei。Habit Event 只接受 Server today；Daily Entry 接受今天及過去 7 天，拒絕未來日期。
- Habit Event 與正式 Daily Draft 是不同事實來源。Server reconciliation 建立 settlement effective input。
- `daily_entries` 的 identity 是 `UNIQUE(user_id, business_date)`；`daily_entry_revisions` 保存同 entry 的修訂，不建立第二個獨立「今天」。
- `private.command_operations` 使用 `(user_id, operation_id)` 識別操作。
- Backfill 可影響目前 EXP／Gold／Gems／HP，但不召喚或推進目前 Boss；已過期 status 不重新啟動。
- Safe reversal／correction 受 dependency safety 限制，不是任意歷史 event replay。
- 已接受 UX limitation：修改已結算 Daily 時，仍可能需要「修改 → 保存 → 蓋章」。這是 workaround，不把 SAVE_DAILY_DRAFT 說成會發獎的正式 settlement。

## 8. 安全與證據邊界

Request body 上限與錯誤 sanitization 見 [edgeRequestSecurity.mjs](supabase/functions/_shared/edgeRequestSecurity.mjs)。Network failure 不等於 session expiry；已有完整 Member projection 時，offline reload 失敗保留最後成功資料並顯示安全錯誤，不 fallback Guest。

本文件是 source-backed 說明，不是本輪 live A/B、Advisor 或 deployment 報告。Portfolio 已接受結果、548-test baseline 與 Production roadmap 的用語限制見 [README preparation](docs/README_PREPARATION.md)。歷史 migration timestamp 對照保留在 [Phase 6B-2 record](tests/phase6b2-verification.md)；不得因文件整理而 blind replay migration。
