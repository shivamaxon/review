"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required className="h-11 text-base" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11 text-base" />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" disabled={pending} className="h-11 w-full text-base">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
