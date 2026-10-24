"use server";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile, UserRole } from "@/lib/types";

export type TeamResult = { error?: string; ok?: string; email?: string; tempPassword?: string } | undefined;

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/l/I lookalikes
const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const tempPassword = () => `${group()}-${group()}-${group()}`;

const ALL_ROLES: UserRole[] = ["associate", "team_lead", "branch_admin", "super_admin"];
const rolesActorMayCreate = (actor: Profile): UserRole[] =>
  actor.role === "super_admin" ? ALL_ROLES : ["associate", "team_lead"];

/** A branch admin may only manage associates/team leads of their own branch; a super admin may manage anyone. */
function mayManage(actor: Profile, target: { branch_id: string; role: UserRole }) {
  if (actor.role === "super_admin") return true;
  return target.branch_id === actor.branch_id && (target.role === "associate" || target.role === "team_lead");
}

export async function createUser(_prev: TeamResult, formData: FormData): Promise<TeamResult> {
  const actor = await requireRole(["branch_admin", "super_admin"]); // re-checked on the server every time
  const admin = createAdminClient();

  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as UserRole;
  const designation = String(formData.get("designation") ?? "").trim() || null;
  const reports_to = String(formData.get("reports_to") ?? "") || null;
  const branch_id = actor.role === "super_admin" ? String(formData.get("branch_id") || actor.branch_id) : actor.branch_id;

  if (!full_name) return { error: "Enter the person's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (!rolesActorMayCreate(actor).includes(role)) return { error: "You are not allowed to create that role." };

  if (reports_to) {
    const { data: boss } = await admin.from("profiles").select("id, branch_id").eq("id", reports_to).is("deleted_at", null).maybeSingle();
    if (!boss || boss.branch_id !== branch_id) return { error: "The reporting manager must be in the same branch." };
  }

  const password = tempPassword();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email: this app never sends email
    user_metadata: { full_name },
  });
  if (authError || !created.user) {
    const dup = /already|registered|exists/i.test(authError?.message ?? "");
    return { error: dup ? "Someone with that email already exists." : `Could not create the login: ${authError?.message}` };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    branch_id,
    full_name,
    email,
    role,
    designation,
    reports_to,
    active: true,
    must_change_password: true,
    created_by: actor.id,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id); // roll back so we never leave a login without a profile
    return { error: `Could not save the profile: ${profileError.message}` };
  }

  revalidatePath("/admin/team");
  return { ok: `Created ${full_name}.`, email, tempPassword: password };
}

async function loadManageable(userId: string) {
  const actor = await requireRole(["branch_admin", "super_admin"]);
  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, full_name, email, branch_id, role").eq("id", userId).is("deleted_at", null).maybeSingle();
  if (!target || !mayManage(actor, target as { branch_id: string; role: UserRole })) return { error: "You can't manage that person." } as const;
  return { actor, admin, target } as const;
}

export async function resetPassword(_prev: TeamResult, formData: FormData): Promise<TeamResult> {
  const ctx = await loadManageable(String(formData.get("user_id") ?? ""));
  if ("error" in ctx) return { error: ctx.error };
  const password = tempPassword();
  const { error } = await ctx.admin.auth.admin.updateUserById(ctx.target.id, { password });
  if (error) return { error: error.message };
  await ctx.admin.from("profiles").update({ must_change_password: true }).eq("id", ctx.target.id);
  revalidatePath("/admin/team");
  return { ok: `New temporary password for ${ctx.target.full_name}.`, email: ctx.target.email ?? undefined, tempPassword: password };
}

export async function setActive(_prev: TeamResult, formData: FormData): Promise<TeamResult> {
  const ctx = await loadManageable(String(formData.get("user_id") ?? ""));
  if ("error" in ctx) return { error: ctx.error };
  const active = String(formData.get("active")) === "true";
  if (ctx.target.id === ctx.actor.id) return { error: "You can't switch off your own account." };

  const { error } = await ctx.admin.from("profiles").update({ active }).eq("id", ctx.target.id);
  if (error) return { error: error.message };
  // Also block the login itself, so an existing session can't be refreshed.
  await ctx.admin.auth.admin.updateUserById(ctx.target.id, { ban_duration: active ? "none" : "876000h" });
  revalidatePath("/admin/team");
  return { ok: active ? `${ctx.target.full_name} is active again.` : `${ctx.target.full_name} is switched off.` };
}
