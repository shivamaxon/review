import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string }> }) {
  const { error, reason } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-semibold">B</div>
          <h1 className="text-2xl font-semibold tracking-tight">Branch Review OS</h1>
          <p className="text-sm text-muted-foreground">Sign in with the email and password your branch admin gave you.</p>
        </div>
        {error === "disabled" && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Your account has been switched off. Please contact your branch admin.
          </p>
        )}
        {error === "admin_link" && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {reason === "hosting_public_key_invalid"
              ? "The app's hosting API key is incorrect. Ask your admin to update it and redeploy."
              : "This admin link has expired, was already used, or could not be verified. Ask for a fresh private link."}
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
