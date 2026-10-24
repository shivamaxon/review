"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUser } from "./actions";
import { TempPassword } from "./temp-password";
import { ROLE_LABEL, type UserRole } from "@/lib/types";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function CreateUserForm(props: {
  roles: UserRole[];
  managers: { id: string; name: string }[];
  branches: { id: string; name: string }[] | null; // only super admins choose a branch
}) {
  const [state, action, pending] = useActionState(createUser, undefined);
  return (
    <form action={action} className="space-y-4" key={state?.ok ?? "form"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" required className="h-11 text-base" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email (their login)</Label>
          <Input id="email" name="email" type="email" required inputMode="email" className="h-11 text-base" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <select id="role" name="role" defaultValue="associate" className={selectClass}>
            {props.roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="designation">Designation</Label>
          <Input id="designation" name="designation" placeholder="e.g. AGM" className="h-11 text-base" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reports_to">Reports to</Label>
          <select id="reports_to" name="reports_to" defaultValue="" className={selectClass}>
            <option value="">— nobody —</option>
            {props.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {props.branches && (
          <div className="space-y-1.5">
            <Label htmlFor="branch_id">Branch</Label>
            <select id="branch_id" name="branch_id" className={selectClass}>
              {props.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {state?.error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
      {state?.tempPassword && <TempPassword result={state} />}
      <Button type="submit" disabled={pending} className="h-11 px-5 text-base">{pending ? "Creating…" : "Create user"}</Button>
    </form>
  );
}
