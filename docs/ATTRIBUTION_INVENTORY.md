# LifeQuest — Attribution / License / Demo Identity Inventory

文件分類：CURRENT inventory。核對日期：2026-08-31。區分本機檔案證據與使用者確認的來源聲明；不是法律意見、權利保證，也不替擁有者選擇 repository license。

STEP 5 更新：本機證據與官方 license 文件分別標示；新增 [Third-party Notices](THIRD_PARTY_NOTICES.md) 與 [Privacy / Screenshot Review](PORTFOLIO_PUBLICATION_REVIEW.md)。沒有修改 Runtime、tests、圖片、dist 或 Git 設定。

STEP 5.1 決策更新：使用者正式批准 Runtime Demo Name 改為「測試冒險者」，並確認下列 9 張 PNG 均為其先前為 LifeQuest 專案透過 ChatGPT 生成的視覺素材。Demo identity 為 **DECISION RESOLVED**；圖片來源標為 **USER-CONFIRMED CHATGPT-GENERATED ASSET**。本次只更動預設姓名、相關測試及文件，圖片檔案與 dist 未變。

## 1. Third-party libraries

| 內容 | 已確認版本 | License 證據／目前狀態 |
| --- | --- | --- |
| Chart.js | 4.5.1；bundle banner 與 index.html 一致 | MIT；公開候選已有 vendor/chart.js/LICENSE.md，bundle 保留 MIT banner |
| Lucide | 1.31.0；bundle banner 與 index.html 一致 | ISC；vendor/lucide/LICENSE 另含指定 Feather-derived icons 的 MIT notices，兩段都要保留 |
| Supabase JS client | 2.112.3；package／lockfile／index.html／Edge import map 一致 | MIT；已將 installed package 的完整 LICENSE 保存到 docs/THIRD_PARTY_NOTICES.md，不再依賴 ignored node_modules |
| Supabase CLI（開發工具） | 2.115.0；package／lockfile 一致 | 本機 package metadata 為 MIT；node_modules 與 CLI executable 已 ignore，不是 vendored browser artifact |
| @kurkle/color | 0.3.2；Chart.js 內嵌 banner | MIT；本輪新增辨識，完整通知保存到 Third-party Notices |
| Supabase JS transitive packages | auth/functions/postgrest/realtime/storage 各 2.112.3；phoenix 0.4.5；iceberg-js 0.8.1；tslib 2.8.1 | lockfile 與 installed licenses：前述各項 MIT，tslib 0BSD；完整文字／適用範圍見 Third-party Notices |
| Noto Serif TC / Outfit | index.html 的 Google Fonts family 可確認；未 pin 字型版本 | 官方 Google Fonts family 的 OFL-1.1 已查證；未驗證遠端特定 binary hash，未來 self-host 時另保存取得版本的完整 license |

證據入口：[index.html](../index.html)、[package.json](../package.json)、[package-lock.json](../package-lock.json)、[vendor inventory](../vendor/README.md)、[Chart.js license](../vendor/chart.js/LICENSE.md)、[Lucide license](../vendor/lucide/LICENSE)。

Supabase 的 vendor/supabase/supabase.js 與本機 node_modules/@supabase/supabase-js/dist/umd/supabase.js SHA256 相同：`ec004176d101aec77aeef266aa1c94411287fe2039c65ea5f6c72f5e14b3847d`。被 ignore 的 node_modules/LICENSE 不會自動成為 Public GitHub／Netlify 的 notice，因此本輪只為 GitHub source 補齊可證實的純文件通知。

### 未完成的 notice / distribution 核對

- Supabase source distribution 的完整 MIT 已保存於 [Third-party Notices](THIRD_PARTY_NOTICES.md)，不必為了補 notice 改 browser bundle；本輪仍未修改 vendor 原始 license。
- Chart.js bundle banner 記錄 2025，旁邊 license 記錄 2014–2024；本輪確認 [官方 v4.5.1 LICENSE](https://raw.githubusercontent.com/chartjs/Chart.js/v4.5.1/LICENSE.md) 也為 2014–2024。兩者照原文保存，不自行改 copyright 年份。
- 目前 dist allowlist 不含 standalone 第三方 license 檔。部分 JS 有 banner，但本輪不認定它已滿足所有通知要求：LICENSE VERIFICATION REQUIRED（distribution / bundled notices）。修正 release allowlist 或重建 dist 需另一輪明確授權。
- 本輪已列出 lockfile runtime／development dependencies 及 Chart.js 內嵌 color，但不冒充完整 bundle SBOM、所有平台 CLI binary 的通知審計或法律認證。
- Root LICENSE 未存在，package.json 未選定 LifeQuest 自身 license。USER DECISION REQUIRED；不能因套件使用 MIT 就宣稱本專案已 MIT licensed。

## 2. Image / Asset Inventory

目前 assets/ 共有 9 張 PNG，皆被現行 release allowlist 使用。STEP 5 逐張目視檢查未見帳號／私人任務截圖內容；STEP 5.1 使用者已確認它們是為 LifeQuest 專案透過 ChatGPT 生成、作為 LifeQuest 視覺素材使用的圖片，不是作者手繪作品，也不標成第三方 stock。

**更正 STEP 3 的證據範圍：** 雖未發現 tEXt／zTXt／iTXt／eXIf，9 張圖都有 `caBX` chunk；可讀到 `c2pa.actions.v2`、`c2pa.created`、`gpt-image`、`OpenAI Media Service API` 與 `trainedAlgorithmicMedia` 標記。因此有「內嵌生成聲明線索」，不可再說完全沒有 provenance metadata。

STEP 5 的 chunk／標記檢查沒有執行完整 C2PA signature、certificate trust、content binding 驗證；依 [C2PA specification](https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html)，manifest 的讀取與 cryptographic validation 必須分開。現在分類依據新增了 STEP 5.1 的使用者正式來源確認，不再採 UNKNOWN。Repository metadata 本身仍不足以獨立重建完整生成歷史，因此明確保留 **user-confirmed provenance**，不改稱獨立驗證過的簽章／完整權利認證。

| 檔案 | 現行用途 | 分類 | Metadata 線索 | GitHub / Screenshot / Commercial 決策 |
| --- | --- | --- | --- | --- |
| assets/auth-guild-night.png | 入口背景 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/guild-adventurer.png | 冒險者插畫 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/guild-quartermaster.png | 補給站角色插畫 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/guild-medals-atlas.png | 勳章 atlas | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/boss-budget-vampire.png | Boss 插畫 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/boss-fried-food-beast.png | Boss 插畫 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/boss-laziness-beast.png | Boss 插畫 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/boss-sleep-nightmare.png | Boss 插畫 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |
| assets/art/boss-sugar-monster.png | Boss 插畫 | USER-CONFIRMED CHATGPT-GENERATED ASSET | caBX，生成聲明標記 | R1 / R2 / R3 |

現行統計：USER-CONFIRMED CHATGPT-GENERATED ASSET = 9，來源 UNKNOWN = 0。STEP 5 當時的 UNKNOWN 是確認前的稽核狀態，已由使用者來源聲明更新；不是靠畫風猜測，也不是將原圖誤標為作者手繪或全部採 MIT。

- **R1 — Public GitHub：** 「來源完全未知」的待確認項已解除，記錄為使用者為本專案生成；不因此宣稱所有 Repo 內容授權相同，或第三人可無條件再利用這些圖片。Project License／素材再利用條件仍須與 provenance 分開。
- **R2 — Portfolio Screenshot：** 可依已確認的 LifeQuest 素材來源進入 Screenshot 準備；仍需逐張檢查 Demo 姓名、私人帳密與任務內容，不建立假圖、不把既有圖片冒充完整 UI screenshot。
- **R3 — Commercial Production：** 不列入已核准商用素材；需更明確的商用、再散布與必要 reference/input 權利確認。Portfolio Demo 風險接受不自動等於 Commercial clearance。
- **證據保存：** 使用者來源確認已足以完成本次 Portfolio provenance 記錄；如未來需要獨立重建生成歷史或評估更廣的再利用條件，可另保存原始生成紀錄及適用條款，不將這個後續需求重新誤列為來源 UNKNOWN。

原始生成紀錄可私下保存，不把含帳號資訊的收據或完整對話直接放 GitHub。本次沒有刪圖、修改圖像或剝除 caBX。圖片 provenance 不代表全專案的 AI-assisted development disclosure；後者仍由使用者獨立決定。

根目錄 image.png 是另一個 Habitica 帳號參考截圖，不是上述 assets；已由精確 /image.png 規則排除，不能當作 LifeQuest Screenshot 或把截圖重新嵌進公開文件。

## 3. Demo Identity / Privacy

| 實際值／形式 | Public source 位置與角色 | 判定 |
| --- | --- | --- |
| 測試冒險者 | app.js:59 Guest/default character name；index.html:249、930、1035 初始顯示／設定值 | DECISION RESOLVED：使用者於 STEP 5.1 正式批准的中性 Demo 名稱 |
| 測試冒險者 | tests/backend-contract.test.js、core.test.js、guest-mode.test.js、phase1-member-auth.test.js、phase2-member-profile.test.js | 合成 Demo fixture 同步更新；不改測試的 command、Auth、存檔或業務語義 |
| 雲端冒險者／隔離測試員／經濟測試員／Phase三冒險者／測試員／新名稱 | Member／UI／contract tests 的合成顯示值 | 可由 fixture 建構位置確認用途；不是正式會員資料匯出 |
| TabA、TabB、DelayedA、NewerB、RaceA、RaceB、SharedIntent、Reloaded、MustNotSend、Changed、A | Session／multi-tab／profile tests 的合成值 | 測試 labels，不是取得的真實帳號名稱 |
| P6C2AOne、P6C2ATwo、P6C2Lost、P6C2Reuse、P6C2LateA、P5C、CrossWriteDenied | Live runner 寫入其測試 fixture 的顯示值 | 只有授權執行時才產生／操作測試資料，本輪未執行 |
| Test 加隨機字串、Phase／runId／label 派生測試名稱 | 六支 live-verification runners | 測試識別用 metadata，不是 credential；不將實際 execution output 當 README 素材 |
| member@example.com、lifequest-test-a@example.com、b@example.com；fixture／synthetic／missing／member 等 @example.invalid | Auth／transport／merge tests | 範例測試信箱，非由 Cloud 匯出之私人 email |
| lifequest-phase{階段}-{label}-{runId}@example.com | Live runner 模板 | 動態 temporary account email；密碼使用隨機值，不應公開 execution credential |
| user-a／user-b 等 labels、固定測試 UUID | 測試／攻擊 harness 的 identity 模擬 | 不可把測試 ID 宣稱為真人；未發現 candidate 內的正式會員列匯出 |

其他怪獸、道具、能力名稱是遊戲 definitions，不是使用者姓名。Supabase project URL／publishable key 是 browser-safe config，不是個人帳號密碼。

STEP 5.1 已按用途修改 Runtime／HTML Demo default 與合成 fixtures，沒有對作者署名或歷史文本做 global replace。既有 Guest 存檔／Member DB 不被重新命名；作者身份與 Demo Identity 是不同決策。dist 未重建，因此舊 artifact 仍含舊預設值，不能當成此次姓名清理後的新發布版本。

## 4. Public documentation decisions

- 作者顯示真名／GitHub username：USER DECISION REQUIRED。
- Runtime Demo Name：測試冒險者，DECISION RESOLVED。
- LifeQuest repository license、AI-assisted disclosure、Screenshot 確認與 live 工具公開程度：USER DECISION REQUIRED。README 採擁有者提供的正式 Demo URL、Guest 或自行註冊體驗，不提供共用帳密；沒有替使用者建立專用 Demo account。
- 9 張圖片 provenance 已由使用者確認；Project License／更廣的素材再利用條件與 Netlify distribution notices 仍分開處理。字型 family license 已由官方 OFL 文件補證；本清單不是全面權利保證，詳見 [STEP 5 Review / 5.1 Update](PORTFOLIO_PUBLICATION_REVIEW.md)。

技術驗收、secret findings = 0 與 Public Repo 的個資／授權準備是分開的檢查，不能互相取代。
