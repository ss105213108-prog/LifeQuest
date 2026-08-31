# LifeQuest — STEP 5 Privacy / Screenshots / Publication Review

核對日期：2026-08-31。結果：**PASS WITH USER DECISIONS**。這是 Public GitHub Preflight 的準備文件，不是 Push／Deploy 授權，也不是所有素材權利已通過的聲明。

STEP 5.1 更新：**Demo identity 與九張 PNG 來源決策已 RESOLVED**。Runtime／HTML 的中性預設名稱已改為「測試冒險者」，相關合成測試同步更新；圖片來源依使用者確認記錄為 ChatGPT 生成。本文件保留 STEP 5 的盤點歷史；第 1 節的唯讀範圍與起始數量屬 STEP 5，不是 STEP 5.1 的修改範圍聲明。`dist/` 本輪未重建，尚未同步新預設名稱。

## 1. Audit boundary / evidence

- 僅讀本機候選、source、package／license／PNG metadata，並查閱官方 license 文件；未登入正式會員、查詢會員 DB 或執行 live runner。
- 以專案根目錄的 `.gitignore` 與 `rg --files --hidden --no-require-git` 模擬候選；沒有 Git Init／Add，沒有用真實 index 假裝已追蹤。未來若忽略規則、global excludes 或 index 改變，仍需重查。
- 起始 1,590 個檔案：138 個 candidate、1,452 個 ignored。新增本文件及 Third-party Notices 後，預期為 140 個 candidate；既有文件只有 Markdown 更新。
- 使用現有 secret scanner 加上候選文字的 email／電話／路徑／UUID／credential assignment 篩選與上下文確認；九張公開候選 PNG 另做目視與 chunk 檢查。這不是對圖片 steganography 或所有未知憑證格式的零風險保證。

## 2. Privacy findings

| 類別 | 結果／上下文 |
| --- | --- |
| 姓名型資料 | DECISION RESOLVED：使用者批准 Runtime／Demo 預設改為「測試冒險者」；作者署名另行決定 |
| 私人 email／電話 | 未發現實際私人信箱或電話；信箱 literal 是 example.com／example.invalid fixtures，live runner 是隨機 runId 的 example.com 模板 |
| 正式會員 ID／資料匯出 | 未發現正式會員 row export；固定 UUID 出現在合成 tests，JSON fixtures 是 schema／ACL／function metadata，不是 user table rows |
| 本機 username／絕對路徑 | 未發現個人的 Windows home path；vendor 掃描命中為 API `/admin/users/` 字串，不是本機 home directory |
| Credentials | 未發現真實 service-role credential、DB password、access／refresh token、私鑰或非 anon JWT constant |
| Test literals | token／password 欄位的短字串由 offline fixtures 使用；其他敏感格式為 scanner 正向測試動態建構，不能當作有效登入憑證 |
| Authorization | Runtime 從 session／環境取得的 header 與 server role 名稱是程式邏輯，不等於已嵌入秘密 |
| Browser config | Supabase project URL、publishable key 是刻意公開的 browser config；未把它們當 service-role secret |
| Images | 九張 RPG 圖目視未見 email、帳號頁或私人任務；內嵌 caBX 有生成聲明／asset identifiers，不能將其當會員 ID 或 bearer credential |
| Logs / env | 沒有 log 或真實 .env candidate；不把 ignored logs 的內容重新複製進文件 |

六支 live runners 仍是可公開工程 source 的 REVIEW 項目：它們使用 CSPRNG password、session in memory、safe output 與 exact-ID cleanup metadata。**不要直接執行**；它們可能對指定 Cloud project 建立帳號／交易。手動授權、account targeting 與最後 Auth admin deletion 必須獨立安排，單靠 sign-out 不等於已刪除 Auth user。本輪沒有任何 live 執行或新增臨時 credential。

## 3. Demo identity — DECISION RESOLVED

STEP 5 記錄的原 Demo 預設值「林宣伯」已依 STEP 5.1 授權改為「測試冒險者」。以下 runtime／測試位置均已更新；此處原值僅保留為歷史決策紀錄，不代表作者署名。

| 公開候選 | 位置 | 角色 | 網站是否顯示 |
| --- | --- | --- | --- |
| [app.js](../app.js) | 59 | Guest/default character.name | 新 Guest 無既有存檔時可進入實際角色畫面 |
| [index.html](../index.html) | 249、930、1035 | 營地、角色紀錄、設定的初始 UI 值 | 靜態標記可見；render 後由目前角色 state 決定 |
| [backend-contract.test.js](../tests/backend-contract.test.js) | 55、69、73 | synthetic command payload fixtures | 只有 source／tests，不進 dist |
| [core.test.js](../tests/core.test.js) | 208 | 舊資料／migration fixture | 只有 source／tests |
| [guest-mode.test.js](../tests/guest-mode.test.js) | 37 | Guest persistence fixture | 只有 source／tests |
| [phase1-member-auth.test.js](../tests/phase1-member-auth.test.js) | 108、123、129、152 | Member response／payload fixture | 只有 source／tests |
| [phase2-member-profile.test.js](../tests/phase2-member-profile.test.js) | 57 | profile fixture | 只有 source／tests |
| [Attribution Inventory](ATTRIBUTION_INVENTORY.md)、本文件 | Privacy 說明 | 對原值的 audit 引用 | 文件公開可見，但不進 dist |

`renderAll()` 依 `state.character.name` 更新角色名；新 Guest 使用中性 default，Member 仍套用自己的 Cloud 名稱。既有 Guest save 與 Member DB 不會被自動改名。STEP 5.1 未登入網站、未部署，不能把本機 source 更新稱為線上已更新。

**已採用 B：測試冒險者。** 只修改 app.js／index.html 的預設身份與五個直接相關測試檔案，另更新決策文件。`dist/` 仍保留先前 release 的舊 default；未來若要發布中性名稱版本，需另行授權重建、驗證與部署。本輪不修改使用者存檔，也不靠重建 dist 執行測試。

## 4. Excluded / candidate simulation

| 項目 | 本機現況 | Public candidate |
| --- | --- | --- |
| `/image.png` | 原 Habitica 帳號截圖仍保留 | 精確 ignore，0 |
| `node_modules/` | 1,332 files | 0 |
| `.npm-cache/` | 90 files，含 npm logs | 0 |
| `dist/` | 29 files，未重建 | 0 |
| `supabase.exe` | node_modules 下約 121.08 MiB | 0；不使用 Git LFS |
| `.env`／`.env.*` | 目前沒有真實 env candidate | 規則排除；只有 `.env.example` 例外，未來新增仍須內容 scan |
| logs／temp／tmp／cache／coverage | 忽略規則已存在 | 現有候選 0 |
| Supabase CLI metadata | `.temp/`、`.branches/` 精確排除 | 現有候選 0；不排除 migrations/functions |

最大公開候選為勳章 atlas，3,231,299 bytes（約 3.08 MiB）；沒有 >100 MB candidate。Source／tests／helpers／fixtures／SQL／migrations／Edge／release scripts／vendor／assets／package／Markdown 均保留。

- **TRACKED CANDIDATES（模擬）**：140 files，並非已 git add。
- **IGNORED**：1,452 files，沒有刪除。
- **SENSITIVE EXCLUDED**：Habitica screenshot；local dependencies／logs 不再散布。
- **USER DECISION REQUIRED**：Project License、素材再利用範圍、AI-assisted development disclosure、Author。Demo 姓名與九張圖片來源已解決。REVIEW 狀態本身不會使檔案自動被 ignore。

## 5. Recommended screenshots — 需要使用者實際拍攝

目前沒有正式 screenshot 檔。以下只是規劃，沒有建立目錄、PNG 或空白 placeholder，也沒有把 RPG 原圖冒充產品 screenshot。

| 建議檔名 | 實際畫面／入口 | 展示重點 | 拍攝條件 |
| --- | --- | --- | --- |
| `docs/screenshots/home.png` | 初始 Landing／登入、註冊、訪客入口 | 產品辨識與容易開始 | 使用尚未輸入帳密的入口畫面 |
| `docs/screenshots/camp.png` | 冒險者營地 | HP／EXP、資源、主線與今日冒險 | 已批准 Demo 名稱；只有非敏感展示任務 |
| `docs/screenshots/monster.png` | 習慣魔獸／魔獸挑戰 | 行為觸發與挑戰進度、RPG 視覺 | 真實 UI 有效狀態；觸發文字完整，不露私人行為內容 |
| `docs/screenshots/inventory.png` | 公會地圖 → 公會補給站 | 非空背包、裝備與消耗品 | 由正常 Demo 操作產生展示資料，不改 DOM 假造餘額或成交紀錄 |

建議先維持同一 Desktop viewport（例如 1280px，100% zoom）；若四張中要展示 Mobile RWD，可把 monster 改為 390px 實機截圖，不額外堆疊大量圖片。Statistics 可由使用者選擇替換第四張，不增加到五張。截取 application content，排除瀏覽器個人頭像、書籤與其他分頁。

### Screenshot privacy gate

每張公開前逐項確認：沒有私人 email、真實會員 ID、password、access／refresh token、DevTools、Supabase／Netlify 管理頁、repositoryVersion、私人任務／交易備註；Demo 名稱已批准，素材展示權已確認。

可以由使用者在隔離的瀏覽器環境準備 Guest 展示資料，避免使用私人存檔；需要 Member 畫面時，另行安排專用 Demo account／非敏感資料。**本輪不建立帳號、不登入人工會員、不改 Guest save，也不提供共用 credential。** 不要藉拍照測試改動既有人工會員資源。

帳密應在拍攝前避免入鏡，而非依賴模糊處理；拍完再檢查完整解析度與 metadata。不要把含私人收據／生成對話的來源證明當作 screenshot。所有 screenshot 必須對應真實 UI，不用生成圖片代替。

## 6. Third-party / assets

Library 版本、原文通知與外部字型證據見 [Third-party Notices](THIRD_PARTY_NOTICES.md)。已補 Supabase MIT 及已辨識依賴通知；Chart.js／Lucide 原文未修改。Netlify dist 不含新增文件，distribution notices 仍須後續授權核對。

九張圖片來源見 [Attribution Inventory](ATTRIBUTION_INVENTORY.md)：全部為 **USER-CONFIRMED CHATGPT-GENERATED ASSET**，由使用者為 LifeQuest 專案透過 ChatGPT 生成，作為專案視覺素材使用。不再列為來源未知，也不宣稱作者手繪或第三方 stock。Repository metadata 本身不足以獨立重建完整生成歷史；保留 user-confirmed provenance，不將它擴張成全面商用／再利用授權聲明。

## 7. README cross-check

[README](../README.md) 的正式 Demo URL 與使用者提供的 `https://eloquent-quejadas-ffaea3.netlify.app` 一致；本輪沒有重新登入該站驗收。

- 沒有聲稱素材全自製、Repo 是 MIT、提供 Demo password／私人 email 或敏感帳號。
- Guest／Member architecture 與 local-storage caveat 正確；Production Roadmap 未包裝成已完成。
- 548 完整歷史 baseline／541 唯讀集合／7 個會重建 dist 的 tests 未重跑，三者區別保留。
- Attribution 連結保留。STEP 5.1 僅修正 README 原有「圖片來源仍待確認」措辭，未增加逐張來源、Author、AI-assisted development 或長篇授權聲明。

## 8. Decisions not made on the author's behalf

### Project License — USER DECISION REQUIRED

沒有建立 LICENSE，也沒有把第三方 MIT 當作 LifeQuest MIT。Public GitHub 不會自動授予一般自由再利用權；GitHub 條款下的 view／fork 與開源 license 授權不同。參考 [GitHub 官方說明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)。這是發布準備說明，不替代具體法律意見。

### AI-assisted disclosure — USER DECISION REQUIRED

README 未加入此聲明。若作者確認符合實際工作分工，可採以下待批准文案：

> AI-assisted development was used for planning, implementation support, testing, and code review. Architecture decisions, integration, verification, and project scope were reviewed and validated by the author.

不使用「Built entirely by AI」，也不把圖片內嵌生成標記當作全部程式由 AI 開發的證據。

### Author identity — USER DECISION REQUIRED

可選真名、GitHub username，或不設 Author section；README 沒有 Author section 不會阻擋建立公開 Repo，但不影響第三方 copyright notices 的保留義務。沒有推測作者真實姓名／GitHub handle，沒有自行加入 README。

## 9. Decision summary

- **BLOCKER（阻止進入 Preflight 的已確認技術安全項）**：未發現真實 secret、未排除敏感截圖或 >100 MB candidate。
- **DECISION RESOLVED**：中性 Demo 預設名稱；九張圖片由使用者為 LifeQuest 透過 ChatGPT 生成的來源確認。
- **USER DECISION REQUIRED**：Project License／素材再利用範圍、AI-assisted development disclosure、Author。圖片來源確認不替代這些獨立決策。
- **NON-BLOCKING TODO（對 Preflight）**：由使用者拍攝 3–4 張真實 screenshot；需要時另行核對 dist notices／遠端字型版本／完整 bundle SBOM；細部 live runners 與歷史文件的公開展示程度可再決定。

可以進入 **STEP 5.2 — Portfolio Screenshots** 的準備；本輪沒有開始拍攝。之後 Public Release Preflight 仍需核對上述待決策事項，不能推論「可以無條件公開所有素材」。本文件沒有授權 Git Init／Add／Commit／Push／Deploy。
