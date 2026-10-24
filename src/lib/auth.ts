import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { homeFor, isAdmin, isReviewer, type Profile, type UserRole } from "@/lib/types";

const verifiedUser = cache(async()=>{const supabase=await createClient();return (await supabase.auth.getUser()).data.user;});

/** The signed-in user's profile (null if signed out or no profile row). Cached per request. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const user = await verifiedUser(); // authoritative, shared only within this request
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, branch_id, designation, reports_to, active, must_change_password, branches(name)")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) return null;
  const branch = data.branches as unknown as { name: string } | { name: string }[] | null;
  const { branches: _drop, ...rest } = data;
  void _drop;
  return {
    ...(rest as Omit<Profile, "branch_name">),
    branch_name: Array.isArray(branch) ? (branch[0]?.name ?? null) : (branch?.name ?? null),
  };
});

type Options = { allowPasswordChange?: boolean };

/** Use at the top of any protected page/action. Redirects instead of returning when access is not allowed. */
export async function requireProfile(opts: Options = {}): Promise<Profile> {
  const supabase = await createClient();
  if (!await verifiedUser()) redirect("/login");

  const profile = await getProfile();
  if (!profile) redirect("/no-access");
  if (!profile.active) {
    await supabase.auth.signOut();
    redirect("/login?error=disabled");
  }
  if (profile.must_change_password && !opts.allowPasswordChange) redirect("/change-password");
  return profile;
}

/** Like requireProfile, but also demands one of the given roles; others are sent to their own home. */
export async function requireRole(allowed: UserRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!allowed.includes(profile.role)) redirect(homeFor(profile.role));
  return profile;
}

export { isAdmin, isReviewer };
