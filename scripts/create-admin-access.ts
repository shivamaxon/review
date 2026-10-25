import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Run privately, never on a public endpoint or as part of a deployment build.
const origin = new URL(process.argv[2] ?? "");
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("Provide only the HTTPS app origin, without a path or credentials.");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Local Supabase configuration is missing.");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: profiles, error } = await admin.from("profiles").select("id,email")
  .in("role", ["branch_admin", "super_admin"]).eq("active", true).is("deleted_at", null);
if (error) throw new Error("Could not read active admins.");
const email = process.argv[3]?.trim().toLowerCase();
const matches = profiles.filter(p => !email || p.email?.toLowerCase() === email);
if (matches.length !== 1 || !matches[0].email) throw new Error("Specify one existing active admin email as the second argument.");
const profile = matches[0];
const existing = await admin.auth.admin.getUserById(profile.id);
if (existing.error || existing.data.user.email?.toLowerCase() !== profile.email!.toLowerCase()) {
  throw new Error("Admin profile does not match its existing Auth account.");
}
const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: profile.email! });
if (linkError || !link.properties?.hashed_token || link.user.id !== profile.id) throw new Error("Could not create the existing admin's sign-in link.");
const token = link.properties.hashed_token;
if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error("Unexpected proof format.");
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
await mkdir(resolve("export"), { recursive: true });
const path = resolve("export/admin-access.html");
await writeFile(path, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Private admin sign-in</title><body style="font:18px system-ui;max-width:500px;margin:80px auto;padding:24px"><h1>Open the admin app</h1><p>This private sign-in works once. Keep this file private. If asked, choose your new password to finish account setup.</p><form method="post" action="${escape(origin.origin)}/auth/admin-access"><input type="hidden" name="token_hash" value="${token}"><button style="min-height:48px;padding:12px 24px;font-size:18px">Open admin</button></form></body></html>`, { mode: 0o600 });
console.log("Private single-use admin launcher saved to export/admin-access.html. No email sent or account roles changed. Keep it out of Git.");
