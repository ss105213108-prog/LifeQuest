# Vendored browser libraries

These files are stored locally so LifeQuest does not depend on a runtime CDN connection.

- Chart.js `4.5.1`: `chart.js/chart.umd.min.js`
- Lucide `1.31.0`: `lucide/lucide.min.js`
- Supabase JavaScript client `2.112.3`: `supabase/supabase.js`

Status: CURRENT inventory, checked against the local repository on 2026-08-31. Versions for Chart.js and Lucide are present in their bundle banners and `index.html`. The Supabase bundle is byte-identical to the installed `@supabase/supabase-js` 2.112.3 UMD bundle; the package and lockfile pin that version.

- Chart.js: MIT; [license text](chart.js/LICENSE.md) is present.
- Lucide: ISC, with MIT notices for the Feather-derived icons listed in [LICENSE](lucide/LICENSE). Preserve both parts.
- Supabase: MIT is confirmed by the installed package metadata and license text. The full notice is now preserved in [Third-party Notices](../docs/THIRD_PARTY_NOTICES.md), together with identified runtime dependencies; no bundle was modified. The ignored `node_modules` copy is not the public notice source.
- Chart.js includes `@kurkle/color` 0.3.2 (MIT), identified by its embedded banner; its notice is preserved in the same document.

This inventory does not grant a license to LifeQuest itself or certify all bundled transitive notices. See [Attribution inventory](../docs/ATTRIBUTION_INVENTORY.md) for remaining verification and distribution work. The unchanged Netlify `dist/` does not include the new Markdown notices; its distribution review remains separate. Google Fonts are loaded separately from the network; their family-level OFL-1.1 sources are linked in Third-party Notices, but font binaries are not pinned here. The local JavaScript bundles do not make the entire site dependency-free/offline.

When a vendored bundle is intentionally upgraded in a later authorized change, update its versioned query string, preserve applicable license notices and re-verify it. No bundle is changed by this documentation pass.
