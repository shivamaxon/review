"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="h-11 text-base" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Type it again</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required className="h-11 text-base" />
      </div>
      {state?.error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={pending} className="h-11 w-full text-base">{pending ? "Saving…" : "Save and continue"}</Button>
    </form>
  );
}
