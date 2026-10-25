# Admin analysis

The analysis layer is built and tested locally. **Migration 8 is already installed in the intended live project**, confirmed by read-only checks on 25 October 2026. Do not rerun it. The newer Review Mode and privacy features require migrations 9 and 10, which still await owner approval.

## Existing-project activation

1. Keep migration 8 as installed; do not rerun the fresh-install bundle, recreate users or reload history.
2. For the matching latest app, follow [the production checklist](PRODUCTION.md) and obtain approval for migration 9 followed by 10.
3. Sign in as an admin. Open Command, turn on Compare previous period and select a window containing your data. A new window with no activity will correctly show zero.

## Answer the four review questions

- **Who has the most untouched Hot leads?** Command → Hot leads untouched for a week. The league ranks this column first. Click the person's count for the exact customers, or their name for the complete profile.
- **Which CPs bring leads but never convert?** Command → CPs bringing leads with no conversion. The firm league restricts to firms that sourced leads in the window but have no visible confirmed booking up to its end. Open a firm or mismatch to inspect its records.
- **How did Hot → booked change?** Pick Current review cycle and Compare previous period. Command shows the conversion and percentage-point difference. Click the number, then Numerator / Denominator, to inspect the cohort. Funnel links also expose the exact drop-offs.
- **Why do bookings cancel?** Command → Why bookings cancel, or scroll to Cancellation reasons. Select a reason to see remarks and booking records. Missing reasons are explicitly grouped as Reason not recorded.

## Screens

`/command` has SQL KPIs, exact drill-downs, same-cohort funnel, associate league, meeting sparklines, booking targets, follow-up discipline, pipeline and booking/cancellation breakdowns. `/movement` has historical transitions, completed stage durations, stale leads and regressions. `/cps` groups firm results and flags rating mismatches; `/cps/[id]` adds a CP meeting timeline. `/plots` shows recorded plot events, simultaneous current contention and rebooking after cancellation. `/associate/[id]` combines these reports for one visible person.

`/explorer` supports meetings, CP meetings, bookings, leads and an all-records search. Choose up to two dimensions and any supported measures. Views include table, grouped bar, stacked bar, line and heatmap. Separate measures get separate charts so currency, days and counts never share an axis. Week/month groups sort chronologically. Select a measure or a bar to inspect its contributing records. Ratios provide numerator/denominator tabs.

Full-text remark searches support quoted terms and web-search syntax, including Hindi. Matching snippets are highlighted as plain React text, never injected HTML. Save a named view privately or share it with reviewers in your branch. A shared view saves filters, not a copy of records; each viewer's RLS still applies. Opening a saved view expands its full state into the URL. CSV/XLSX exports include all matching pages, obey the same filters and access checks, and protect spreadsheet text from formula execution. XLSX also includes a Filters sheet.

Global periods, comparison, associate multi-select, branch (super admin), project, source, CP and history controls use GET URLs. Explorer adds dimension filters, full-text query, groups, measures, chart and pagination. Browser Back and copied links restore the view. On phones the filter panel collapses so it does not cover the report.

## Security and implementation

Migration 8 adds security-invoker `analysis_events`, SQL RPCs, partial indexes and RLS-protected `saved_analysis_views`. Every page, export and save action also requires a reviewer role. Branch admins are forced to their branch; team leads inherit the existing recursive `visible_associates()` RLS; super admins can choose one branch or all. The UI never uses the service key. Shared CP directory metadata remains branch-wide, while all CP meeting and business counts obey associate visibility.

The SQL dictionary is documented in `docs/metrics.md`. TypeScript only formats, sorts displayed rows and prepares chart series; it does not compute business measures. Command bulk-aggregates the authorized facts once instead of rescanning RLS views per associate. Requests share one verified auth/profile lookup within that request. Only Explorer requests dimension-choice scans. Tables and exports paginate in SQL; drill drawers use 50 rows, exports batches of 500. Movement lists show up to 200 and invite narrower filters. This is the known-plot register, not invented inventory.

Unknown dates are preserved and excluded from date-window metrics; unknown booking values contribute zero to value, while the raw record remains unknown. Thus the dashboard's dated booking count may differ from the all-source historical reconciliation. Current workbook-wide dated dashboard bookings = 16; source reconciliation booking_done = 20. Missing cancellation reasons and uncertain CP attribution remain visible quality issues. Firm fallback uses an existing matching firm name when no CP link exists; no artificial CP identity is created.

## Verification evidence

- All 80 read-only live historical reconciliation checks PASS after associate verification; full associate-by-associate results: `docs/HISTORY_RECONCILIATION.md`.
- Live associate RPC checks: 11 PASS. Live phone-browser checks: 9 PASS. Reports: `docs/ASSOCIATE_LIVE_VERIFICATION.md`, `docs/ASSOCIATE_LIVE_BROWSER.md`.
- Isolated database suite: 30 PASS after Review Mode hardening, including reviewer scope, all-branch filtering, dictionary agreement, exact metric/funnel/Explorer member rows, saved-view RLS, movement and plot comparisons.
- Actual workbook isolated import: loaded twice, all reconciliation checks PASS, audited quality actions and rollback verified.
- Actual workbook Command SQL matches the existing dictionary; SQL and browser render both under 2 seconds on this machine. After the Review Mode hardening, the full-workbook production-browser check completed in 0.745 seconds locally, including visible booking charts. This is local evidence, not a guarantee of live network latency; remeasure after approved migration/deployment.
- All 16 browser scenarios PASS after Review Mode was added, including the full-workbook desktop timing check. Typecheck, lint and the production build PASS.
- Browser suite covers admin navigation, all four business questions, exports, full-text saved views, role visibility, source-volume render and associate/offline regressions.

Initial failures were corrected: an expensive per-person SQL scan (22.5 seconds), an unnecessary global dimension scan (browser 2.126 seconds), and selectors that picked hidden/mobile controls or two interactions with the same customer name. Final tests exercise the actual behavior, without relaxing the two-second limit.

Run `npm run test:db`, `npm run test:associate`, `npm run test:history`, `node --import tsx --test scripts/analysis-workbook.test.ts`, `npm run test:ui`, `npm run typecheck`, `npm run lint` and `npm run build -- --webpack`. `npm run db:bundle` generates the fresh-install bundle; it does not apply anything remotely. Browser tests use an isolated local database and production build. Live verification scripts use explicitly marked synthetic nonhistorical entries and soft-delete them afterward; they do not edit imported records.

## Plain-English test checklist

- [ ] Log in as branch admin; compare this cycle with last cycle. Open a KPI and check its underlying records and both export formats.
- [ ] Rank untouched Hot leads, open the highest person's count, then their combined profile.
- [ ] Open firms with leads but no confirmed conversion. Check the CP timeline and attributed leads/bookings.
- [ ] Open Hot → booked; check numerator, denominator and funnel drop-off records.
- [ ] Open Cancellation reasons; confirm the reason and full remark explain each cancellation, or explicitly say it is missing.
- [ ] Inspect Movement and plot history. Check a double-Hot plot and a cancellation/rebooking sequence where data exists.
- [ ] Search for budget/loan/NRI, group by associate and rating, switch charts, save a shared view and open its copied URL.
- [ ] Log in as a team lead: only their reporting tree contributes. As super admin, compare one branch with All branches. Associates cannot enter analysis screens.
- [ ] On a phone, open/close filters, follow a drill link and return without losing filters.
- [ ] Recheck page timing against live Supabase after migration 8 and deployment are separately approved.
