import { NextResponse } from "next/server";
import { createClient as createUserClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/types";

// The private local launcher posts a Supabase-issued, single-use proof here.
// This route never creates accounts, changes roles, or bypasses password setup.
export async function POST(request: Request) {
  const failure = (reason = "invalid_link") => {
    const target = new URL("/login?error=admin_link", request.url);
    target.searchParams.set("reason", reason);
    const response = NextResponse.redirect(target, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  let token: FormDataEntryValue | null;
  try {
    token = (await request.formData()).get("token_hash");
  } catch {
    return failure("invalid_form");
  }
  if (typeof token !== "string" || !/^[a-z0-9_-]{32,256}$/i.test(token)) return failure();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
  if (error || !data.user || !data.session) {
    console.error("Admin link verification failed", { code: error?.code, status: error?.status });
    return failure("auth_" + (error?.code ?? String(error?.status ?? "unavailable")));
  }
  // Use the newly verified user's JWT explicitly for this first RLS read;
  // do not depend on cookie/session propagation inside the login request.
  const userClient = createUserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  const { data: profile, error: profileError, status: profileStatus } = await userClient.from("profiles")
    .select("role,active,must_change_password")
    .eq("id", data.user.id).is("deleted_at", null).maybeSingle();
  if (profileError || !profile?.active || !isAdmin(profile.role)) {
    console.error("Admin link profile check failed", { code: profileError?.code, status: profileStatus, found: !!profile, active: profile?.active });
    await supabase.auth.signOut({ scope: "local" });
    return failure("profile_" + (profileError?.code ?? (!profile ? "missing" : !profile.active ? "inactive" : "not_admin")));
  }
  const response = NextResponse.redirect(new URL(profile.must_change_password ? "/change-password" : "/command", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/login", request.url));
}
