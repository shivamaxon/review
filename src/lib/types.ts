export type UserRole = "associate" | "team_lead" | "branch_admin" | "super_admin";

export const ROLE_LABEL: Record<UserRole, string> = {
  associate: "Associate",
  team_lead: "Team Lead",
  branch_admin: "Branch Admin",
  super_admin: "Super Admin",
};

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  branch_id: string;
  designation: string | null;
  reports_to: string | null;
  active: boolean;
  must_change_password: boolean;
  branch_name: string | null;
  is_demo?:boolean;
};

/** Where each role lands after login. */
export function homeFor(role: UserRole): "/home" | "/command" {
  return role === "associate" ? "/home" : "/command";
}

export const isReviewer = (r: UserRole) => r !== "associate";
export const isAdmin = (r: UserRole) => r === "branch_admin" || r === "super_admin";
