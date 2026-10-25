"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { homeFor, type UserRole } from "@/lib/types";

export type FormState = { error?: string } | undefined;

// Login rate limiting (free: a small table, no extra service). Supabase also has its own IP limits.
const WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-nf-client-connection-ip") ?? // Netlify
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** Fail closed when the shared rate-limit store is unavailable. */
async function isLockedOut(email: string, ip: string): Promise<"allowed" | "blocked" | "unavailable"> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const [byEmail, byIp] = await Promise.all([
      admin.from("login_attempts").select("id", { count: "exact", head: true }).eq("email", email).eq("succeeded", false).gte("at", since),
      admin.from("login_attempts").select("id", { count: "exact", head: true }).eq("ip", ip).eq("succeeded", false).gte("at", since),
    ]);
    if (byEmail.error || byIp.error) throw byEmail.error ?? byIp.error;
    return (byEmail.count ?? 0) >= MAX_FAILURES_PER_EMAIL || (byIp.count ?? 0) >= MAX_FAILURES_PER_IP ? "blocked" : "allowed";
  } catch (e) {
    console.error("login rate-limit check failed (migration 5 applied?):", e);
    return "unavailable";
  }
}

async function recordAttempt(email: string, ip: string, succeeded: boolean) {
  try {
    const admin = createAdminClient();
    await admin.from("login_attempts").insert({ email, ip, succeeded });
    if (succeeded) {
      await admin.from("login_attempts").delete().eq("email", email).eq("succeeded", false); // forgive old typos
    } else {
      await admin.from("login_attempts").delete().lt("at", new Date(Date.now() - 24 * 3600_000).toISOString()); // tidy up
    }
  } catch (e) {
    console.error("could not record login attempt:", e);
  }
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length>1024) return { error: "Enter your email and password." };

  const ip = await clientIp();
  const limit=await isLockedOut(email,ip);
  if(limit==="unavailable")return {error:"Sign-in checks are temporarily unavailable. Please try again shortly."};
  if (limit==="blocked") {
    return { error: `Too many wrong attempts. Please wait ${WINDOW_MINUTES} minutes and try again, or ask your branch admin to reset your password.` };
  }

  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password });
  await recordAttempt(email, ip, !error);
  if (error) {
    // One message for wrong password / unknown email / disabled account: don't reveal which.
    return { error: "Email or password is wrong, or the account is switched off. Ask your branch admin." };
  }
  // Go straight to the right place in ONE redirect (chained redirects leave the address bar on the wrong URL).
  const { data: me } = await supabase.from("profiles").select("role, must_change_password, active").eq("id", signedIn.user.id).maybeSingle();
  if (!me || !me.active) redirect("/"); // "/" sorts out missing profiles and switched-off accounts
  redirect(me.must_change_password ? "/change-password" : homeFor(me.role as UserRole));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
