import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { homeFor } from "@/lib/types";

// "/" just forwards each person to their own landing page.
export default async function Root() {
  const profile = await requireProfile();
  redirect(homeFor(profile.role));
}
