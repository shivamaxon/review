"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { resetPassword, setActive } from "./actions";
import { TempPassword } from "./temp-password";

export function RowActions({ userId, active, isSelf }: { userId: string; active: boolean; isSelf: boolean }) {
  const [resetState, resetAction, resetting] = useActionState(resetPassword, undefined);
  const [activeState, activeAction, toggling] = useActionState(setActive, undefined);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={resetAction}>
          <input type="hidden" name="user_id" value={userId} />
          <Button variant="outline" size="sm" disabled={resetting}>{resetting ? "Resetting…" : "Reset password"}</Button>
        </form>
        {!isSelf && (
          <form action={activeAction}>
            <input type="hidden" name="user_id" value={userId} />
            <input type="hidden" name="active" value={String(!active)} />
            <Button variant={active ? "destructive" : "outline"} size="sm" disabled={toggling}>
              {active ? "Switch off" : "Switch on"}
            </Button>
          </form>
        )}
      </div>
      {resetState?.error && <p role="alert" className="text-sm text-destructive">{resetState.error}</p>}
      {activeState?.error && <p role="alert" className="text-sm text-destructive">{activeState.error}</p>}
      {resetState?.tempPassword && <TempPassword result={resetState} />}
      {activeState?.ok && <p className="text-sm text-muted-foreground">{activeState.ok}</p>}
    </div>
  );
}
