import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/types";

// The private local launcher posts a Supabase-issued, single-use proof here.
// This route never creates accounts, changes roles, or bypasses password setup.
export async function POST(request: Request) {
  const failure = () => NextResponse.redirect(new URL("/login?error=admin_link", request.url), 303);
  let token: FormDataEntryValue | null;
  try {
    token = (await request.formData()).get("token_hash");
  } catch {
    return failure();
  }
  if (typeof token !== "string" || !/^[a-z0-9_-]{32,256}$/i.test(token)) return failure();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
  if (error || !data.user) {
    console.error("Admin link verification failed", { code: error?.code, status: error?.status });
    return failure();
  }
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("role,active,must_change_password")
    .eq("id", data.user.id).is("deleted_at", null).maybeSingle();
  if (profileError || !profile?.active || !isAdmin(profile.role)) {
    await supabase.auth.signOut({ scope: "local" });
    return failure();
  }
  const response = NextResponse.redirect(new URL(profile.must_change_password ? "/change-password" : "/command", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url));
}
