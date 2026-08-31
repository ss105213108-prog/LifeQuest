# LifeQuest — README Preparation Report

文件分類：CURRENT。核對日期：2026-08-31。這是 STEP 3 的準備資料，不是正式根目錄 README，也不代表已授權發布 GitHub。

STEP 5 狀態補記：根目錄 [README](../README.md) 已在 STEP 4 建立；Live Demo URL 已由擁有者提供。Privacy／Screenshot 與尚待拍板事項見 [Publication Review](PORTFOLIO_PUBLICATION_REVIEW.md)，第三方 notices 見 [Third-party Notices](THIRD_PARTY_NOTICES.md)。本文件保留原準備用途，不冒充新的線上驗收。

## 1. 證據層級與產品狀態

- 本機 source／package／tests／release config：本輪直接核對。
- Portfolio V1、Phase 6 與 Final UX／Release Setup 已接受：依專案擁有者先前明確確認；本輪不重做 live 驗收。
- 先前完整自動化 baseline：548 passed / 0 failed / 0 skipped。這是已接受的完整測試結果，不是本文件建立時重跑 548 次的聲明。
- 先前 Netlify HTTPS／headers／CSP smoke、Supabase Edge v16 ACTIVE／verify_jwt=true、A/B cleanup 等：屬既有驗收證據，不宣稱本輪重新查詢線上狀態。
- Portfolio V1 完成不等於 production Auth 全功能、全面合規認證、沒有任何風險或永遠不會出錯。

## 2. 未來 README 可使用的介紹

**Project Name**：LifeQuest — Real Life RPG

**Project Type**：Job Portfolio Demo V1

**Project Description**：LifeQuest 將睡眠、飲水、運動、學習與消費紀錄轉化為角色成長、習慣挑戰及遊戲資源。使用者可以用 Guest 模式在本機體驗，或登入 Member 模式，以 Supabase 保存權威遊戲狀態。作品重點包含 Server-authoritative commands、交易一致性、帳號隔離、重試安全與響應式 Web UI。

不要把 package.json 的 `version: 2.0.0` 改稱為 Portfolio V2；套件版本與「Portfolio Demo V1」產品範圍是不同標記。`private: true` 是 npm package 設定，不是 GitHub repository 可見性決策。

## 3. Core Features 與實作依據

| 功能 | 可安全描述的範圍 | 主要證據 |
| --- | --- | --- |
| Guest Mode | 本機存檔、離開／再次進入保留進度 | [guestMode.js](../guestMode.js)、[Guest tests](../tests/guest-mode.test.js) |
| Member Mode | Auth、Cloud bootstrap／reload、onboarding／主線、session cleanup | [memberAuth.js](../memberAuth.js)、[app.js](../app.js) |
| Daily / Habit | 草稿、正式結算、事件、受安全條件限制的復原／更正 | [Edge handler](../supabase/functions/lifequest-command/index.ts)、[Phase 4 tests](../tests/phase4b-transactional-gameplay.test.js) |
| EXP / Level | total_xp 與 level-v1、多級升級、HP／四項能力值 | [Phase 4 Domain](../supabase/functions/_shared/phase4Domain.mjs) |
| Boss | Server 判定觸發、挑戰進度、擊敗與獎勵 | 同上、[Boss regression](../tests/boss-slayer-regression.test.js) |
| Achievement | 進度、一次性 unlock／reward、snapshot preservation | [Achievement regression](../tests/achievement-snapshot-merge.test.js) |
| Economy | Gold 商品、Gems 自我犒賞券、Catalog version／價格確認 | [Economy Domain](../supabase/functions/_shared/phase5EconomyDomain.mjs)、[Economy tests](../tests/phase5b-transactional-economy.test.js) |
| Inventory / Equipment | 藥水 quantity、唯一裝備持有、weapon／armor／pet、derived modifiers | [Member Economy UI](../memberEconomyUi.js)、[Phase 5 migrations](../supabase/migrations/) |
| Statistics | Chart.js 圖表、生活紀錄／角色狀態分析 | app.js 的 renderInsightsPage／Chart，以及 [lifequestCore.js](../lifequestCore.js) 的本機計算 |

統計／Advisor 的啟發式文字不可包裝成已接入外部 LLM 的 AI API。也不要把早期設計稿的所有願景、自訂 Cloud 規則／雲端匯入、儲蓄等未開放 Member 功能列為正式功能。

## 4. Tech Stack

- HTML、CSS（Grid／Flexbox／media queries）、Vanilla JavaScript。
- Supabase Auth、PostgreSQL／RLS、Edge Functions（TypeScript／Deno runtime）、transactional RPC。
- Browser libraries：Chart.js 4.5.1、Lucide 1.31.0、Supabase JS 2.112.3。
- Local tooling：Node.js、npm、內建 node:test／assert、Supabase CLI 2.115.0 dev dependency。
- Netlify 靜態 hosting、allowlist release scripts、`_headers`。
- Google Fonts：Noto Serif TC／Outfit（外部載入）。

版本依 [package.json](../package.json)、[package-lock.json](../package-lock.json)、[index.html](../index.html) 與 vendor bundle 核對。沒有 React／Vite／Webpack，也不需要宣稱原生手機 App。CLI executable 不提交 Git。

## 5. Architecture / Engineering Highlights

```text
Guest UI → 本機 Domain / GameApplication → LocalStorageRepository
                                         → lifequest_state

Member UI → coordinator / GameApplication → RemoteCommandRepository
          → Supabase transport → lifequest-command Edge
          → transactional RPC → PostgreSQL
          → authoritative projection → normalization / UI
```

- Member current state 與 ledger／operation receipt 分工；Client 不能送整包資源 snapshot 覆寫 Server。
- RLS、ownership validation、service-only RPC、Guest／Member 隔離。
- operationId／idempotency、unknown-result retry、VERSION_CONFLICT 與 Catalog re-confirmation。
- Account identity／runtime generation guard 防止 stale bootstrap／late response 跨帳號污染。
- Bootstrap start/end repositoryVersion fence，最多 3 attempts，不穩定時安全失敗。
- 單一 command 的 domain writes／resources／ledger／receipt／version atomic commit。
- Mobile RWD、hidden dialog regression、clean release allowlist、secret scan 與 Netlify security/cache headers。

完整路徑、19 個實際開放命令與錯誤／時間邊界見 [BACKEND_INTEGRATION.md](../BACKEND_INTEGRATION.md)。不要把 Member journal／Auth 的本機 storage 說成 Guest 存檔，也不要聲稱 Member 完全不用 local storage。

## 6. Testing：548 的精確寫法

可用措辭：

> 在 Portfolio V1 Final Release Setup 的既有完整驗證中，自動化測試結果為 548 passed、0 failed、0 skipped。後續 GitHub cleanup 僅修改 ignore／文件；這個數字代表已驗證 baseline，不是測試覆蓋率或 548 個真實 Supabase E2E 情境。

尚未建立 Git commit／CI run 連結，不能捏造綠色 CI badge 或稱每次 push 都已通過。正式 README 若要宣稱「此 commit 最新跑過 548」，應在允許重建 dist 的驗證回合執行完整 suite，並記錄 commit／日期／runtime。

| 命令 | 實際作用 | 副作用／限制 |
| --- | --- | --- |
| `npm ci` | 依 lockfile 安裝依賴 | 修改 node_modules／cache，不是唯讀 |
| `npm run serve` | 127.0.0.1:4173 本機 preview | 是開發 server，不是公開 hosting |
| `npm run check` | JavaScript／工具 syntax check | 不是完整 automated tests |
| `npm test` | node:test suite | 其中 7 個 release tests 的 before hook 重建 dist |
| `npm run release` | 重建並驗證 allowlist dist | 不能在 no-rebuild 審查執行 |
| `npm run release:verify` | 驗證既有 dist | 不重建 artifact |

本機核對環境 Node v24.18.0；package 未宣告 engines，不能聲稱所有舊 Node 都支援。Edge harness 使用 node:module 的 stripTypeScriptTypes，正式快速開始應記錄已驗證版本。

一般 tests、mock HTTP／DOM harness、captured DB metadata assertions、真實 Supabase E2E、真人驗收是不同證據層。`tests/*-live-verification.cjs` 不由一般 `npm test` 自動執行；不要教讀者直接拿目前人工會員或正式專案跑 live scripts。部分 cleanup 依 exact IDs 要另外執行 Auth admin 刪除／residual 核對，不能把 sign-out 等同完整刪除。

本輪 STEP 3 實際驗證：`npm run check` PASS；明確排除 `phase6c3-release-readiness.test.js` 後，其他 36 支測試檔得到 **541 passed / 0 failed / 0 skipped**。該檔的 7 個 release tests 因 no-rebuild 限制沒有執行，不是失敗或刪除／修改 test。既有 `dist/` 的唯讀 release verification PASS。這些結果不混稱為本輪新的 548/548。

## 7. Deployment / Security / Roadmap

GitHub 是完整工程 source；Netlify 只部署 `dist/`，Supabase 提供 Member backend。`.gitignore` 排除 dist，不表示刪除本機 artifact。正式 [Live Demo](https://eloquent-quejadas-ffaea3.netlify.app) 已由擁有者於 STEP 4 提供並加入 README；本輪不宣稱重新驗證線上登入。

已實作的安全措施可以描述為：RLS／命令權限、Server-authenticated ownership、body／payload validation、錯誤 sanitization、idempotency、snapshot fence、Guest／Member separation、publish allowlist、secret scan、HTTPS hosting 的安全 headers 配置。詳細設定見 [RELEASE_READINESS.md](../RELEASE_READINESS.md)。Browser-safe publishable key 不是 server secret；也不能單憑公開 key 或通過 scanner 宣稱整站零風險。

Portfolio V1 Complete 與下列項目分開：

- Known UX limitation：Daily Correction 的 edit → save → submit workaround。
- 已知 Guest／Member 規則差異：cactus 舊 Guest 規則可能 +2；Member 正式為 Gold +1。
- Production Auth：Leaked Password Protection、Confirm Email／Recovery／SMTP／OAuth／MFA 等不列為已完成；各項是否要導入與排程仍需 product/security 決策。
- CSP 仍為允許既有 inline handlers/styles 的相容方案，非 nonce/hash strict CSP；後續強化另行授權。
- `supabase_admin` future defaults 的平台管理限制不能宣稱已修；依既有驗收採用的 mitigation／risk acceptance 與未來平台確認分開記錄。
- `private.command_operations` intentional server-only 不等於一個應開 Browser policy 的缺陷。

不宣稱正式 GDPR 認證、production SLA、銀行／醫療用途或全面滲透測試。素材與 license 狀態也獨立於技術驗收，見 [Attribution inventory](ATTRIBUTION_INVENTORY.md)。

## 8. 文件分類與導讀

| 文件 | 分類／本輪處理 | 未來 README 導讀 |
| --- | --- | --- |
| BACKEND_INTEGRATION.md | NEEDS CORRECTION → CURRENT；依現行 source 校正 | 工程架構主入口 |
| ART_DIRECTION.md | CURRENT；補充不是權利證明 | 可選美術設計說明 |
| CONTEXT.md | CURRENT；補充用語範圍、Gold／Gems 分工 | 可選產品語彙 |
| RELEASE_READINESS.md | NEEDS CORRECTION → CURRENT；區分歷史驗收、後續部署與已完成修復 | 發布／測試說明 |
| LifeQuest_專案設計構想.md | HISTORICAL / EARLY DESIGN；原文保留 | 不當作現行規格 |
| tests/phase6b2-verification.md | HISTORICAL VERIFICATION；原數字／狀態保留 | 深入安全演進時才引用 |
| vendor/README.md | NEEDS CORRECTION → CURRENT；補 Supabase 與 license 缺口 | Attribution 導讀 |
| vendor/chart.js/LICENSE.md、vendor/lucide/LICENSE | 第三方授權文本，保留原文 | 法律／來源附件，不改寫內容 |
| 本文件、ATTRIBUTION_INVENTORY.md | CURRENT preparation／inventory | 正式 README 的素材，不冒充正式首頁 |

低首頁展示價值不等於刪除：細部 live runner 操作、SQL verification、captured metadata 與逐 Phase 紀錄可保留供深入審查，不必把面試官首先導向所有內部細節。fixtures／SQL／runners 不是 Markdown，本輪只盤點，未改動。

目前不移動既有文件，避免測試／migration comments／既有引用失效。未來若要整理，可採 docs/architecture、docs/historical、docs/release；移動前先核對所有引用並另外授權。

## 9. USER DECISION REQUIRED / Missing materials

1. 作者顯示真名、GitHub username 或不設 Author section，仍待決定。Demo identity 已於 STEP 5.1 **DECISION RESOLVED**：Runtime Demo Name 為「測試冒險者」，與作者身份分開，不改既有 Guest save／Member DB 名稱。
2. Repository license 要採哪一種，及其適用範圍；第三方套件的 MIT／ISC 不自動套用到 LifeQuest。
3. 是否加入 AI-assisted development disclosure，以及可核實的個人貢獻／工具協作說明。
4. 要放幾張現行 Screenshot、選哪些頁面與語言；需使用可公開 Demo 資料，不使用被排除的帳號截圖。
5. 正式 Live Demo URL 已提供，README 採 Guest 或自行註冊體驗、不提供共用帳密；若未來為 screenshot 準備專用 Demo account，需另設安全資料與權限範圍，不發布 credential。
6. 是否公開完整 live verification 工具；若公開需附手動授權、project targeting、資源／清理注意事項，不能將它們包裝成無副作用的一鍵 quickstart。
7. 九張 LifeQuest PNG 的來源已於 STEP 5.1 **DECISION RESOLVED**：使用者確認為其先前為 LifeQuest 專案透過 ChatGPT 生成的視覺素材。記為 USER-CONFIRMED CHATGPT-GENERATED ASSET，不宣稱手繪；repository metadata 不足以獨立重建完整生成歷史。素材再利用條件與 project license 仍是獨立決策。

STEP 5 已補 Public GitHub 的 Supabase／已辨識依賴 notices、Google Fonts family-level OFL 證據，並記錄 PNG 的 caBX 生成聲明線索；STEP 5.1 已補使用者來源確認，不再將九張圖片列為來源完全未知。這不等於替所有內容選定通用 license。後續仍有 dist distribution notices、完整 bundle SBOM、可重現 backend setup 指引（包括歷史 migration timestamp 對照）、最新測試證據連結等待確認。`dist/` 本輪未重建，仍需另行同步中性 Demo default。圖片 provenance 不構成新增 AI-assisted development disclosure 的授權。
