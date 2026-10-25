# Branch Review OS

Internal web app that replaces an Excel-based 10-day review for a real-estate sales branch (plotted land, India).
The owner is **not a developer**: explain in plain English, and for anything outside the code (Supabase, hosting, GitHub)
give exact click-by-click steps. Setup instructions live in `docs/SETUP.md`.

@AGENTS.md

## Design principles (follow these in every session)

1. Lead-centric, not sheet-centric. A customer is ONE lead; every meeting/follow-up is an append-only interaction. Review periods are date filters, never containers.
2. Preserve history. Each interaction stores rating_before and rating_after; owner corrections are allowed through the audited associate RPC, with original values retained in audit_log. Rating changes remain chronologically consistent.
3. ONE metric dictionary. All KPIs are computed in SQL views/functions in one place, documented in docs/metrics.md. Definitions: Meetings = customer interactions of type meeting in the period; Bookings = status in (booking_done, agreement_signed); Tokens reported separately; Cancelled excluded from bookings but always reported; Booking Value = sum over non-cancelled booking_done + agreement_signed; Hot % = hot leads / total leads met.
4. Associate data entry must take under 30 seconds. Admin analysis must be unlimited.
5. Zero-cost stack. No paid services.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind 4 + shadcn/ui (base-nova style) · Supabase (Postgres + Auth + RLS) · recharts.
Host-agnostic: deployable to Netlify (recommended: its free plan allows commercial use) or Vercel (Hobby plan is non-commercial only).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run locally at http://localhost:3000 (needs `.env.local`) |
| `npm run test:db` | **Row Level Security + trigger + metric tests** (in-memory Postgres, no Docker, no internet). Must pass before any migration change ships |
| `npm run typecheck` / `npm run lint` / `npm run build` | Code checks |
| `npm run seed` | Branch, projects, cold reasons, next-action types, review cycle, one demo user per role. Idempotent. `-- --no-demo` / `-- --remove-demo` |
| `npm run db:bundle` | Rebuild `supabase/all_migrations.sql` (the paste-into-SQL-Editor file) after changing a migration |
| `npm run load:history` / `npm run verify:history` | Load the flat workbook after seed-users; verify all 80 per-associate + total checks against reconciliation |
| `npm run test:review` | Master-layout/phone-omission checks and actual isolated CSV recovery execution |
| `npm run seed:demo` | Fictional presentation data in a separate, explicitly configured empty demo project only |
| `npm run test:associate` / `npm run test:ui` | Parser/queue tests and phone Chrome tests against an isolated production build + local database |
| `npm run test:history` | Actual workbook integration test in isolated PostgreSQL: idempotency, sheet caches, trigger rollback, quality actions + RLS |
| `npm run seed:users` | Creates the real logins from the `users` sheet of `data/Axon_NCR_Review_Database_Import.xlsx`. Idempotent, `-- --dry-run` previews. Never prints passwords |
| `npm run export:csv` | Dump every table to CSV (the nightly GitHub Action runs this) |

## Database (supabase/migrations, applied in filename order)

1. `…01_core_tables.sql` — enums, tables, indexes.
2. `…02_triggers.sql` — derived state, append-only guards, audit.
3. `…03_rls.sql` — helper functions + all Row Level Security policies + grants.
4. `…04_metrics.sql` — the metric dictionary as SQL functions (`associate_metrics`, `team_metrics`, `current_review_period`).
5. `…05_legacy_key_and_login_limits.sql` — `profiles.legacy_key` (= `user_key` from the Excel import, unique; used by Prompt 2 to attach each Excel tab to a profile) and `login_attempts` (server-only table for rate limiting).

6. `…06_history.sql` — flat import columns, CP firms, historical flags, quality inbox + correction RPC, transactional service-only loader, reconciliation metrics, and dashboard history toggle.
7. `…07_associate.sql` — atomic owner-only entry, idempotent receipts and offline cancellation markers, scoped audited history corrections, Undo, site/nurture/contact fields, Hot targets, scorecard, plot warnings and missing config choices. **Applied live.**
8. `…08_analysis.sql` — SQL analysis dictionary/RPCs, security-invoker fact view, saved-view RLS and analysis indexes. **Present live, confirmed read-only on 25 October 2026; not applied by this task.**
9. `…09_review.sql` — frozen per-associate review snapshots, published/completed/carried commitments, configurable rules, dated-entry locks, settings/targets/branches, audited correction/restore, reassignment, Master/rollup SQL and demo flag. **Local, unapplied.**
10. `…10_privacy.sql` — protected customer phone/source/receipt columns, owner/admin record RPC, explicit analysis scope under finalisation, database password-setup gate and contact/ownership guards. **Local, unapplied.**

Only migrations 9 → 10 remain pending and require owner approval. Migrations 1–8 remain unchanged. The owner authorised pushing the matching code to GitHub for the existing Vercel connection on 25 October 2026.

Tables (all have `id uuid`, `created_by`, `created_at`, `updated_at`, `deleted_at` = soft delete):

- **branches**, **profiles** (1:1 with `auth.users`; `role` = associate | team_lead | branch_admin | super_admin; `reports_to`; `active`; `must_change_password`)
- **projects** (company-wide), **cold_reasons**, **next_action_types**, **review_cycle** (per branch; `end_day` NULL = month end) — config
- **channel_partners** — a *branch-wide directory* (name, firm, phone, `current_rating`, `normalized_key` dedupe key, unique per branch)
- **leads** — one row per customer. `current_rating`, `next_action`, `next_action_date`, `cold_reason`, `plot_names`, `last_touch_at` are a **cache maintained by trigger** from the newest interaction. Never write them from the app.
- **interactions** — append-only meetings/follow-ups: `interaction_type` (meeting | follow_up), `occurred_on`, `mode`, `rating_before` (trigger-filled; NULL = first contact), `rating_after`, `remark` (+ full-text `remark_tsv`), next action, plot names, cold reason
- **cp_interactions** — same idea for channel partners (`cp_rating`: active | hot | warm | cold)
- **bookings** + **booking_status_history** — status token | booking_done | agreement_signed | cancelled; every status change is logged by trigger
- **targets** (associate × month), **review_sessions**, **review_actions**, **audit_log** (trigger-written, immutable)

Enum values are snake_case in the DB (`in_person`, `booking_done`, `walk_in`); show friendly labels in the UI.

### Rules the database enforces (don't work around them)

- `interactions`, `cp_interactions`, `booking_status_history`, `audit_log` are **append-only**: no edits, no deletes. Fix mistakes by adding a new interaction, or soft-delete (`deleted_at`) — the lead then rolls back to the previous interaction automatically.
- Back-dated interactions never overwrite newer lead state (ordering is by `occurred_on`, then insertion time).
- `profiles.role / branch_id / reports_to / active / designation` cannot be changed from the browser; only server code using the service key does it.
- Soft-deleted rows are **not** hidden by RLS. Every query must add `.is("deleted_at", null)` (metric functions already do).
- Visibility: associate = own rows; team_lead = self + all reports (recursive via `reports_to`); branch_admin = whole branch; super_admin = everything. One function, `visible_associates()`, drives every policy.
- The CP directory is shared within a branch (so two associates don't create duplicate CPs); CP *meetings* stay private to the associate.

## Code conventions

- **Next.js 16 differs from older versions.** `proxy.ts` replaces `middleware.ts`; `cookies()`, `params`, `searchParams` are Promises; read `node_modules/next/dist/docs/` before using an API from memory. `cacheComponents` is switched off on purpose (every page here is per-user).
- **Security boundary = RLS + server checks, never `proxy.ts`.** `src/proxy.ts` only redirects signed-out visitors and refreshes the session. Pages call `requireProfile()` / `requireRole([...])` from `src/lib/auth.ts`; server actions re-check the role themselves.
- **Service-role key**: only in `src/lib/supabase/admin.ts` (`import "server-only"`), only in server actions/route handlers, and only after the caller's role was verified. Never `NEXT_PUBLIC_`, never in client components.
- Supabase clients: `lib/supabase/client.ts` (browser), `server.ts` (acts as the signed-in user, RLS applies), `admin.ts` (bypasses RLS).
- Routes: `(app)` group = signed-in shell; `/login`, `/change-password`, `/no-access` are outside it. Landing: associate → `/home`, everyone else → `/command`. `/admin/team` = branch_admin + super_admin.
- Forms use server actions + `useActionState`. Mobile first: at least 48px tap targets (`min-h-12`), bottom tab bar on phones, `text-base` inputs (stops iOS zoom).
- Fonts: Inter (Latin) + Noto Sans Devanagari with system fallbacks, so Hindi remarks render everywhere. Store text as UTF-8; FTS uses the `simple` config (no English stemming) so Hindi words are searchable.
- Dashboard numbers: call the SQL functions, never recompute KPIs in TypeScript. If a definition must change: edit `docs/metrics.md` + a new migration + a test in `supabase/tests/rls.test.mjs`.
- Migrations are append-only once applied: add a new numbered file instead of editing an applied one. Migrations 1–8 are already live; 9–10 remain local and await approval. After any change run `npm run test:db && npm run db:bundle`.
- Comments explain *why*, in plain English. No new dependencies without a reason.

## Auth rules (all verified end-to-end against a real local Supabase)

- Email + password only; **public sign-ups must be OFF** in Supabase (Authentication → Sign In / Providers → User Signups). Users exist only because an admin created them (Admin > Team, or `npm run seed:users`).
- `must_change_password = true` on every new user. Enforced by restrictive operational-data policies in migration 10 and by the UI: `src/proxy.ts` redirects to `/change-password` (optimistic), and `requireProfile()` re-checks in every page. `signIn` redirects straight to `/change-password` or the role home in one hop (chained redirects leave the URL wrong).
- New password: 8+ chars; must not equal the email, email name, first name, full name, or `firstname123` (`src/app/change-password/actions.ts`).
- Login rate limit: 5 failures per email or 20 per IP in 15 minutes → blocked (`login_attempts` table, service key only). Fails closed if the rate-limit store is unavailable, with a friendly retry message. Supabase also applies its own Auth limits.
- Team creates random one-time passwords. Historical seed-user credentials came from earlier owner instructions and must be replaced privately before launch; never publish or print passwords. Public code must not contain actual credentials. New password setup is blocked from direct API bypass in migration 10.
- The Excel `users` sheet lists reports_to = "Ajay Kushwaha (Branch Head)" but has **no row for Ajay**; `reports_to` stays empty until he is added, then re-run `npm run seed:users` to link.

## Ops

- `.github/workflows/keepalive.yml` — pings `rpc/ping` every 3 days so the free Supabase project never pauses.
- `.github/workflows/nightly-export.yml` — nightly CSV export as a workflow artifact (14 days). **The job skips public repositories.** Use a separate private backup repository/vault; optional `EXPORT_PASSPHRASE` encrypts artifacts. Never publish customer CSVs. This local protection is not effective remotely until the code is pushed.
- `.github/workflows/ci.yml` — typecheck, lint, RLS tests, build on every push.

## Known data issues from the Excel template (matter for the import, Prompt 2)

See `docs/excel-findings.md`.

## Status

- [x] Prompt 1: foundation (schema, RLS + tests, auth, shell, seed, ops, setup guide)
- [x] Prompt 1b: real logins from the import workbook, forced password change gate, login rate limiting
- [x] Prompt 2 implementation: flat history loader, SQL verification, historical Today filtering, Explorer, actionable admin quality inbox (locally tested).
- [x] Live Prompt 2: loaded into jxduyylphokqpignybpz.supabase.co; all 80 reconciliation checks PASS. Users were not recreated; unrelated rows were checked unchanged. Full results: docs/HISTORY_RECONCILIATION.md.
- [x] Prompt 3 implementation: mobile associate Today, customer/CP entry and detail, bookings, My Sheet/paste, drafts, offline queue/PWA, audited owner corrections and Undo.
- [x] Migration 7 applied live; associate RPC verification 11 PASS and live phone-browser verification 9 PASS. Historical row fingerprints unchanged; synthetic nonhistorical test records soft-deleted. See docs/ASSOCIATE_LIVE_VERIFICATION.md and docs/ASSOCIATE_LIVE_BROWSER.md.
- [x] Prompt 4 local implementation: full admin analysis screens, SQL measures/drills, URL filters, RLS scopes, comparison, Explorer/saved views/export. See docs/ANALYSIS.md.
- [x] Prompt 5 local implementation: guided Review Mode, frozen snapshots, optional locks, Home commitments/completion/carry-forward, Master/PDF/CSV exports, settings/targets/branches/reassignment, audit/recycle, demo seed, friendly errors and recovery/production docs.
- [ ] Apply migrations 9 → 10 only after owner approval. No production migration, data write, region change or deployment was performed for Prompt 5.


## Flat historical data (replaces the earlier importer prompt)

Read `docs/HISTORY.md` for exact setup steps and the plain-English test checklist.
The workbook is in `data/Axon_NCR_Review_Database_Import.xlsx`, ignored by Git. The loader
reads only users, projects, cp_firms, channel_partners, leads, interactions, cp_interactions,
bookings, issues, in that order. Never import README or reconciliation. The verifier alone
reads reconciliation. There is no parser for the old messy workbook. Prompt 3 paste entry
will use the flat sheet headers.

- Run `npm run seed:users` first. Keys map to UUIDs through `legacy_key`; projects reuse
  existing seeded names. Every table is one service-role RPC transaction, with rollback
  restoring suspended triggers on failure. Never disable triggers manually around the script.
- Imported lead caches are authoritative, including rating, next action, last touch and
  status. The loader suspends interaction derived-state/history guards and booking state
  triggers only while importing. Normal app writes retain the original trigger behavior.
- Missing ratings and booking dates stay NULL. The supplied file includes April CP dates;
  preserve all original dates. Source issue row references can be comma-separated text.
- `is_historical` defaults false; all imported rows are true. Today follow-ups explicitly
  exclude history. Command, Explorer and Quality include history by default, with toggles.
- Reconciliation metrics are row-level meetings/ratings/CP meetings and booking_done only;
  they are an explicitly documented SQL dictionary entry (`history_metrics`), distinct from
  the dashboard's distinct leads/CPs and booking_done + agreement_signed. No KPI calculations
  belong in UI code. Baseline: 291 meetings (43 hot,153 warm,91 cold,4 unrated), 292 CP
  meetings, 20 completed bookings, ₹50,222,126. All 80 checks passed locally on two imports.
- `/admin/quality` groups 250 source issues by severity/type, prioritizes the 3 double-booked
  plot conflicts, links to records in `/explorer/[table]/[id]`, and supports audited inline
  fixes, Mark OK, assignment, Keep A/Keep B/Both valid. Quality actions check admin and
  branch inside SQL as well as server actions. Source-only issues retain source tab/rows.
- Exceptions to direct append-only interaction editing are the checked, audited admin
  quality correction RPC and (from migration 7) the owner-only associate correction RPC. It permits only specific fields on the issue's own linked records.
  Ordinary interaction updates remain guarded. Keep A/B soft-deletes the losing booking.
- Re-import skips unchanged source rows and protects records linked to resolved/accepted
  issues. Decisions and subsequent live work survive. Intentional corrections can change
  verification totals; do not suppress those failures. Initial booking status history is
  created once per imported booking without overwriting the supplied lead status.
- Assigned quality checks appear separately on the associate home screen; assignment never
  grants access to someone else's private records. Browser writes to issues are revoked.
- CSV backups include cp_firms and data_quality_issues. No new dependencies were added.

Local validation: `npm run test:db`, `npm run test:history`, typecheck, lint, migration bundle,
and production build. The live historical import and all 80 checks have now passed.
Use `npm run build -- --webpack` if the local Turbopack worker cannot start.


## Associate experience (Prompt 3)

Read `docs/ASSOCIATE.md` for setup, architecture, device installation and the phone checklist.

- Screens: `/home` (Today), `/leads`, `/leads/[id]`, `/partners`, `/partners/[id]`,
  `/log/customer`, `/log/cp`, `/log/booking`, `/my-sheet`. `/offline` is a public shell
  containing no server-provided private data. It is intentionally excluded from the proxy gate.
- Associate queries explicitly filter owner/associate ID even for admins visiting these screens.
  CP directory remains branch-shared; personal CP conversations and attributed business are own-only.
- All entry and edits go through server actions + `associate_save`, as the signed-in user.
  No service role is used in the associate UI. SQL checks active status, password gate,
  ownership, allowed fields, optimistic versions, CP branch and required customer fields.
- Hot requires plots and a next date within seven days of meeting date; Cold requires a
  reason. Closure/token language and past next dates are soft warnings. Customer names/phones
  dedupe within the owner, with typeahead offering an existing follow-up. New CPs dedupe by
  name/firm or phone in the branch.
- The original workbook customer definitions were read directly. It has no CP legend;
  provisional CP definitions are kept in `src/lib/associate/common.ts` pending owner wording.
- Latest lead state is maintained only in SQL. An old interaction correction repairs the
  later rating_before chain and refreshes from the newest live event. Audits retain old/new.
  Direct history updates stay guarded. A guard is suspended only inside a checked table-locked
  RPC transaction and restored on success/error. Migrations 1–6 remain unchanged.
- Today hides imported action items; a fresh nonhistorical event on an imported lead is
  current work. Provenance flags stay intact. CP follow-ups come from the caller’s own
  latest CP meeting rather than another associate’s shared directory cache.
- Progress rings use `associate_scorecard(from,to)` in the SQL metric dictionary. CP meetings
  are rows; Hot is distinct leads after the latest meeting; bookings include agreement_signed.
  Monthly targets are prorated by calendar days and rounded up. No invented targets.
- Plot options use known own records plus free entry. Branch conflict warnings expose counts
  only, never another customer’s identity. Do not invent a complete inventory.
- Drafts (including speech and sheet cells), queues, last project and snapshots are scoped
  by user in localStorage. Writes are durable before send. Fixed request IDs, payload hashes
  and SQL request locks make lost-response retries safe. Different content under an already
  saved ID is rejected. Paste rows have stable IDs inside their saved batch.
- Reconnect/reopen retries pending entries. Errors remain visible for correction/Retry.
  Server actions verify the queued owner against the current session. Signing out removes
  the active offline workspace marker; other accounts cannot see/sync that owner’s queue.
- Undo uses `associate_undo`: soft-delete/restore with audit, 10-minute window for synced
  entries, version/newer-event checks. Offline Undo queues cancellation; entry_cancellations
  prevents a delayed original request from creating the record afterward.
- Service worker caches only the empty offline page, immutable code/fonts and icons. Never
  cache signed-in HTML, API or Supabase responses. It precaches offline page dependencies
  so a production reload can work without a connection. Open online once before relying on it.
- My Sheet supports original-template or flat TSV clipboard headers, quoted multiline/Hindi
  remarks, India-style dates, preview/errors and per-row results. Never parse/re-import a
  messy workbook here. Never accept another associate_key or foreign lead_key from paste.
- Every associate action uses at least 48px targets. Rating colours: Hot red, Warm orange,
  Cold blue, CP Active green. Empty states explain the next action. Voice uses the browser
  SpeechRecognition API (en-IN / hi-IN), with a typing fallback.
- New dev dependencies: Playwright (real browser checks) and @tailwindcss/postcss (styles
  must work under both bundlers). Standard PostCSS replaces the old Turbopack-only setup.
- `npm run test:associate` runs parser/queue/guardrail tests. `npm run test:ui` builds a
  separate production app under `.next-associate-e2e` and runs phone Chrome against a local
  PostgreSQL/Supabase protocol fixture. It never writes live test records or bypasses auth
  in production code. Google Chrome is the default local Playwright channel.
- Backups include entry_receipts and entry_cancellations. Plain-English device checklist is
  in docs/ASSOCIATE.md. Actual microphone permissions/recognition and home-screen install
  also need a walkthrough on the associates’ phones.


## Admin analysis (Prompt 4)

Read `docs/ANALYSIS.md` and the expanded `docs/metrics.md` before changing analysis. Migration 8 is **not applied live**. Existing live migration 7 must not be edited. No historical reload, user recreation or deployment was performed for analysis.

- Routes `/command`, `/movement`, `/cps`, `/cps/[id]`, `/plots`, `/explorer`, `/associate/[id]` live in `(analysis)`. Own entry routes live in `(associate)`, whose layout alone loads the full offline workspace. Raw record detail `/explorer/[table]/[id]` remains outside reviewer layout so assigned own quality checks stay accessible to associates.
- `src/lib/analysis/` contains filters, server reads, save actions and export safety; `src/components/analysis/` contains controls/reports/charts. Global controls use URL query parameters. Super admin can select a branch or all; non-super-admin server reads force their branch. SQL RLS remains authoritative, including recursive team scope.
- `analysis_events` is a security-invoker projection. `analysis_rows` filters facts; `analysis_summary`, `analysis_dashboard`, `analysis_explore`, `analysis_group_summary`, `analysis_group_members`, `analysis_metric_rows` and `analysis_drill` share the metric definitions. Movement/CP/plot RPCs handle their specialized evidence. Helpers execute as the user and cannot bypass base RLS. Never replace these with client-side KPI arithmetic.
- Command bulk-aggregates authorized facts once; do not introduce per-associate scans of RLS views. Dimension choice scanning is requested only by Explorer. Auth getUser/profile is cached only inside the current request. Current-volume production browser render is under 2 seconds locally; remeasure after approved live setup.
- KPI clicks return exact supporting rows. Ratios expose numerator/denominator and funnel drop-offs. SQL handles targets, percentage points, visual heat scales, date bins and comparisons. TypeScript only formats Indian currency/units and prepares chart series. Separate chart measures avoid mixing count/currency axes.
- `saved_analysis_views` stores URL state with own-write RLS, optional branch-reviewer sharing and audit. Shared links never grant access to data. `/api/analysis/export` uses reviewer auth + RLS and the same paginated SQL; CSV text is formula-safe, XLSX includes Filters. ExcelJS is now a runtime dependency because XLSX export runs on the server.
- Admin reports include history by default, with current/only/all toggle. Unknown booking dates remain unknown and do not enter dated metrics. Current workbook dated confirmed dashboard units are 16; all-source reconciliation booking_done is 20. These different documented cohorts must not be forced to agree.
- New `scripts/analysis-workbook.test.ts` imports the full private workbook into isolated PostgreSQL and compares dashboard/drill results with the existing dictionary plus a strict 2-second SQL budget. Browser suite also checks the full workbook under 2 seconds, reviewer scopes, saved searches, exports and phone regressions. All fixtures are local; no production auth bypass exists.
- Live verification used short-lived local-scope auth sessions with no email or password changes. An initial script used Supabase's default global sign-out before correction, so Udit may have needed to sign in again. The initial cleanup hit an expected version guard; targeted cleanup and all final checks passed. Details are in the live verification report.
- Do not silently treat missing cancellation reasons, CP identities or inventory as known. Current source flags and audit remain available through Quality and record links.


## Review Mode and finishing work (Prompt 5)

Read `docs/REVIEW.md`, `docs/PRODUCTION.md`, README and `docs/metrics.md` before changing review logic. The latest code is local; do not assume migrations 8–10 are installed on live Supabase. Do not apply a migration, seed a project, change a region, reset live users or deploy without approval.

- `/review` is a guided pack with target/actual/prior-cycle scorecards, movement/status-event changes, configured question links, earlier commitments, notes/actions, finalise/lock, focus view and a persistent associate walkthrough. `/review/print` prints one frozen session or current branch packs; `/api/review/export` returns the clean old-layout Master workbook. Source template inspected locally, never shipped. Exports retain SQL definitions, not contradictory old formulas, and leave customer phone cells empty.
- `review_pack`, `review_targets`, `review_asks`, `review_master` and `branch_rollup` are SQL dictionary entries. Review comparison uses the actual configured cycle preceding the selected start; normal analysis comparisons keep their existing rules. Snapshot stores its metric dictionary version. Bookings/cancellations in Changes use status-history event dates; KPI/ask cancellation cohorts retain the documented booking-date/current-status basis.
- `review_begin` shares an idempotent draft per associate/window. `review_edit` validates notes/action lengths, owner scope/branch and due date. `review_finalize` locks source tables, recomputes the pack once, freezes it, publishes commitments and records any entry lock atomically. Final sessions reject updates. New admin corrections never rewrite frozen evidence. `commitment_complete` permits the actual owner only and requires a comment. Carried actions link to the earlier item and mark it carried only when the new review finalises.
- Review-entry lock trigger is independent of temporary append-only trigger suspension. It checks old and new dated entries, including edits, insertion, moving dates, soft deletion and Undo. Only admins/service recovery may bypass; normal later rating-before chain repair is permitted. No UI unlock/rewrite of final reviews exists.
- Admin screens: Settings (company choices, branch cycles/rules, monthly targets, branch creation and CSV table links), Team (existing user management plus atomic lead reassignment), Audit (branch-scoped immutable before/after with filters), Recycle bin and per-record audited correction/restore. Reviewer teams retain access to non-contact customer context for their own historical fact credit after a transfer; other teams' facts stay hidden. New owner can read a leaver's old timeline; meeting/booking authorship is unchanged and inherited rows are read-only to that new owner.
- Customer privacy is enforced at the database API, not just hidden in JSX. Direct authenticated SELECT of lead phone and source JSON/receipt payload columns is revoked; use `record_read` with scope and current-owner/admin masking. Associate workspace reads explicitly project only needed fields and own records/owned-lead history. Record detail and Quality use the same RPC. Do not reintroduce `select('*')` for protected customer tables. SQL metrics select only needed columns. Free-text remarks remain visible to permitted reviewers; use the dedicated contact field for phones.
- Mandatory password setup gates operational tables through restrictive RLS. `my_role`/`my_branch` are unavailable until the flag is cleared. The user can read their own profile to reach setup; clearing the flag requires the server-only admin client **after** Auth confirms the user's password update. Do not restore browser-side profile flag updates. Public API queries with temporary passwords must not bypass this.
- New restrictive policies use `(select my_role())` initplans to avoid repeated per-row role lookups. `analysis_rows` explicitly scopes associates even under a checked definer finalisation call. Do not weaken scope to improve speed. The existing Command <2s check stays strict.
- Demo seed uses DEMO_SUPABASE_URL / DEMO_SUPABASE_SERVICE_ROLE_KEY / DEMO_PASSWORD and refuses the intended real hostname, configured real URL, non-demo branches and non-demo logins. It seeds only fictional data, CPs and transactions. Run it only in a separate project. UI banner identifies demo mode. Ordinary seed cannot silently put demo users into the intended live project.
- `scripts/prepare-restore.ts` is an offline SQL generator, not an executor. It requires a complete compatible CSV export, produces private `export/recovery.sql`, and documents merge semantics, Auth UUID prerequisites, trigger restoration and audit preservation. It does not reconstruct Auth passwords/accounts or perform point-in-time recovery. Never execute a recovery file against live as a test.
- Production guide covers Mumbai verification (not yet confirmed live), remaining 9–10 activation order, Netlify build/runtime setup and Vercel alternative. No paid service was purchased. Existing public GitHub visibility is unchanged. No new commit/push was requested for this finishing task.
- Friendly error/loading/not-found screens, visible keyboard focus, reduced-motion CSS, labelled controls, 48px mobile controls and print CSS are included. Browser voice permissions and home-screen installation still require real-device checks.


Final local validation for Prompt 5 (24 October 2026):

- `npm run test:db`: 30 PASS, including full review lifecycle, immutable snapshots, CP/booking/customer/Undo locks, carry-forward/completion, role scope, draft-action removal, complete backup-service read grants, phone/source/receipt protection, original team credit after reassignment and mandatory-password API gating.
- `npm run test:ui`: 16 PASS against an isolated production app/database; full review → frozen Master → print → Home commitment completion, all-associate walkthrough, settings/branch creation/audit/recycle, login throttle and all earlier phone/analysis scenarios. Full-workbook Command rendered in 745 ms locally; the strict two-second assertion was retained.
- `npm run test:review`: 2 PASS; original Master cell/section positions, expansion past nine associates, omitted phones, and actual execution of the generated CSV merge-recovery SQL with audit/trigger checks.
- `npm run test:associate`: 3 PASS. Actual-workbook historical integration: import twice, all 80 reconciliation checks, rollback, audited quality and preservation checks PASS in isolated PostgreSQL. No live verifier/import or production writes were run for Prompt 5.
- Typecheck, lint and the final production build (`npm run build -- --webpack`) PASS. Migration bundle includes 10 migrations. Prior migrations 1–8 were not edited. Configured secret values were absent from source/public/browser chunks, and environment/workbook/export/build files remain ignored.
- Initial issues found during testing were fixed: accessible picker labels, fixture users still behind the new password gate, mixed enum parameter typing, SQL alias ambiguity, login-test form reset/route-announcer selectors, and repeated per-row role lookups causing a 2.28-second render. New status-event tests also cover undated original bookings and multiple cancellations for one customer. No known automated test failures remain.

These changes are saved locally and have not been committed/pushed or deployed as part of Prompt 5. Live activation, Mumbai-region confirmation, dedicated demo project provisioning and real-device microphone/PWA checks remain in the production checklist.


## Owner-authorised account access and GitHub update (25 October 2026)

- Read-only checks confirmed migration 8 analysis RPCs and saved views are already live on the intended project. Migrations 9 and 10 are absent; neither was applied.
- At the owner’s request, reset temporary credentials for the 10 matched application/Auth accounts, require a password change on next login, and clear their failed-login attempts. All 10 active logins verified successfully. Active flags, roles and ownership were preserved; no unrelated Auth accounts or customer/business records were modified. Credential values and private reset scripts are excluded from Git. Do not repeat the reset automatically.
- The owner authorised pushing all saved product updates to the existing GitHub repository for its connected Vercel app. Repository visibility is unchanged. Previous local test results above were not rerun for this push; only staged-file safety and targeted sign-in checks were performed.
- Existing-live activation still requires approval for migration 9 followed by 10. Do not rerun migrations 1–8, recreate users or reload history.
