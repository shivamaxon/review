import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Set your password" };

export default async function ChangePasswordPage() {
  const profile = await requireProfile({ allowPasswordChange: true });
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Choose your own password</h1>
          <p className="text-sm text-muted-foreground">
            Hi {profile.full_name.split(" ")[0]}, the password you were given is temporary.
            Pick a new one (at least 8 characters) to continue.
          </p>
        </div>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
