# Load the flat historical workbook

The source is `data/Axon_NCR_Review_Database_Import.xlsx` (kept out of Git).
No messy-workbook parser is involved. Future paste-from-Excel entry should use these flat
sheet headers. The loader reads only users, projects, cp_firms, channel_partners, leads,
interactions, cp_interactions, bookings, issues. README is never imported. Reconciliation
is read only by the verification script, never stored as application data.

## Apply the new schema to an existing Supabase project

1. Open your Supabase project, choose **SQL Editor** in the left menu, then **New query**.
2. Open `supabase/migrations/20260101000006_history.sql` in your editor, select all, and copy.
3. Paste into SQL Editor and click **Run**. Run this new migration once. The old migrations
   must already be installed; do not paste the whole bundle over an existing database.
4. Back in Terminal, from the `branch-review-os` folder, run:

   ```sh
   npm run seed:users
   npm run load:history
   npm run verify:history
   ```

   The scripts use `.env.local` and the service role. If your file is elsewhere, pass
   `-- --file /path/to/Axon_NCR_Review_Database_Import.xlsx` to each command (or set `IMPORT_XLSX`).
5. Check the final line says **All 80 historical verification checks PASS**. The table prints
   actual and expected numbers for every associate plus the branch totals.
6. Start the app (`npm run dev`), log in as an admin, and open **Quality**.

## What a rerun does

One server RPC is one transaction per table. Failed tables roll back completely, including
any suspended triggers. Earlier tables stay committed so the import can resume. Unknown
text keys fail before a table write. Seeded project UUIDs are reused by project name.
Users must already exist from seed-users; the loader does not change passwords or roles.

`legacy_key` is the upsert key. Unchanged source rows are skipped, preserving subsequent
live work and admin corrections. Rows linked to accepted/resolved issues are also protected
from replacement by changed workbook rows. The original row is stored in `raw_json`.
Interaction state/rating-before/append-only triggers and booking derived-state triggers
are suspended only within the locked table transaction. Audit remains on. Bookings get one
initial status-history entry, without changing the lead status supplied in the workbook.
Ordinary writes regain their original triggers when the RPC finishes.

Missing ratings and booking dates remain unknown; missing booking values remain NULL.
The flat workbook actually includes some CP dates in April. Nothing is silently shifted
into the requested May–October range. Each issue preserves its original source references;
some reference several source row numbers or have no retained record (a source-level issue).

## Quality decisions

The inbox groups severity and issue type, with the three `plot_double_booked` issues first.
The two bookings are displayed in source order as A and B, with record links, customer,
associate, project/plot/date/status/value, and remarks.

- **Fix** edits one allowed field on a linked record and resolves the issue. Enter dates as
  YYYY-MM-DD, enum values in snake_case, and multiple plots separated by `|`. Blank = unknown.
  The before/after correction is audited; interaction corrections refresh the cached state.
- **Mark OK** accepts the issue without changing its underlying record.
- **Assign to associate** creates an explicit data-check task on that person's home screen.
  It does not transfer ownership or grant access to another associate's private records.
- **Keep A / Keep B** soft-deletes the competing booking. It stays available through the
  issue's record link and audit log but no longer contributes to metrics.
- **Both valid** accepts the conflict and retains both bookings.

A decision cannot be repeated after the issue is resolved/accepted. Only admins can mutate
issues; branch admins are restricted to their branch. Associates can read assigned issues
and follow record links where their existing RLS permissions allow access.

## Plain-English test checklist

- [ ] Before making quality corrections, run verification: every line says PASS and totals
  match 291 meetings (43/153/91/4), 292 CP meetings, 20 bookings and ₹50,222,126.
- [ ] Run the loader again: no duplicate leads, meetings, bookings or initial status entries.
- [ ] Admin → Quality shows 250 issues with the three double-booked plots at the top.
- [ ] Open each competing booking link; compare the customer, associate, project, plot,
  status, date and value side by side.
- [ ] In a test database, try Keep A, Keep B and Both valid on separate conflicts. Confirm
  the chosen result, issue status and audit record. These decisions change real totals.
- [ ] Fix a remark inline; the saved correction opens from the issue link and survives a reload.
- [ ] Mark an issue OK; it disappears from Open and appears under All statuses.
- [ ] Assign a check to an associate; it appears under their Assigned data checks.
- [ ] An associate cannot open the admin inbox or resolve issues. A branch admin cannot act
  on another branch's issues.
- [ ] Today has no old imported follow-ups. Explorer, Command and Quality include historical
  data by default; their history toggles hide it.
- [ ] Run `npm run test:db`, `npm run test:history`, `npm run typecheck`, `npm run lint`, and
  `npm run build` (or `npm run build -- --webpack` if the local Turbopack worker cannot start).

`test:history` uses the actual workbook in an isolated PostgreSQL database, exercises the
production loader and verifier twice, and checks rollback, trigger recovery, issue actions,
RLS, audit and preservation of decisions on re-import. It needs the local ignored workbook;
it is intentionally separate from CI's workbook-free security tests.
