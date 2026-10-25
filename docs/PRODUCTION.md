# Production checklist and deployment

No deployment, database migration, region change, password reset or production-data modification was performed for Review Mode. The intended live project is `jxduyylphokqpignybpz`. Its region has **not** been independently confirmed. Read-only checks on 25 October 2026 confirmed migration 8 is already installed. Review Mode needs approved migrations **9 → 10** and the matching application code.

The subsequent owner-authorised 25 October access update reset temporary credentials for the 10 existing app accounts and required a password change. No customer/business records or migrations were changed.

## Before approval

- [ ] Keep a current, private backup; rehearse the README recovery steps with the original Auth UUIDs. The public app repository must never receive customer-data artifacts. The new backup workflow skips public repositories; that protection takes effect remotely only when this code is pushed.
- [ ] Supabase project → Settings → General / project details: confirm **South Asia (Mumbai), `ap-south-1`**. [Supabase region list](https://supabase.com/docs/guides/platform/regions). For a new project select Mumbai when creating it. Moving an existing region is a separate approved migration, not an app setting.
- [ ] Authentication → Sign In / Providers: public sign-ups OFF. Use Admin → Team for account creation. Replace any legacy predictable temporary passwords with randomly generated resets and distribute privately before launch. The new password gate blocks operational data until setup completes.
- [ ] Three runtime variables configured on the host: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Only URL/anon key are public. The service key must have **no** `NEXT_PUBLIC_` prefix and must never appear in a client bundle, screenshot, repository or printed log. Do not set seed/demo passwords on the production host.
- [ ] Keep `.env.local`, workbook/data, exports, recovery SQL, dependencies and build outputs ignored. Do not weaken `.gitignore`. Review staged files for actual credentials before a push. CI uses placeholder public configuration and no live service key.
- [ ] Read and approve each SQL file. Apply **only** `20260101000009_review.sql`, then `20260101000010_privacy.sql`, once each in Supabase SQL Editor. Never run the full fresh-install bundle on this live database. No re-seeding or history reload is needed.
- [ ] Check privacy through the database API as well as the UI: a team lead cannot select `leads.phone`, source JSON or receipt contact payloads directly. `record_read` returns contact/source fields only for the current owning associate or the branch/super admin. Other associates see no foreign leads. After reassignment the former author cannot retrieve the transferred contact through source JSON. Operational remarks are shared within reviewer scope: keep phone numbers in the dedicated contact field, not free-text remarks.
- [ ] Treat offline phone workspaces as private device data. Server-side deactivation/reassignment cannot remotely erase an already-downloaded offline copy. Before handing over a leaver’s device, sync pending work, sign out and clear that app’s local storage; use a separate demo project for presentations.
- [ ] Check team-lead tree, branch-admin scope, super-admin all-branch view, temporary-password gate, review locks and immutable snapshots. Unauthenticated visitors must reach sign-in, never customer data.
- [ ] Check the standalone PWA on actual phones, microphone permissions, Hindi/English recognition, keyboard navigation and PDF print layout. Browser automation cannot replace testing physical microphone permissions or installation.
- [ ] Approve the exact deployment commit separately. Until migration 10 is applied, its new API/column privacy protections are not live. Avoid deploying the new UI against an incomplete schema. Schedule a short maintenance window: migration 10 changes direct read permissions and password-setup behavior, so deploy the matching code immediately rather than leaving an old release running against it.

## Deploy to Netlify (recommended)

[Netlify supports Next.js through its automatic adapter](https://www.netlify.com/knowledge-base/how-to-deploy-nextjs-astro-nuxt-or-sveltekit-to-netlify/). No static export or SPA catch-all redirect is appropriate: this app uses authenticated server rendering and server actions.

1. After code/migration approval, save the approved code in GitHub. Sign in to Netlify → **Add new project → Import an existing project → GitHub**, then select the repository.
2. If asked, choose `branch-review-os` as Base directory **only if** it is a subfolder in the repository. In the current repository `package.json` is at the root, so leave Base directory empty. Choose branch `main`.
3. Set Node.js to **22**. Build command: `npm run build -- --webpack`. Publish directory: `.next`. Netlify detects Next.js and installs its adapter automatically; do not choose `out` or a static-only deployment.
4. Before triggering the deploy, open **Project configuration → Environment variables** and add the three runtime variables from your private configuration. Include build/runtime scope as offered; the service key stays server-side. [Netlify environment variable documentation](https://docs.netlify.com/configure-builds/environment-variables).
5. Run the first deployment against a separate demo/staging Supabase project to approve the screen flow. A preview connected to live Supabase can still write real records; do not treat a preview URL as a sandbox.
6. After approving the live migrations and production deployment, set the production variables to the intended project and deploy the approved commit. Open the generated HTTPS URL. Set your custom domain if wanted.
7. In Supabase Authentication → URL Configuration, set Site URL to the approved domain and allow exact preview URLs only when needed. Email/password sign-in does not require enabling public sign-ups or sending magic links.
8. Perform the Review checklist with fictional staging data first, then a read-only smoke check on live data. Run one real review only with the owner’s agreement. Confirm exports remain private, finalisation freezes the review, Home commitments publish and locked corrections require an admin.
9. Keep the previous host deployment available for code rollback. Database migrations are additive; do not automatically reverse them or reload history when rolling back code. Follow a reviewed rollback plan because migration 10 deliberately changes direct column access.

## Vercel alternative

Vercel detects Next.js automatically. Import the approved GitHub repository, keep root at `package.json`, use Node 22 and the same build command and runtime variables. For a local preview without pushing, run `npx vercel login`, `npx vercel link`, add the three variables for Preview, then `npx vercel deploy --target=preview`. Keep deployment protection enabled. CLI uploads must continue to exclude secrets, workbooks and exports; no migration is run by deployment.

Vercel Hobby is restricted to personal, non-commercial use; this business app requires an appropriate plan. [Vercel fair-use documentation](https://vercel.com/docs/limits/fair-use-guidelines). Review actual plan limits and pricing before choosing a paid option; this implementation purchased no services.

## Backups and operation

Use a private backup repository/vault, not the public application repository’s artifacts. Store Supabase keys only as encrypted hosting/GitHub secrets. Optional encrypted backups require `EXPORT_PASSPHRASE`; keep an offline copy of that passphrase. A lost passphrase cannot be recovered from the app. GitHub artifacts expire after 14 days; copy important recovery points to protected long-term storage. Supabase Auth accounts and full platform recovery require a database/Auth backup in addition to CSV.

The keep-alive workflow only calls `ping`; it does not back up data or guarantee a free project never pauses. If paused, use the README recovery instructions, retain phone queues and do not seed/import again.
