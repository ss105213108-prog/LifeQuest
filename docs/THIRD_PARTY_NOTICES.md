# LifeQuest — Third-party Notices

文件分類：CURRENT。核對日期：2026-08-31。適用於 Public GitHub source 的第三方清單與通知保存；**不是 LifeQuest 自身的 LICENSE**，也不授予 LifeQuest 圖片的通用再利用權。

## 1. 已確認的 Browser / Edge 依賴

| Package | Version | License | Repository evidence / notice |
| --- | --- | --- | --- |
| Chart.js | 4.5.1 | MIT | [bundle](../vendor/chart.js/chart.umd.min.js)、[完整既有 license](../vendor/chart.js/LICENSE.md) |
| @kurkle/color（Chart.js 內嵌） | 0.3.2 | MIT | Chart.js bundle 的第二個 license banner；下方保留通知 |
| Lucide | 1.31.0 | ISC + Feather-derived MIT notices | [bundle](../vendor/lucide/lucide.min.js)、[完整既有 LICENSE](../vendor/lucide/LICENSE)，兩段及圖示清單都需保留 |
| @supabase/supabase-js | 2.112.3 | MIT | [package/lockfile](../package-lock.json)、[vendored UMD](../vendor/supabase/supabase.js)、下方完整 MIT |
| @supabase/auth-js、functions-js、postgrest-js、realtime-js、storage-js | 各 2.112.3 | MIT | lockfile 與已安裝套件 LICENSE；均為下方 Copyright (c) 2020 Supabase 文字 |
| @supabase/phoenix | 0.4.5 | MIT | lockfile、已安裝套件 LICENSE.md；下方完整 MIT |
| iceberg-js | 0.8.1 | MIT | lockfile、已安裝套件 LICENSE；下方完整 MIT |
| tslib | 2.8.1 | 0BSD | lockfile、已安裝套件 LICENSE.txt／CopyrightNotice.txt；下方完整授權文字 |

Supabase vendored UMD 與已安裝 2.112.3 UMD byte-identical，SHA256：
`ec004176d101aec77aeef266aa1c94411287fe2039c65ea5f6c72f5e14b3847d`。
[Edge import map](../supabase/functions/lifequest-command/deno.json) 也固定為 2.112.3。本表記錄依賴，不把 lockfile 內所有 Node 依賴都宣稱成 Browser bundle 內容，也不等於完整 bundle SBOM。

Chart.js banner 為 2025，既有 LICENSE 為 2014–2024；[官方 v4.5.1 LICENSE](https://raw.githubusercontent.com/chartjs/Chart.js/v4.5.1/LICENSE.md) 亦為 2014–2024。兩者均照上游保存，不能自行統一年份。Lucide 的 ISC 與 Feather MIT 不是二擇一，既有文件中的指定圖示清單／copyright 都保留。

## 2. Development-only dependencies

[package-lock.json](../package-lock.json) 記錄：Supabase CLI 2.115.0（含八種 optional platform packages）、@ecies/ciphers 0.2.6、@noble/ciphers 1.3.0、@noble/curves 1.9.7、@noble/hashes 1.8.0、eciesjs 0.5.0、jose 6.2.10，license metadata 均為 MIT。

這些 installed packages／CLI binaries 被 `node_modules/` ignore，本輪不複製 executable 或聲稱所有 CLI transitive licenses 已完整稽核。CLI npm wrapper 的本機套件未附獨立 LICENSE；本項是 metadata-level confirmation，未來若重新散布 binary，需要核對該 distribution 的完整 notices。它不是目前 Public GitHub source 的 >100 MB artifact。

## 3. External fonts

[index.html](../index.html) 外部載入 Google Fonts 的 Noto Serif TC 與 Outfit；repository 不散布字型檔，亦未 pin 遠端字型 binary 版本。

| Family | 官方 family license | Copyright evidence |
| --- | --- | --- |
| Noto Serif TC | [SIL Open Font License 1.1](https://raw.githubusercontent.com/google/fonts/main/ofl/notoseriftc/OFL.txt) | Copyright 2012 Google Inc. All Rights Reserved. |
| Outfit | [SIL Open Font License 1.1](https://raw.githubusercontent.com/google/fonts/main/ofl/outfit/OFL.txt) | Copyright 2021 The Outfit Project Authors |

這次補上官方 family-level 證據，不再單純標示「字型 license 完全未知」；但未認證特定遠端 binary hash。若未來改為 self-host，應保留該取得版本的完整 OFL／copyright／reserved-name 條件。此通知不是替所有圖片或 LifeQuest 程式套用 OFL。

## 4. Distribution boundary

本文件補齊 Public GitHub 的 Supabase 主套件、已辨識 transitive modules 與 @kurkle/color 通知。Chart.js／Lucide 完整原文已在 vendor 內，透過上方連結保留，不修改原文。

**Netlify dist 是另一份 distribution。** 現行 29 檔 allowlist 不包含本文件或 standalone license 文件；本輪未重建 dist，也不認定只保留 JS banner 就已滿足所有通知要求。Netlify artifact 的完整 notices 仍為 **LICENSE VERIFICATION REQUIRED / separately authorized release work**，不能因 GitHub notices 補齊就宣稱已同步解決。

## 5. Preserved license texts

以下由已安裝套件原文保存；同一 Supabase 2020 文字適用於第 1 節列出的六個 @supabase 主／子套件。被 ignore 的 node_modules 不需提交，公開候選中的本文件保留其通知。

### Supabase JS family — MIT

```text
MIT License

Copyright (c) 2020 Supabase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### @supabase/phoenix — MIT

```text
# MIT License

Copyright (c) 2014 Chris McCord

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### iceberg-js — MIT

```text
MIT License

Copyright (c) 2025 Supabase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### tslib — 0BSD

```text
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### @kurkle/color 0.3.2 — MIT

本機內嵌 banner：`(c) 2023 Jukka Kurkela`；[官方 v0.3.2 LICENSE](https://raw.githubusercontent.com/kurkle/color/v0.3.2/LICENSE.md) 記錄 2018–2021，兩者分別保留，不改原 bundle。

```text
The MIT License (MIT)

Copyright (c) 2018-2021 Jukka Kurkela

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## 6. Remaining decisions

LifeQuest project license、作者署名與 AI-assisted development disclosure 仍需擁有者決定。STEP 5.1 已確認中性 Demo 姓名「測試冒險者」，以及九張圖片由使用者為 LifeQuest 透過 ChatGPT 生成的來源，詳見 [Attribution Inventory](ATTRIBUTION_INVENTORY.md)。這是 user-confirmed provenance；第三方 license／notice 不會自動授權使用 LifeQuest 的所有內容。
