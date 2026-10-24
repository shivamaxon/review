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
8. `…08_analysis.sql` — SQL analysis dictionary/RPCs, security-invoker fact view, saved-view RLS and analysis indexes. **Local only: owner approval required before applying live or deploying.**

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
- Migrations are append-only once shipped: add a new numbered file instead of editing an old one. Migrations 1–5 are fine to edit only until the first real deployment. After any change run `npm run test:db && npm run db:bundle`.
- Comments explain *why*, in plain English. No new dependencies without a reason.

## Auth rules (all verified end-to-end against a real local Supabase)

- Email + password only; **public sign-ups must be OFF** in Supabase (Authentication → Sign In / Providers → User Signups). Users exist only because an admin created them (Admin > Team, or `npm run seed:users`).
- `must_change_password = true` on every new user. Enforced twice: `src/proxy.ts` redirects to `/change-password` (optimistic), and `requireProfile()` re-checks in every page. `signIn` redirects straight to `/change-password` or the role home in one hop (chained redirects leave the URL wrong).
- New password: 8+ chars; must not equal the email, email name, first name, full name, or `firstname123` (`src/app/change-password/actions.ts`).
- Login rate limit: 5 failures per email or 20 per IP in 15 minutes → blocked (`login_attempts` table, service key only). Fails open if the table is missing, with a console error.
- Starting passwords (from the owner): associates = lowercase first name (fallback `firstname123` when Supabase rejects it as too short); admin = their own email. Never stored in files or git. Seed scripts never print them.
- The Excel `users` sheet lists reports_to = "Ajay Kushwaha (Branch Head)" but has **no row for Ajay**; `reports_to` stays empty until he is added, then re-run `npm run seed:users` to link.

## Ops

- `.github/workflows/keepalive.yml` — pings `rpc/ping` every 3 days so the free Supabase project never pauses.
- `.github/workflows/nightly-export.yml` — nightly CSV export as a workflow artifact (14 days). **Repo must be private.** Optional `EXPORT_PASSPHRASE` secret encrypts it.
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
- [ ] Apply migration 8 and deploy only after the owner approves each action. No deployment performed in this session.
- [ ] Later: review sessions/commitments and target-management UI.


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
