"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { homeFor } from "@/lib/types";
import type { FormState } from "@/app/login/actions";

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await requireProfile({ allowPasswordChange: true });
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return { error: "Use at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords don't match." };
  if (/^(password|12345678|qwerty)/i.test(password)) return { error: "That password is too easy to guess." };

  // Must not be the starting password pattern: email, first name, or first name + 123.
  const lower = password.toLowerCase();
  const email = (profile.email ?? "").toLowerCase();
  const first = profile.full_name.trim().split(/\s+/)[0].toLowerCase();
  const banned = [email, email.split("@")[0], first, `${first}123`, profile.full_name.toLowerCase().replace(/\s+/g, "")];
  if (banned.includes(lower)) return { error: "Your password can't be your email or your name. Choose something only you know." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  // A user is allowed to switch this flag OFF for themselves (the database blocks switching it on).
  const { error: flagError } = await supabase
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", profile.id);
  if (flagError) return { error: "Password saved, but we could not finish. Please sign in again." };

  redirect(homeFor(profile.role));
}
