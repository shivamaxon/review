/**
 * Seeds reference data + one demo user per role. Safe to run more than once.
 *
 *   npm run seed                 create/refresh everything
 *   npm run seed -- --no-demo    reference data only (no demo users)
 *   npm run seed -- --remove-demo  delete (or, if they already have history, switch off) the demo users
 *
 * Needs .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Fill in .env.local first (see docs/SETUP.md).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const BRANCH = "Delhi NCR";
const PROJECTS = [
  { name: "Kudal", location: "Sindhudurg" },
  { name: "Tilari", location: "Dodamarg" },
  { name: "Club Lake Reserve", location: null },
];
const COLD_REASONS = ["Budget", "Location", "Family decision", "Comparing options", "Timing", "CP-managed", "Not interested", "Other"];
const NEXT_ACTIONS = ["Call", "Site visit", "Zoom", "Send price sheet", "Awaiting CP", "Payment follow-up"];
const CYCLE = [
  { label: "1-10", start_day: 1, end_day: 10 },
  { label: "11-20", start_day: 11, end_day: 20 },
  { label: "21-end", start_day: 21, end_day: null },
];
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "";
const DEMO = [
  { key: "super_admin", email: "demo.superadmin@example.com", name: "Demo Super Admin", role: "super_admin", designation: "CSO" },
  { key: "branch_admin", email: "demo.admin@example.com", name: "Demo Branch Admin", role: "branch_admin", designation: "Branch Head" },
  { key: "team_lead", email: "demo.lead@example.com", name: "Demo Team Lead", role: "team_lead", designation: "AGM" },
  { key: "associate", email: "demo.associate@example.com", name: "Demo Associate", role: "associate", designation: "Sales Associate", reportsTo: "team_lead" },
] as const;

function check<T>(label: string, r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data;
}

/** Same idea for auth admin calls, which return { data: { user }, error }. */
function checkUser(label: string, r: { data: { user: { id: string } | null }; error: { message: string } | null }): string {
  if (r.error || !r.data.user) throw new Error(`${label}: ${r.error?.message ?? "no user returned"}`);
  return r.data.user.id;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureBranch(): Promise<string> {
  const found = check("branch lookup", await db.from("branches").select("id").ilike("name", BRANCH).is("deleted_at", null).maybeSingle());
  if (found) return found.id;
  return check("branch insert", await db.from("branches").insert({ name: BRANCH, code: "NCR" }).select("id").single())!.id;
}

/** Insert rows whose `label`/`name` is missing; leave existing (possibly edited) rows alone. */
async function ensureRows(table: string, field: string, rows: Record<string, unknown>[], scope: Record<string, unknown> = {}) {
  let q = db.from(table).select(field).is("deleted_at", null);
  for (const [k, v] of Object.entries(scope)) q = q.eq(k, v as string);
  const have = new Set((check(`${table} lookup`, await q) as unknown as Record<string, string>[]).map((r) => r[field].toLowerCase()));
  const fresh = rows.filter((r) => !have.has(String(r[field]).toLowerCase())).map((r) => ({ ...scope, ...r }));
  if (fresh.length) check(`${table} insert`, await db.from(table).insert(fresh));
  return fresh.length;
}

async function seedReference(branchId: string) {
  const p = await ensureRows("projects", "name", PROJECTS);
  const c = await ensureRows("cold_reasons", "label", COLD_REASONS.map((label, i) => ({ label, sort_order: i + 1 })));
  const n = await ensureRows("next_action_types", "label", NEXT_ACTIONS.map((label, i) => ({ label, sort_order: i + 1 })));
  const r = await ensureRows("review_cycle", "label", CYCLE.map((x, i) => ({ ...x, sort_order: i + 1 })), { branch_id: branchId });
  console.log(`Reference data: +${p} projects, +${c} cold reasons, +${n} next-action types, +${r} review windows`);
}

async function seedDemoUsers(branchId: string) {
  if (DEMO_PASSWORD.length < 10) {
    console.error("Set SEED_DEMO_PASSWORD (10+ characters) in .env.local, or run with --no-demo.");
    process.exit(1);
  }
  const ids: Record<string, string> = {};
  for (const u of DEMO) {
    let id = await findUserIdByEmail(u.email);
    if (id) {
      checkUser("update demo login", await db.auth.admin.updateUserById(id, { password: DEMO_PASSWORD, email_confirm: true, ban_duration: "none" }));
    } else {
      id = checkUser("create demo login", await db.auth.admin.createUser({ email: u.email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: u.name } }));
    }
    ids[u.key] = id;
  }
  for (const u of DEMO) {
    check("upsert demo profile", await db.from("profiles").upsert({
      id: ids[u.key], branch_id: branchId, full_name: u.name, email: u.email, role: u.role, designation: u.designation,
      reports_to: "reportsTo" in u ? ids[u.reportsTo] : null,
      active: true, deleted_at: null,
      must_change_password: false, // demo logins skip the forced change so you can test quickly
    }));
  }
  console.log("\nDemo logins (password = SEED_DEMO_PASSWORD from .env.local):");
  for (const u of DEMO) console.log(`  ${u.role.padEnd(13)} ${u.email}`);
  console.log("\nBefore real use: run `npm run seed -- --remove-demo`.");
}

async function removeDemoUsers() {
  for (const u of DEMO) {
    const id = await findUserIdByEmail(u.email);
    if (!id) continue;
    // Order matters: profile first (it references auth.users). If the demo user already has history, keep the rows but lock the account.
    const del = await db.from("profiles").delete().eq("id", id);
    if (del.error) {
      await db.from("profiles").update({ active: false }).eq("id", id);
      await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
      console.log(`  switched off ${u.email} (it has history, so it cannot be deleted)`);
    } else {
      const gone = await db.auth.admin.deleteUser(id);
      if (gone.error) throw new Error(`delete demo login: ${gone.error.message}`);
      console.log(`  deleted ${u.email}`);
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--remove-demo")) return removeDemoUsers();
  const branchId = await ensureBranch();
  await seedReference(branchId);
  if (!args.has("--no-demo")) await seedDemoUsers(branchId);
  console.log("\nSeed finished.");
}

main().catch((e) => {
  console.error("\nSeed failed:", e.message);
  process.exit(1);
});
