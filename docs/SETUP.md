# Setup guide (no coding needed)

You will do five things: **(1)** create the database, **(2)** run the app on your Mac, **(3)** put the code on GitHub,
**(4)** publish it on the internet, **(5)** switch on the automatic backups.
Everything below is free. Screens on these websites change now and then; if a button has a slightly different name, look for the closest one.

> **Golden rule:** two of the keys you will copy are secret (the *service_role / secret* key and your database password).
> Never paste them into WhatsApp, email, or a chat. They only go in the places named below.

---

## 1. Create the database (Supabase)

1. Go to **supabase.com** → **Start your project** → sign up (GitHub or email).
2. Click **New project**. If asked, create an *organization* (any name, plan **Free**).
3. Fill in:
   - **Name:** `branch-review-os`
   - **Database password:** click **Generate a password**, then **save it in a password manager**. You rarely need it again.
   - **Region:** **South Asia (Mumbai)**
   - Plan: **Free**
4. Click **Create new project** and wait ~2 minutes.
5. **Copy your keys.** Left menu → ⚙ **Project Settings** → **API Keys** (or **API**). You need three things:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon** key (also called *public*; if you only see "publishable", that works too)
   - **service_role** key (also called *secret*; you may need to click **Reveal**) — this one is SECRET.
   (If you see tabs "Publishable and secret API keys" / "Legacy API keys", either set works.)
6. **Create the tables.** Left menu → **SQL Editor** → **New query**.
   On your Mac open the file `supabase/all_migrations.sql` in this project (right-click → Open With → TextEdit), select all (⌘A), copy (⌘C), paste into the SQL Editor (⌘V), click **Run**.
   You should see **Success. No rows returned.** (If you ever see a red error, copy the message and ask for help; do not run it twice.)
7. **Switch OFF public sign-ups** (so only admins can create users). Left menu → **Authentication** → **Sign In / Providers** → at the top, section **User Signups** → turn **OFF** "Allow new users to sign up" → **Save**.
   (Admins creating users from the app still works: it uses the secret key, which is not a "sign-up".)
   Also on that page, leave **Anonymous sign-ins** OFF.
8. **Password length.** Same page → expand **Email** → **Minimum password length**. Supabase's default is 6. The app itself demands 8+ when someone chooses their own password, so you can leave this alone.
   (You *could* try lowering it, but I don't recommend it and haven't verified how low the dashboard allows. The starting passwords are temporary anyway.)

## 2. Run it on your Mac

1. Install **Node.js** (the "LTS" button) from **nodejs.org**, accept the defaults.
2. Open **Terminal** (⌘-Space, type *Terminal*). Type `cd ` (with a space), drag the `branch-review-os` folder onto the Terminal window, press Enter.
3. Run these one at a time:
   ```
   cp .env.example .env.local
   open -e .env.local
   ```
   A text window opens. Paste the three values after the `=` signs (URL, anon key, service_role key) and choose any password of 10+ characters for `SEED_DEMO_PASSWORD`. Save and close.
4. ```
   npm install
   npm run seed
   npm run dev
   ```
   `npm run seed` prints four demo logins (super admin, branch admin, team lead, associate), all with your `SEED_DEMO_PASSWORD`.
5. Open **http://localhost:3000** in your browser and sign in. Associate lands on **/home**, the others on **/command**.

## 3. Put the code on GitHub

1. Go to **github.com** → sign up → **+** (top right) → **New repository**.
   Name `branch-review-os`, choose **Private** (important: backups contain customer phone numbers), **do not** tick "Add a README". **Create repository**.
2. Easiest way: install **GitHub Desktop** (desktop.github.com), sign in, **File → Add Local Repository…** → pick the `branch-review-os` folder → **Commit to main** → **Publish repository** (keep "Keep this code private" ticked).
   *(Terminal alternative, run inside the folder:* `git add -A && git commit -m "First version" && git branch -M main && git remote add origin https://github.com/YOUR-NAME/branch-review-os.git && git push -u origin main` *)*
   Your `.env.local` is **not** uploaded (it is excluded on purpose).

## 4. Publish it (Netlify, free)

*Why Netlify and not Vercel:* Vercel's free "Hobby" plan is for non-commercial use only; Netlify's free plan allows business use. The app works on either.

1. Go to **netlify.com** → **Sign up** → **with GitHub**.
2. **Add new site → Import an existing project → GitHub** → allow access → choose `branch-review-os`.
3. Leave the build settings as detected (Next.js, `npm run build`).
4. Before deploying, open **Environment variables** (on this page or later in *Site configuration → Environment variables*) and add:

   | Name | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Project URL | |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key | |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role key | tick **Contains secret values** |

5. Click **Deploy**. When it finishes you get a link like `https://something.netlify.app` (rename it under *Site configuration → Change site name*).
6. Open the link on your phone, sign in, then use the browser menu → **Add to Home Screen** to install it like an app.

*(Vercel instead: vercel.com → Add New → Project → import the repo → add the same three variables → Deploy. Check their terms first.)*

## 5. Automatic backups and "never sleep"

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Secret name | Value |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `EXPORT_PASSPHRASE` | *(optional)* any long phrase; encrypts the backup file |

Then **Actions** tab → **Keep database awake** → **Run workflow** (green tick = working). Do the same once for **Nightly CSV backup**.
To download a backup: Actions → Nightly CSV backup → click a run → **Artifacts** at the bottom.
If you set `EXPORT_PASSPHRASE`, unlock it with: `openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:YOUR-PHRASE -in backup.tar.gz.enc | tar xz`

## Create the real team logins (from the Excel `users` sheet)

1. Create a folder called `data` inside the project and drop `Axon_NCR_Review_Database_Import.xlsx` into it. (`data/` is never uploaded to GitHub.)
2. Make sure `.env.local` has the URL and the **service_role** key (step 2 above) and that migration 5 was run (`supabase/all_migrations.sql` includes it; if you ran the file before, run just `supabase/migrations/20260101000005_legacy_key_and_login_limits.sql` in the SQL Editor).
3. Preview first (changes nothing): `npm run seed:users -- --dry-run`
4. Do it: `npm run seed:users`
5. You get a table (email, role, status) in the Terminal only. Re-running is safe: people who already exist are skipped and their passwords are never touched.

Starting passwords: associates = their lowercase first name; if that is shorter than Supabase's minimum, `firstname123`; the admin = the email address itself. The script tells you who got the fallback. **Everyone must choose a new password at first login**, so hand the logins out in person / by phone and ask people to log in soon: until they do, anyone who knows the name could sign in as them.
Two Anoops (Soni and Sharma) get the same starting password; they have different emails so it is harmless, and each must change it.

## Before real people use it

1. Sign in as the demo **Branch Admin** → **Team** → add your real people (each gets a temporary password to pass on; they must choose their own at first login).
2. If you ran `npm run seed` with demo users, remove them: `npm run seed -- --remove-demo`. (Or run `npm run seed -- --no-demo` from the start.)

## If something goes wrong

- **"Email or password is wrong"** for a new person → Team → *Reset password*.
- **Blank/500 page after deploy** → a variable name was mistyped in Netlify; fix it and *Deploys → Trigger deploy*.
- **App says "Your account isn't set up yet"** → the login exists but has no team profile; create them under Team.
- **Supabase says the project is paused** → *Restore*, then check the Keep-awake workflow ran.
