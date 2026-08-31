# LifeQuest Portfolio Demo Release Requirements

Status: CURRENT release instructions, reviewed against local source on 2026-08-31. Prior Portfolio V1 acceptance and Netlify manual verification were confirmed by the project owner; this documentation pass does not re-run live verification or establish current hosting/Advisor status. Evidence wording is recorded in [README preparation](docs/README_PREPARATION.md).

## Publish workflow

Run `npm run release`. Publish only the generated `dist/` directory. Never publish the project root.

Here, "publish" means serving the website, not publishing GitHub source. The GitHub source repository should retain application code, tests, migrations, Edge functions, release tooling and reviewed documentation. `.gitignore` excludes generated `dist/`, dependencies, cache, environment files and the private root reference screenshot. `dist/` remains a local Netlify artifact.

`npm run check` performs syntax checks; `npm test` runs the automated suite. The seven tests in `tests/phase6c3-release-readiness.test.js` rebuild `dist/` through a `before` hook, so the full suite is not a read-only operation. Do not run it during a no-rebuild review. `npm run release:verify` validates the existing output without rebuilding it.

The release builder uses an explicit file allowlist. Tests, Supabase functions and migrations, SQL verification, internal Markdown, development tooling, package metadata, environment files, logs and `node_modules` are not copied.

## Provider-neutral hosting requirements

- HTTPS is required. Redirect HTTP to HTTPS.
- Apply every header exported by `scripts/release-files.cjs` as `HOSTING_HEADERS`.
- The current Vanilla UI uses inline event handlers, so the compatibility CSP temporarily permits inline scripts and styles. Removing that allowance belongs to Final UX / Release Cleanup and requires migrating inline handlers without changing gameplay.
- Serve `index.html` with `Cache-Control: no-cache, max-age=0, must-revalidate`.
- Serve unhashed JavaScript and CSS with `Cache-Control: no-cache, must-revalidate`; do not use `immutable`.
- Static images may use `Cache-Control: public, max-age=86400`.
- Configure SPA fallback to `index.html` only for browser navigation requests, not missing JS/CSS/assets.

These are hosting requirements, not proof that any future provider has applied them. Verify live response headers after choosing a provider.

## Netlify clean-dist setup

- The checked-in `_headers` is a release source file, copied through the allowlist into `dist/_headers`. The builder rejects it if it differs from `HOSTING_HEADERS` / `CACHE_POLICY`; verification checks source and output again. Do not edit only the dist copy.
- Manual Netlify deployment needs only `dist/`; no `netlify.toml` is required for this workflow. See [Netlify custom headers](https://docs.netlify.com/manage/routing/headers/).
- Security headers apply globally. Cache rules use exact public paths, including `/`, `/index.html` and vendor scripts, so overlapping rules do not combine conflicting Cache-Control values. Query strings do not introduce immutable caching.
- The compatibility CSP retains `unsafe-inline` for existing scripts, event handlers and styles, permits Google Fonts and only the LifeQuest Supabase host for connections, and does not permit `unsafe-eval`. It blocks framing and object embeds. It is not a strict nonce/hash CSP and does not eliminate inline-script XSS risk; removing inline allowances is future work, not part of this setup.
- Local header-preview tests validate compatibility, not Netlify's live configuration. The owner confirmed HTTPS, security/cache headers and CSP runtime smoke at Final Release Setup acceptance. That historical acceptance is not a fresh online verification by this documentation pass; future deployments still require verification.

After deployment, inspect actual HTTPS responses for `/`, `/index.html`, JavaScript (including vendor scripts and a query-string URL), CSS and an image. Confirm security headers, a single expected Cache-Control value and correct Content-Type. Check that the browser console has no CSP violations, Login/Register controls work, and Member Cloud reload still works. Verify framing is denied. Netlify custom headers here apply to static files, not Supabase responses or proxied functions.

## Manual acceptance checklist for future deployments

The owner confirmed the Portfolio V1 manual acceptance, including offline recovery. The scenarios below remain useful for future deployment checks; their presence here does not mean that acceptance is still pending. A public shared demo account has not been approved by this document.

1. Load the public homepage in a clean browser profile.
2. Enter Guest mode, perform one harmless action, leave Guest mode, then re-enter and confirm the save persists.
3. Open Register and Login, then sign in with an explicitly authorized verification account; do not use an existing person's account without permission.
4. Reload the Member session and confirm authoritative Cloud state restores.
5. Smoke-test one Daily Draft and one Habit operation without changing game balance.
6. Smoke-test one basic Economy read/transaction using designated demo data.
7. Logout and switch accounts; confirm no prior-member state appears.
8. Simulate a network failure and verify the safe retry/error presentation.
9. Re-check Guest/Member separation after Member logout.

## Known limitations and Production roadmap

- Daily correction: the accepted Portfolio V1 workaround remains edit, save the draft, then submit. Do not present direct edit-and-submit as universally supported.
- Member/Guest rule discrepancy: Member cactus uses Gold +1; Guest may retain the earlier +2 rule. It was intentionally not changed during repository cleanup.
- CSP migration away from inline event handlers/styles remains future hardening, not a strict CSP claim.
- Leaked Password Protection and broader production Auth/release hardening remain roadmap items, not completed features. Confirm Email/recovery/SMTP/OAuth/MFA are not claimed as Portfolio deliverables.
- Platform-managed `supabase_admin` future-default privileges must not be described as fixed merely because the Portfolio phase was accepted; preserve the distinction between mitigation/risk acceptance and platform remediation.
- The offline Member reload preservation fix, Member dossier flow, Mobile RWD and monster-challenge follow-up were accepted by the owner. Do not list those completed fixes as current blockers. Further wording/loading/visual polish is optional future work, not an active scope expansion.

Third-party notices, asset provenance and repository-license decisions are tracked separately in [Attribution inventory](docs/ATTRIBUTION_INVENTORY.md). A clean technical artifact or passing secret scan does not by itself establish asset rights or complete third-party notice coverage. This document does not authorize modifying `dist/` to resolve those items.
