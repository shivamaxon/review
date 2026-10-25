import {ReassignForm} from "@/components/review/admin-forms";
import Link from "next/link";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, type UserRole } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateUserForm } from "./create-user-form";
import { RowActions } from "./row-actions";

export const metadata: Metadata = { title: "Team" };

type Row = { id: string; full_name: string; email: string | null; role: UserRole; designation: string | null; active: boolean; reports_to: string | null; branch_id: string };

export default async function TeamPage() {
  const actor = await requireRole(["branch_admin", "super_admin"]);
  const supabase = await createClient(); // acts as the admin; Row Level Security limits the list to their scope

  const { data: rows } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, designation, active, reports_to, branch_id")
    .is("deleted_at", null)
    .order("full_name")
    .overrideTypes<Row[]>();
  const people = rows ?? [];
  const nameOf = new Map(people.map((p) => [p.id, p.full_name]));

  const isSuper = actor.role === "super_admin";
  const { data: branches } = isSuper ? await supabase.from("branches").select("id, name").is("deleted_at", null).order("name") : { data: null };

  const roles: UserRole[] = isSuper ? ["associate", "team_lead", "branch_admin", "super_admin"] : ["associate", "team_lead"];
  const managers = people.filter((p) => p.active && p.role !== "associate").map((p) => ({ id: p.id, name: `${p.full_name} (${ROLE_LABEL[p.role]})` }));
  const canManage = (p: Row) => isSuper || (p.branch_id === actor.branch_id && (p.role === "associate" || p.role === "team_lead"));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1><Link className="touch-button underline" href="/admin/settings">Targets, rules, branches & settings →</Link>
        <p className="text-sm text-muted-foreground">Create logins for your people. No emails are sent: you hand over the temporary password yourself.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a person</CardTitle>
          <CardDescription>They will be asked to choose their own password the first time they sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateUserForm roles={roles} managers={managers} branches={branches ?? null} />
        </CardContent>
      </Card>

      <ReassignForm people={people}/><section aria-label="Team members" className="space-y-3">
        <h2 className="text-lg font-medium">People ({people.length})</h2>
        {people.map((p) => (
          <Card key={p.id} size="sm">
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.full_name}</span>
                <Badge variant="secondary">{ROLE_LABEL[p.role]}</Badge>
                {!p.active && <Badge variant="destructive">Switched off</Badge>}
              </div>
              <div className="text-sm text-muted-foreground">
                {p.email}
                {p.designation && <> · {p.designation}</>}
                {p.reports_to && <> · reports to {nameOf.get(p.reports_to) ?? "—"}</>}
              </div>
              {canManage(p) && <RowActions userId={p.id} active={p.active} isSelf={p.id === actor.id} />}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
