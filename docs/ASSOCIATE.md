# Associate experience

The historical data is now loaded into the intended live project,
`jxduyylphokqpignybpz.supabase.co`. All **80** live reconciliation checks passed;
see [every expected and actual result](HISTORY_RECONCILIATION.md). No users were recreated.
A before/after check confirmed unrelated rows in all nine imported tables were unchanged.

## Live status

Migration **7 is already applied** to the intended project. Do not rerun it. The local production app passed 11 live database checks and 9 live phone-browser checks, including saving, older-entry audit, Undo, offline reload and reconnect. Every historical row fingerprint remained unchanged. See [database verification](ASSOCIATE_LIVE_VERIFICATION.md) and [browser verification](ASSOCIATE_LIVE_BROWSER.md), including the initial test-session cleanup/sign-out failures and their correction.

Restart locally with `npm run dev` to review. Publishing still requires the owner's approval; nothing was deployed during verification. No user-seeding or history reload is needed.

The migration adds entry receipts/cancellations, site-visit and nurture fields, private CP
contact numbers, the Hot target, save/undo functions, a scorecard and plot-conflict checks.
It supplies missing reason/action labels while preserving existing choices. It does not
replace imported history, reset logins, or invent target values.

## Screens

- **Today**: due and overdue customer/CP follow-ups with Log update and Call; current Hot
  leads untouched for 5+ days; period progress rings; the review commitments slot; assigned
  quality checks; a floating + for customer meetings, CP meetings and bookings.
- **Customer meeting**: live customer matching by name/phone, follow-up selection instead
  of duplicate creation, meeting chips, rating definitions, English-India/Hindi voice,
  configured next-action chips, date shortcuts, plots/site visits, Cold reason/nurture plan,
  optional phone, today’s date and the last-used project.
- **Customer detail**: the full interaction timeline, rating movement, follow-up with
  prefilled fields, linked bookings, booking conversion and links to correct older entries.
- **CP meeting/detail**: branch directory typeahead, name/firm/phone deduplication, personal
  CP timeline, sourced customers and attributed bookings. Shared directory information is
  visible within the branch; conversations and business records shown are the caller’s own.
- **Booking**: Token, Booking Done, Agreement Signed or Cancelled; cancellation reason;
  project/plot/value/date/source/CP; a branch conflict warning that reveals no other customer’s
  identity. Existing bookings/statuses can be corrected through My Sheet.
- **My Sheet**: own customer, meeting, CP-meeting and booking tabs; search, project/rating/date/
  history filters; editable cells and explicit Save row; original or flat Excel clipboard
  headers; quoted multiline/Hindi remarks; preview, validation and per-row import results.

Imported follow-up dates stay out of Today. A newly logged nonhistorical interaction on an
imported lead becomes current work without erasing that lead’s historical provenance.
Period metrics still include relevant historical work. New Hot entries need a plot and a
next-action date within seven days of the meeting. Cold customer entries need a reason.
Closure/token language on a Cold entry and past next dates produce warnings, not blockers.

Customer definitions were read from the supplied original template (Udit Nigam A10).
That workbook contains no CP definition legend. The CP defaults are explicit in
`src/lib/associate/common.ts`: Active = actively sourcing; Hot = business likely within
10 days; Warm = interested without immediate business; Cold = inactive/not interested.
These can be replaced with the owner’s wording when supplied.

## Drafts, offline use and Undo

Typing writes an account-scoped local draft immediately, including speech and spreadsheet
edits. Saving first creates a durable queue item on the phone, before any network request.
Each item has a fixed request ID. A lost response can be retried without another meeting.
Pasted rows retain their IDs across reloads/retries, with repeated rows distinguished.

The pending-sync badge is visible whenever work remains. The queue retries on reconnect
and when the app is reopened. Keep the app open/reopen it to sync: browser background sync
is not required. Validation errors remain visible with the saved entry. Retry is available.
No draft/queue item can sync into a different signed-in account; both the server action and
SQL function verify ownership. Sign-out removes the active offline workspace marker while
retaining that account’s pending work for its next sign-in. Do not clear browser/site storage
while entries are pending.

The public service worker precaches **only** the offline document, code, fonts and icons.
It never caches authenticated HTML, API replies or Supabase responses. The offline workspace
loads the last account-scoped local snapshot. Open the app online once before relying on
an offline reload. Private drafts and the local snapshot are device storage, not server-worker
response caches. They are not sent to another account.

Saved entries offer an Undo toast. Synced Undo is available for 10 minutes and refuses to
replace a subsequently changed entry or a newer conversation. Offline Undo queues a
cancellation using the original request ID; SQL cancellation markers prevent delayed
original saves from reappearing. Undo uses soft deletion/restoration and retains audit and
booking-status history. Corrections are also available later through My Sheet.

## Database and security

`associate_save` performs parent creation and interaction/booking writes in one transaction.
The associate ID always comes from authentication. It uses request locks, deduplicates new
customers by normalized name or phone within the owner, and finds CPs within the branch.
Only allowed fields can be corrected. Edits verify the last-read `updated_at` so stale rows
cannot overwrite another device’s update. Interaction guards are suspended only inside the
checked, locked transaction; audits remain enabled, and errors restore guards automatically.

Older rating corrections recompute subsequent `rating_before` values and refresh the lead
from its newest live interaction. CP history changes remain within the caller’s meetings.
Direct arbitrary edits to append-only tables are still blocked. Audit rows retain both
before and after. SQL also checks active status and the forced-password-change gate.

`associate_scorecard(from,to)` is the metric dictionary for the four rings: meeting rows,
Hot leads after the last meeting in the period, CP meeting rows, and booking_done +
agreement_signed. Monthly targets are prorated by calendar days and rounded up. No target
row means Target not set. No KPI is recomputed in the browser.

Plot choices come from known own plots/bookings with an option to enter another plot;
there is no fabricated plot inventory. `plot_conflicts` checks branch-wide Hot/reserved
counts without exposing another associate’s lead name or phone. Warnings remain soft.

## Install on a phone

Use the hosted HTTPS address (or localhost while developing).

- **Android / Chrome**: open the app, tap the browser’s **⋮** menu, then **Install app** or
  **Add to Home screen**, then confirm **Install/Add**.
- **iPhone / Safari**: open the app, tap **Share**, choose **Add to Home Screen**, then **Add**.

Voice depends on browser support and microphone permission; English and Hindi can be
selected next to Speak. Unsupported/denied voice access gives a typing fallback. Actual
speech recognition and installation should also be checked on the associates’ real phones.

## Validation

- `npm run test:db`: RLS, triggers, metric dictionary, atomic entry, duplicate detection,
  guarded older edits, rating-chain repair, retries, cancellations and Undo in PostgreSQL.
- `npm run test:history`: actual private workbook, import twice, all 80 checks, quality
  actions, rollback, trigger recovery and decision preservation under migration 7.
- `npm run test:associate`: clipboard parsing, dates, ownership validation, guardrails,
  warnings, deterministic paste IDs and local queue persistence/isolation.
- `npm run test:ui`: phone-sized Chrome against a **separate production build and local
  PostgreSQL fixture**, never live customer records. Tests new Hot/follow-up timing,
  duplicate capture, 48px buttons, own-record visibility, inline audit, CPs, booking conflicts,
  Hindi speech callback handling, draft recovery, sync, Undo and full PWA offline reload.
  Needs Google Chrome installed, or adjust Playwright’s channel for a CI-installed Chromium.
- `npm run typecheck`, `npm run lint`, `npm run build -- --webpack`, `npm run db:bundle`.

Playwright and Tailwind’s standard PostCSS adapter are the only new development dependencies.
PostCSS fixes styling under both Next.js bundlers. Test artifacts and the separate E2E build
are ignored by Git. The production app has no test authentication bypass.

## Plain-English phone test checklist

- [ ] Apply migration 7 once and open Today as an associate.
- [ ] Time a new Hot customer: name → Hot → plot → Save. Aim for under 30 seconds.
- [ ] Type that name again: choose Log follow-up rather than making another customer.
  Change the remark and save in under 15 seconds.
- [ ] Check a Cold entry cannot save without a reason; a past next date and booking language
  produce clear warnings. Try both English and Hindi on the actual phone microphone.
- [ ] Call a due customer, log an update, and confirm its next step and rating timeline.
- [ ] Log an Active CP meeting and confirm its green rating and private timeline.
- [ ] Convert a customer to a booking, check a conflicting plot warning, then update its
  status in My Sheet. Cancelled must have a reason.
- [ ] Correct an older remark/rating in My Sheet; check the timeline and admin audit trail.
- [ ] Paste two Excel rows, inspect every preview, fix errors, and import. Reconnect/retry
  and confirm the same rows are not duplicated.
- [ ] Type a remark, reload, and check it survives. Switch offline, save, check Pending sync,
  reconnect and confirm one saved entry. Repeat with Undo before reconnecting.
- [ ] Install the PWA, open it online once, then reopen fully offline and log a conversation.
- [ ] Sign in to a second associate: the first associate’s leads, private meetings, drafts
  and queued entries must not appear or sync into the second account.
- [ ] Check Today has no old imported follow-up flood, and the last-review slot has a clear
  empty state until review commitments are recorded.
