# Metric dictionary

**Single source of truth.** Every number shown anywhere in the app comes from the SQL functions in
`supabase/migrations/20260101000004_metrics.sql` and the history, associate, analysis and review additions in migrations 6–10. If this page and the SQL ever disagree, that is a bug.
The tests in `supabase/tests/rls.test.mjs` ("metric dictionary…") check these definitions with known data.

A **period** is just a pair of dates (`from`, `to`, both inclusive). Review windows (1–10, 11–20, 21–month-end) are
only a convenient way to pick that pair (`current_review_period()`); a period is never a container for data.

## Customers

| Metric | Definition |
|---|---|
| **Meetings** | Count of interactions with type `meeting` whose `occurred_on` is in the period. Follow-ups (`follow_up`) are **not** meetings. A customer met three times counts as 3 meetings. |
| **Leads met** | Distinct leads with at least one meeting in the period. |
| **Hot / Warm / Cold leads** | Leads met, grouped by the rating they had after their **last** meeting inside the period. Hot + Warm + Cold + Unrated = Leads met (NULL rating means unrated). |
| **Hot %** | Hot leads ÷ Leads met (0 if no leads met). |

## Channel partners

| Metric | Definition |
|---|---|
| **CPs met** | Distinct channel partners with at least one CP interaction in the period. |
| **CP Active / Hot / Warm / Cold** | CPs met, grouped by their rating after their last CP interaction inside the period. |

## Bookings

Date used is the booking's `booking_date`. Soft-deleted bookings are ignored.

| Metric | Definition |
|---|---|
| **Bookings** | Count of bookings with status `booking_done` or `agreement_signed`. |
| **Booking value** | Sum of `value` over exactly those bookings. |
| **Tokens** (+ value) | Count (and sum) with status `token`. **Reported separately, never inside Bookings.** |
| **Cancelled** (+ value) | Count (and sum) with status `cancelled`. **Excluded from Bookings but always reported.** |

A booking that moves Token → Booking Done → Cancelled is counted once, under its **current** status; the full path is in
`booking_status_history`.

## Who sees what

`associate_metrics(from, to)` returns one row per person the caller is allowed to see (associate: just themselves;
team lead: their tree; branch admin: the branch; super admin: everyone), and `team_metrics(from, to)` totals those rows.
Visibility comes from Row Level Security, not from the function, so the numbers cannot leak.

## How this differs from the old Excel

The Excel "Master" sheet and the per-associate header rows disagreed with each other:

- Master counted only **"Booking Done"** as a booking (Agreement Signed was ignored); the associate sheet headers counted
  **every row** in the bookings table, including Tokens and Cancelled.
- Meetings were counted per *row*, so a customer could be counted again in every 10-day sheet, and the Hot/Warm/Cold
  split used whatever rating was typed on that row.

Expect historical totals to differ from the old workbook once data is imported. The new definitions are the intended ones.


## Historical reconciliation (migration 6)

`history_metrics()` is the SQL dictionary entry for checking the flat workbook. It uses
only `is_historical = true`, excludes soft-deleted rows, and returns one row per seeded
`profiles.legacy_key`. The loader does not read the reconciliation sheet; only the verifier does.

| Verification column | Definition |
|---|---|
| Meetings | Interaction rows of type `meeting` |
| Hot / Warm / Cold / Unrated | Those same meeting rows grouped by `rating_after`; NULL is unrated |
| CP meetings | All CP interaction rows, including repeat meetings |
| Bookings | Only `booking_done`, matching the source's reconciliation |
| Booking value | Sum of those `booking_done` values, treating missing values as zero |

These are **source reconciliation counts**, separate from the dashboard's distinct leads,
CPs, and booking_done + agreement_signed measures above. There is no artificial May–October
cutoff: the supplied workbook contains April CP dates, and some bookings have no date.
Preserve those facts and include them in the source check.

Baseline: **291 meetings, 43 hot, 153 warm, 91 cold, 4 unrated; 292 CP meetings;
20 booking_done; ₹50,222,126**. `npm run verify:history` compares every associate against
numeric Master columns in the reconciliation sheet and checks these fixed totals. Any
mismatch exits with an error. Resolving an issue may intentionally change the baseline;
this check should then fail rather than conceal the correction.

The dashboard functions now take optional `p_include_historical boolean default true`.
The Command toggle passes it explicitly; existing two-date SQL calls retain their behavior.
Unknown customer/CP ratings remain NULL. Thus Hot + Warm + Cold + Unrated = Leads met.
Today queries require `is_historical = false`; Explorer and Quality default to including
history and offer a toggle. Assignment of an old quality issue is a separate, explicit
request to investigate, shown under Assigned data checks rather than Today follow-ups.

## Associate Today scorecard (migration 7)

`associate_scorecard(from,to)` returns only the signed-in user’s counts and targets.
Meetings, Hot leads and Bookings use the existing `associate_metrics` definitions; CP
meetings count **rows**, including repeat meetings, rather than distinct CPs met.
Only the `from`/`to` period is counted. Deleted rows are excluded. New and historical work
both contribute when dated inside the period; historical follow-up lists are independently
filtered from Today to prevent an old-action flood.

Monthly `targets.customer_meetings`, `hot_leads`, `cp_meetings` and `bookings` are weighted
by the calendar days overlapping the selected period, summed, and rounded up. No target
row returns NULL (shown as Target not set). The tests use a 31-day month and an 11-day
review window to verify this rule. Undo/corrections change live metrics through the same
SQL functions; original historical reconciliation remains an explicit baseline check.


## Admin analysis (migration 8)

All analysis RPCs are security invoker and require a reviewer. Base `analysis_events` is a unified record projection; `analysis_rows` applies global filters, dimension filters, full-text search and RLS. Only active associate/team-lead owners contribute, matching `associate_metrics`. Follow-ups remain available to movement and raw details; the **meetings dataset and meeting measures exclude follow-ups**. Deleted fact rows are excluded. Current owner/project/source/CP/firm attributes classify historical facts; this is not an organizational-history snapshot.

`analysis_context` uses inclusive India dates. Current/last cycle uses branch review-cycle configuration, falling back to ten-day cycles. All-branch views use the caller's branch calendar unless a branch is selected. Last 10 days ends today. MTD starts on the first. Custom needs ordered valid dates. Comparison uses the actual prior cycle for cycle presets, the corresponding elapsed dates in the previous month for MTD (clamped to month end), otherwise the preceding equally long window. Deltas are current minus previous; percentages use **percentage points**. Zero denominators return 0 for rates; missing targets, durations and average tickets return NULL, displayed as a dash.

### Command and funnel

`analysis_summary` / `analysis_dashboard` use the customer, CP and booking definitions above. CP meetings count rows; active CPs count distinct CPs whose latest CP meeting in the window was Active. Branch-wide distinct CPs are not the sum of personal distinct CP counts when two people met the same CP. Bookings use their current status and booking_date. Missing dates never acquire invented dates and are excluded from date-window measures, unlike `history_metrics`.

| Measure | Exact SQL rule |
|---|---|
| Cancellation % | Cancelled booking rows / all booking rows dated in the window (including tokens), × 100 |
| Hot → booked % | Hot cohort leads with at least one current confirmed booking dated in the window on/after their first Hot meeting in that window / Hot cohort leads × 100 |
| Funnel | Distinct leads met → latest-meeting Hot cohort → those Hot leads with token-or-confirmed → confirmed → agreement. Each downstream step retains the same Hot cohort. Repeated meetings do not inflate it. |
| Funnel step conversion / drop-off | Current step / prior step × 100; drop-off = prior-step leads absent from current step |
| Untouched Hot ≥7 days | As-of pipeline Hot leads whose newest interaction is at least seven days old; this is a stock measure and does not require a new meeting in the window |
| Next steps dated % | Meeting rows with a next action **and date** / meeting rows with a next action × 100 |
| Followed up on time % | Meeting rows with a due date on/before period end and a later visible, nondeleted interaction by that due date / meeting rows with a due date on/before period end × 100. Recorded dates are the evidence; no unrecorded completion is inferred. |
| Booking target / achievement | Sum of month targets weighted by inclusive calendar days overlapping the period, rounded up after summing; confirmed units / allocated target × 100. No target yields NULL. |
| Meeting sparkline | SQL counts in 12 equal-width date bins across the selected period |

`analysis_metric_rows` and `analysis_drill` return precisely the supporting rows. Distinct-lead metrics return the latest meeting representative; distinct-CP metrics return the latest CP meeting representative. Ratios expose numerator/denominator tabs; funnel additionally exposes drop-offs. Value drill rows are confirmed bookings and their values sum to the KPI. Target drill shows the allocation per month.

`analysis_pipeline` reconstructs the last interaction as of min(period end,today), preserving NULL ratings and next dates. It carries forward the latest nonempty plot list, excludes lost leads and currently confirmed bookings dated by the snapshot (undated confirmed bookings also excluded at today's snapshot). The start date does not remove pre-existing pipeline leads. Status of a booking is current; historical status paths are separately shown in movement/plots. Historical/current filters concern record provenance, not the age of a date.

### Movement and plots

`analysis_transitions` merges interaction ratings and recorded booking status history by event date and timestamp. Consecutive identical stages collapse before calculating intervals. New→Cold counts as a transition; follow-ups can change ratings. Initial booking events use booking_date; subsequent status events use their recorded changed_at in India. Unknown event dates cannot enter dated transitions. `analysis_movement` counts transitions in the window, compares the prior window, and computes average completed stage intervals whose next transition falls in the window. Open intervals do not invent a closing date. Stale means latest stage change ≥21 days before min(end,today), even if there was a same-rating contact afterward. Backwards = Hot→Warm/Cold, Warm→Cold, or a cancellation. This differs deliberately from untouched, which uses last contact.

`analysis_plots` normalizes plot text by case and trimming within a project. It shows Hot interactions in the window plus available booking status history up to its end. Hot customer counts use the as-of pipeline; reserved customer counts use current token/confirmed bookings dated by the window end, including undated reservations visibly labeled Date not recorded. Distinct customers ≥2 flag contention. A later token/confirmed event after cancellation flags rebooking. Plot compare shows prior snapshot counts and deltas. This is recorded evidence, not proof that source plot names or dates are complete.

### CP intelligence

`analysis_cps` groups source=CP leads/bookings and CP meeting rows by linked firm, with name fallback for source-only firm text. Leads sourced are leads created in the window, Hot is their **current** rating, confirmed bookings/value/cancellation rate use booking-date cohorts. Last-contact age uses all visible meetings up to min(end,today). Confirmed lifetime bookings cover visible, currently confirmed rows up to end, including undated confirmations. Never converted = leads sourced in window >0 and confirmed lifetime bookings =0. This is within the reviewer's scope, never a claim about hidden branches/teams. Hot/Active with zero individually linked leads created in the preceding 30 days and Cold with a confirmed booking in the window are flags to investigate. A firm-only source does not invent an individual CP link.

### Explorer

`analysis_group_summary` computes every group from authorized typed SQL fact arrays; `analysis_group_members` supplies its drill rows. Grouping supports up to two dimensions. Week uses Monday; month uses calendar month. NULL groups show Not recorded. Each dataset is dated by occurred_on (meetings/CP meetings), booking_date (bookings), or lead created_on/creation date (leads). All-records search is a union of these datasets; its count includes each record kind.

| Measure | Rule within the selected dataset/group |
|---|---|
| Count | Selected rows |
| Unique leads | Distinct linked lead IDs; CP meeting groups also include leads created in the window attributed to the group's CP/firm |
| Hot % | Latest meeting representatives for the group's lead cohort that are Hot / all such representatives × 100. For meetings, representatives are restricted to the selected meeting rows. |
| Booking units / value | Confirmed booking rows / sum of their values. For bookings, use selected rows; for meetings/leads, use bookings linked to cohort leads in the window; for CP meetings, also include direct CP/firm-attributed bookings. |
| Conversion % | Distinct confirmed-booking lead IDs in that booking cohort / unique cohort leads × 100 |
| Average ticket | Confirmed value / confirmed booking units |
| Cancellation % | Cancelled booking rows / all booking rows in the group's booking cohort × 100 |
| Average days to close | Average booking_date − lead created_on/creation date over confirmed linked bookings with known nonnegative intervals |

Related facts obey global filters. Dimension filters and the text query select the input cohort; related booking facts are then linked to that cohort, rather than reapplying a meeting rating to booking status. Group measures are not generally additive: one customer/CP can belong to several rating/week/mode groups. The total is recomputed from the complete cohort, never summed from rendered groups. Group sorting and pagination happen after SQL computes all groups. Heat scales are SQL values; browser code only renders them. CSV/XLSX exports request the same RPCs and paginate through all matching records.

Full-text search uses PostgreSQL `simple` configuration and websearch syntax. It searches remarks in the selected records; lead search also matches its interaction remarks. An older matching remark may qualify a lead even when its latest displayed remark differs. Query and filters are stored in the URL/saved view. Saved views store no metric results and do not bypass RLS.


## Review Mode, targets and frozen reports (migrations 9–10)

`review_pack` assembles SQL measures; `review_targets` prorates the four monthly targets by inclusive calendar-day overlap and rounds up after summing each person's monthly contributions. Missing targets stay NULL. The scorecard compares the selected review window with the **configured review cycle immediately before its start**, using `analysis_context` with `review_previous_cycle=true`. Normal analysis comparison semantics remain unchanged. Each branch uses its own cycle. The review date range is at most one year.

What changed starts the day after the most recent final review ending before the selected window, or at this window's beginning if none exists. Movement follows recorded interaction and booking-status history. New Hot means the first-ever Hot meeting in the selected change span (a latest-meeting Hot representative with no earlier Hot meeting). New booking/cancellation lists use per-booking status-history events within that span before same-lead stage collapse, preserving multiple plots per customer, including a later cancellation of an older booking. Undated initial statuses cannot be assigned invented event dates. Current-status booking KPIs remain separate from status-event lists; a cancellation event can refer to a booking that subsequently reopened.

`review_asks` evaluates the branch's enabled rules as of min(period end, today), using the visible as-of pipeline and recorded events:

| Rule | Default / definition |
|---|---|
| `hot_stale` | Hot and last interaction at least 5 days ago; unknown last touch also needs investigation |
| `hot_no_plot` | Hot with no known plot list |
| `overdue` | Next-action date before the snapshot date |
| `warm_stale` | Warm with no stage change for at least 21 days; same-rating contacts do not reset movement age |
| `cold_future` | Cold with next-action date after the snapshot date; a question to confirm nurturing intent, not a blocker |
| `token_stale` | Current Token with known booking date at least 10 days old |
| `cancellations` | Current cancelled bookings dated in the selected window, showing reason or Reason not recorded |
| `cp_no_leads` | Latest personal CP rating Hot/Active with no individually CP-linked leads created in the preceding 30 days within that reviewer's scope |
| `double_hot` | A current Hot lead shares a case/trim-normalised plot in the same project with another visible Hot customer |

Admins can enable/disable every rule and edit day thresholds for the four age rules. These are review questions, not invented deductions or automatic rating changes. Team leads only receive questions supported by their permitted scope. The ask list's dated cancellations differ from the change list's status events, as labelled above. Unknown token dates stay a quality issue, not a guessed 10-day age.

`review_finalize` freezes the complete pack, original metric-row definitions (`legacy_stats`), targets, notes, agreed actions and dated detail rows in `review_sessions.snapshot`. Export and print of that session read the frozen snapshot, never recompute it. The schema migration and `docs/metrics.md` define its metric basis at finalisation. Later corrections, ownership changes, commitment completions and new metric definitions cannot change its historical figures. New actions publish on finalisation; future completion is operational state recorded separately in `review_actions`, with audit.

`review_master` provides SQL totals, Hot %, booking-target variance and achievement. The old Master layout and per-associate sections are retained; old conflicting row-count/Booking Done-only formulas are not reproduced. Ratings use latest meeting per lead and confirmations include Agreement Signed. CP summary totals sum the individual distinct-CP counts, matching the old per-associate Master concept; Command's branch-wide active CP count deduplicates across associates. Targets sum the per-person allocated targets. Phones are deliberately omitted. A finalised-session export includes one person's frozen pack; a whole-branch current export uses live SQL at its chosen window.

Reassigning a leaver's active leads changes current ownership only. Meeting/booking attribution remains with its original associate and the existing active-owner metric dictionary still governs current dashboards. The new owner can read prior events and add their own follow-ups; inherited entries cannot be edited as if newly authored by them. Deactivation may change live active-associate dashboard scope; finalised reviews preserve the reviewed figures.
