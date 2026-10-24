/**
 * Creates the real logins from the `users` sheet of the import workbook.
 * Run from YOUR machine only. Needs .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * The service-role key never goes into browser code and never into git (.env.local is git-ignored).
 *
 *   npm run seed:users                      create everyone not already there
 *   npm run seed:users -- --dry-run         show what WOULD happen, change nothing
 *   npm run seed:users -- --file path.xlsx  use a different workbook
 *
 * Safe to re-run: people who already exist are skipped (their password is never touched).
 * Passwords are computed in memory and never printed, logged or written to a file.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

type Role = "associate" | "team_lead" | "branch_admin" | "super_admin";
const ROLES: Role[] = ["associate", "team_lead", "branch_admin", "super_admin"];

type Row = {
  user_key: string; full_name: string; first_name: string; email: string; role: Role;
  designation: string | null; reports_to: string | null; branch: string;
};
type Result = { email: string; role: string; status: string };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.includes("--file") ? args[args.indexOf("--file") + 1] : undefined;
const FALLBACK_SUFFIX = "123";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Fill in .env.local first (see docs/SETUP.md).");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function findWorkbook(): string {
  const candidates = [fileArg, process.env.IMPORT_XLSX, "data/Axon_NCR_Review_Database_Import.xlsx", "../Axon_NCR_Review_Database_Import.xlsx"]
    .filter((p): p is string => !!p).map((p) => resolve(p));
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) {
    console.error("Could not find Axon_NCR_Review_Database_Import.xlsx. Put it in ./data/ or pass --file <path>.\nLooked in:\n  " + candidates.join("\n  "));
    process.exit(1);
  }
  return hit;
}

const text = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object" && "text" in v) return String(v.text ?? "").trim(); // hyperlink cells (mailto:)
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  return String(v).trim();
};

async function readUsers(path: string): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet("users");
  if (!ws) throw new Error('The workbook has no sheet called "users".');
  const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => text(v).toLowerCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 1) throw new Error(`The users sheet has no "${name}" column.`);
    return i;
  };
  const c = Object.fromEntries(["user_key", "full_name", "first_name", "email", "role", "designation", "reports_to", "branch"].map((n) => [n, col(n)]));

  const rows: Row[] = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    if (n === 1) return;
    const get = (k: string) => text(r.getCell(c[k]).value);
    if (!get("email") && !get("user_key")) return;
    rows.push({
      user_key: get("user_key"), full_name: get("full_name"), first_name: get("first_name"),
      email: get("email").toLowerCase(), role: get("role") as Role,
      designation: get("designation") || null, reports_to: get("reports_to") || null, branch: get("branch"),
    });
  });
  return rows;
}

function validate(rows: Row[]) {
  const problems: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const where = `row ${i + 2} (${r.email || r.user_key || "?"})`;
    if (!r.user_key) problems.push(`${where}: user_key is empty`);
    if (!r.full_name) problems.push(`${where}: full_name is empty`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) problems.push(`${where}: email is not valid`);
    if (!ROLES.includes(r.role)) problems.push(`${where}: role "${r.role}" is not one of ${ROLES.join(", ")}`);
    if (!r.first_name) problems.push(`${where}: first_name is empty`);
    if (seen.has(r.email)) problems.push(`${where}: duplicate email`);
    if (seen.has("k:" + r.user_key)) problems.push(`${where}: duplicate user_key`);
    seen.add(r.email); seen.add("k:" + r.user_key);
  });
  if (problems.length) {
    console.error("The users sheet has problems; nothing was changed:\n  - " + problems.join("\n  - "));
    process.exit(1);
  }
}

/** The agreed starting passwords. Computed here, used once, never stored. */
const initialPassword = (r: Row) => (r.role === "super_admin" ? r.email : r.first_name.toLowerCase().replace(/\s+/g, ""));
const fallbackPassword = (r: Row) => r.first_name.toLowerCase().replace(/\s+/g, "") + FALLBACK_SUFFIX;

const isLengthError = (e: { code?: string; message?: string }) =>
  e.code === "weak_password" || /password/i.test(e.message ?? "") && /(character|length|short|least|weak)/i.test(e.message ?? "");

async function loadAuthUsersByEmail(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let page = 1; page < 100; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list existing logins: ${error.message}`);
    data.users.forEach((u) => u.email && map.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 200) break;
  }
  return map;
}

async function ensureBranch(name: string): Promise<string> {
  const found = await db.from("branches").select("id").ilike("name", name).is("deleted_at", null).maybeSingle();
  if (found.error) throw new Error(`branch lookup: ${found.error.message}`);
  if (found.data) return found.data.id;
  if (dryRun) return "(new branch)";
  const ins = await db.from("branches").insert({ name }).select("id").single();
  if (ins.error) throw new Error(`branch insert: ${ins.error.message}`);
  return ins.data.id;
}

async function main() {
  const file = findWorkbook();
  const rows = await readUsers(file);
  validate(rows);

  console.log(`Target project : ${new URL(url!).host}`);
  console.log(`Workbook       : ${file}`);
  console.log(`Users in sheet : ${rows.length}${dryRun ? "   (DRY RUN: nothing will be changed)" : ""}\n`);

  const authByEmail = await loadAuthUsersByEmail();
  const branchIds = new Map<string, string>();
  for (const name of new Set(rows.map((r) => r.branch))) branchIds.set(name, await ensureBranch(name));

  const results: Result[] = [];
  const fallbackUsed: string[] = [];
  const idByKey = new Map<string, string>();

  // ---- pass 1: logins + profiles
  for (const r of rows) {
    const res: Result = { email: r.email, role: r.role, status: "" };
    results.push(res);
    try {
      const existingAuthId = authByEmail.get(r.email);
      const { data: existingProfile, error: pErr } = await db.from("profiles").select("id").eq("legacy_key", r.user_key).maybeSingle();
      if (pErr) throw new Error(pErr.message);

      if (existingProfile) { idByKey.set(r.user_key, existingProfile.id); res.status = "skipped (already exists)"; continue; }
      if (dryRun) { res.status = existingAuthId ? "would add profile only" : "would create"; continue; }

      let authId = existingAuthId;
      let usedFallback = false;
      if (!authId) {
        let created = await db.auth.admin.createUser({ email: r.email, password: initialPassword(r), email_confirm: true, user_metadata: { full_name: r.full_name } });
        if (created.error && isLengthError(created.error)) {
          created = await db.auth.admin.createUser({ email: r.email, password: fallbackPassword(r), email_confirm: true, user_metadata: { full_name: r.full_name } });
          usedFallback = true;
        }
        if (created.error || !created.data.user) throw new Error(created.error?.message ?? "no user returned");
        authId = created.data.user.id;
      }

      const ins = await db.from("profiles").insert({
        id: authId, branch_id: branchIds.get(r.branch)!, full_name: r.full_name, email: r.email, role: r.role,
        designation: r.designation, legacy_key: r.user_key, active: true, must_change_password: true,
      });
      if (ins.error) {
        if (!existingAuthId) await db.auth.admin.deleteUser(authId); // don't leave a login without a profile
        throw new Error(ins.error.message);
      }
      idByKey.set(r.user_key, authId);
      if (usedFallback) fallbackUsed.push(r.email);
      res.status = existingAuthId ? "profile added (login existed)" : usedFallback ? "created (fallback password)" : "created";
    } catch (e) {
      res.status = `FAILED: ${(e as Error).message}`;
    }
  }

  // ---- pass 2: reporting lines ("Ajay Kushwaha (Branch Head)" -> the profile called Ajay Kushwaha, if one exists)
  const unresolved = new Set<string>();
  if (!dryRun) {
    const { data: people } = await db.from("profiles").select("id, full_name, legacy_key").is("deleted_at", null);
    const idByName = new Map((people ?? []).map((p) => [p.full_name.toLowerCase(), p.id]));
    for (const r of rows) {
      if (!r.reports_to) continue;
      const bossName = r.reports_to.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
      const bossId = idByName.get(bossName);
      const myId = idByKey.get(r.user_key);
      if (!bossId) { unresolved.add(r.reports_to); continue; }
      if (myId) await db.from("profiles").update({ reports_to: bossId }).eq("id", myId).is("reports_to", null);
    }
  }

  console.table(results);
  if (fallbackUsed.length) {
    console.log(`\nThe first-name password was shorter than Supabase's minimum, so these used firstname + "${FALLBACK_SUFFIX}" instead:\n  ` + fallbackUsed.join("\n  "));
  }
  if (unresolved.size) {
    console.log(`\nReporting manager not found among the users, so "reports to" was left empty for: ${[...unresolved].join("; ")}.\n` +
      `Add that person (Admin > Team) and run this script again: it will link them without touching anything else.`);
  }
  const failed = results.filter((x) => x.status.startsWith("FAILED"));
  if (failed.length) { console.error(`\n${failed.length} account(s) failed. Fix the cause and re-run; finished ones will be skipped.`); process.exit(1); }
  console.log(dryRun ? "\nDry run finished. Nothing was changed." : "\nDone. Everyone must choose a new password at first login.");
}

main().catch((e) => { console.error("\nFailed:", (e as Error).message); process.exit(1); });
