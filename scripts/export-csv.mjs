// Exports EVERY table to CSV (Excel-friendly UTF-8 with BOM, so Hindi text opens correctly).
// Uses the service-role key via the REST API, so it needs no database driver and no extra packages.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/export-csv.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const outDir = process.argv[2] || join("export", new Date().toISOString().slice(0, 10));
mkdirSync(outDir, { recursive: true });

// Keep in sync with supabase/migrations (a test in CI is not needed: a missing table makes this script fail loudly).
const TABLES = [
  "branches", "profiles", "projects", "cold_reasons", "next_action_types", "review_cycle",
  "cp_firms", "data_quality_issues", "channel_partners", "leads", "interactions", "cp_interactions", "bookings", "booking_status_history",
  "entry_receipts", "entry_cancellations", "targets", "review_sessions", "review_actions", "audit_log",
];
const PAGE = 1000;

const cell = (v) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${url}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}`, "Range-Unit": "items" },
    });
    if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

let failed = false;
for (const table of TABLES) {
  try {
    const rows = await fetchAll(table);
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
    writeFileSync(join(outDir, `${table}.csv`), "﻿" + csv + "\n");
    console.log(`${table.padEnd(24)} ${rows.length} rows`);
  } catch (e) {
    failed = true;
    console.error(`FAILED ${e.message}`);
  }
}
if (failed) process.exit(1);
console.log(`\nExported to ${outDir}`);
