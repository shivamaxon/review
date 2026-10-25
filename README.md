# Branch Review OS

An internal sales workspace for plotted-land branches: quick meeting entry on a phone, branch analysis, and a guided ten-day review with frozen scorecards and agreed commitments.

**Current state:** migrations 1–8 are installed to the intended live Supabase project. Migrations **9 and 10 are local and await approval**. Review Mode is locally tested; no new migration or deployment was applied during its implementation. Follow [the production checklist](docs/PRODUCTION.md) before going live. Never paste the complete migration bundle over an existing database.

## Run one full review

1. Sign in as a branch admin or team lead. Open **Review**.
2. Choose the associate and From/To dates. Choose **Walk through everyone one by one** to continue through your permitted people. Click **Start review**.
3. Use **Full-screen review** if presenting. Discuss the target/previous-cycle scorecard, changes, earlier commitments and the questions. Each question opens its customer, CP or booking.
4. Write the admin notes. Enter an action, its owner and due date. Click **Save notes / add action**. Repeat for more actions. Use **Remove draft action** to correct a mistaken draft before finalising. To carry an open commitment forward, select it instead of entering new text and choose its due date.
5. Click **Finalise review**. Optionally tick **Also lock entries** first. The saved KPI snapshot, notes, questions, details and agreed actions cannot be overwritten. Finalising again returns the same snapshot.
6. Click **Export old Master format**. The file has the old Master section order and one sheet per associate. It uses documented SQL definitions, including Agreement Signed as a confirmed booking. Customer phone cells are intentionally empty.
7. Click **Printable pack** → **Print / Save PDF**, or **Print whole branch** for multiple people, one person per print section.
8. The action owner signs in and opens **Today** → **Commitments from your last review**, writes a completion comment and clicks **Mark done**. Draft actions are hidden until finalisation.

A locked meeting/CP meeting/booking cannot be edited, removed, moved into/out of the window or undone by an associate. An admin can open the record link and use **Admin correction**; the correction is audited and the frozen review stays unchanged. New entries dated inside a locked window are also blocked. Finalisation is permanent; start another review rather than rewriting the old one.

## Add an associate

1. Sign in as branch admin or super admin. Open **Team** → **Add a person**.
2. Enter name and email, choose Associate, manager and designation. A super admin also chooses the branch.
3. Click Create. Copy the one-time temporary password and give it privately to that person; the app sends no emails. Never put passwords in the repository, a deck or a shared spreadsheet.
4. They sign in and choose their own password. Until setup is complete, database policies block operational data even through the API.
5. Open **Settings** → **Monthly targets**. Choose the associate and month; enter meetings, Hot leads, CP meetings and booking targets. Save. Review windows use calendar-day proration.

To reset a password or deactivate/reactivate a person, use their row in **Team**. When someone leaves, use **Reassign a leaver’s leads** to move all active leads to a different active associate in the same branch. The new owner can read the history and customer contact; original meeting/booking authors remain unchanged. Historical credit is not reassigned. Removed leads stay in Recycle bin and are not moved by this operation.

## Add a branch

1. Sign in as **super admin**. Open **Settings** → **Add a branch**.
2. Enter the branch name and optional code, then Add. The app creates P1 (1–10), P2 (11–20) and P3 (21–month end). No migration is needed.
3. Switch Settings to that branch, add its people in Team and set targets.
4. Open **Branches** for comparisons, or Command’s branch selector for one branch / all branches.

Team leads see their reporting tree. Branch admins see their branch. Super admins can choose any branch. Projects, cold reasons and next-action choices are company-wide; review windows, targets and ask thresholds are branch-specific.

## Settings, corrections and audit

**Settings** controls projects, cold reasons, next-action types, review windows, monthly targets and all nine ask-rule switches. Change day thresholds for Hot no-touch, Warm no-movement, token age and CP lead inactivity. Other rules use their fixed condition; their day field does not change that condition. Review windows cannot overlap; a missing configured day uses the documented fallback cycle.

Open any customer/interaction/CP/booking record from Explorer or a review question. Admins can correct an allowed field or **Soft-delete record**. Open **Settings → Recycle bin** to restore it. Restoring a customer does not restore removed child entries automatically. Source data remains intact until an authorised correction is made.

**Settings → Audit log** shows the actor, timestamp, record, and before/after values. Filter by table, record UUID, actor or dates. Only admins can see audit payloads. **Settings → Export any table as CSV** exports the permitted scope, including removed records. Explorer also exports filtered CSV/XLSX and supports saved shared searches.

## Restore from the nightly export

The application repository is public. **Never upload customer CSVs as public GitHub artifacts.** The updated nightly workflow skips public repositories. Use a separate **private backup repository** with `scripts/export-csv.mjs` and the workflow, or run the export into protected offline storage. Keep its Supabase service key and optional encryption passphrase in GitHub Actions secrets, not files. Check successful backups regularly; artifacts expire after 14 days. Export includes review snapshots, commitments, settings and audit, but not Supabase Auth users/passwords.

1. Download the required successful private backup. If encrypted, keep its passphrase private and run locally:

   ```sh
   openssl enc -d -aes-256-cbc -pbkdf2 -in backup.tar.gz.enc -out backup.tar.gz
   tar xzf backup.tar.gz
   ```

2. Take a fresh backup before restoring. Use the original downloaded CSVs; opening and resaving them in Excel can change phone, UUID and date values. Keep the downloaded files outside Git or inside ignored `export/`. First rehearse recovery in an isolated copy with the same schema and original Auth user UUIDs.
3. From the project directory, prepare a reviewable SQL file:

   ```sh
   node --import tsx scripts/prepare-restore.ts /path/to/extracted/export export/recovery.sql
   ```

   This command does **not** contact a database. It requires the complete compatible table set. The generated file contains private data; do not share or commit it.
4. Confirm the intended project, backup date, Auth IDs and migration versions. In that project’s Supabase **SQL Editor → New query**, paste `export/recovery.sql` and Run only after approving the recovery. The SQL merges matching IDs in one transaction, temporarily suspends user triggers to restore stored caches/snapshots faithfully, restores triggers and preserves existing audit evidence. Failure rolls back. No tables are truncated.
5. Sign in, check record counts, frozen reviews, commitments and one customer timeline. Run the dictionary/security tests in the recovery environment and compare known totals before reopening access.

This is **merge recovery**, not a full point-in-time rewind: newer rows absent from the backup remain; matching rows are replaced by their backed-up values. Blank CSV strings and NULL are not distinguishable in the original CSV export. CSV does not rebuild lost Auth accounts, passwords, storage objects or database settings. For a total database/Auth disaster or exact point-in-time recovery, use a full Supabase database backup and its restoration procedure; do not create replacement UUIDs and hope foreign keys line up. Old exports missing newly added tables need a compatible schema/recovery plan before use.

## Change a metric definition safely

1. Write the intended definition and an example in [docs/metrics.md](docs/metrics.md).
2. Ask the developer to add a **new migration**, update the SQL dictionary and add a known-data test. Never patch already-applied migrations or calculate a different KPI in a screen/export.
3. Run database, artifact and browser tests in an isolated project. Review the exact underlying rows and exports.
4. Back up, approve the migration, apply it once and deploy approved code. Recheck totals and explain intentional differences. Historical reconciliation is a separate source baseline; do not suppress a mismatch.
5. Old finalised review snapshots stay as originally reviewed. Their metric basis is stored in the snapshot; a new definition applies to future reviews.

## If the app or database is paused

1. Open your Supabase dashboard and select the intended project. If it says Paused, click **Restore project** / **Resume** and wait until Healthy. Check current platform status if it remains unavailable.
2. Reopen the app and sign in. Pending phone entries remain on that phone; reconnect and Retry. Do not clear browser storage or reinstall while unsynced entries remain.
3. If Supabase is healthy but hosting is paused, open the Netlify project and inspect Deploys / account usage. Resume the project when offered, then redeploy the approved commit if needed. Do not reset the database or run the loader.
4. Contact the administrator with the friendly error reference. Login fails closed if its rate-limit store is unavailable; resume the database instead of bypassing the limit.

## Present safely with demo mode

Create a **separate empty Supabase project** and apply the fresh-install migration bundle there. Set `DEMO_SUPABASE_URL`, `DEMO_SUPABASE_SERVICE_ROLE_KEY` and a private `DEMO_PASSWORD` (12+ characters) in your ignored local environment. Run `npm run seed:demo`. The script refuses the intended production project, the configured real URL, branches not marked as demo and non-demo login emails. It creates fictional customers, plots, transactions, targets and example.invalid logins. Re-running reuses the existing fictional records.

Run the seeder from the main checkout while its normal NEXT_PUBLIC_SUPABASE_URL still identifies the real project; DEMO_SUPABASE_URL must be different. Then run a separate local/hosted app configured with the demo project’s normal three runtime variables. Its branch banner says **DEMO MODE · Fictional customers and business only**. The real app has no public demo bypass or role impersonation. Do not put the demo service key in the browser or point a presentation deployment at production. Use only the demo deployment for leadership screen-sharing.

## Developer commands and guides

`npm run dev` · `npm run test:db` · `npm run test:review` · `npm run test:associate` · `npm run test:history` · `npm run test:ui` · `npm run typecheck` · `npm run lint` · `npm run build -- --webpack` · `npm run db:bundle`.

- [Production checklist and Netlify/Vercel instructions](docs/PRODUCTION.md)
- [Review implementation and test checklist](docs/REVIEW.md)
- [Admin analysis](docs/ANALYSIS.md), [associate experience](docs/ASSOCIATE.md), [metric dictionary](docs/metrics.md)
- [Original setup](docs/SETUP.md), [historical import](docs/HISTORY.md), [project rules](CLAUDE.md)
