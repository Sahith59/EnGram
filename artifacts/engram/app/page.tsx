import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingClient } from "./landing-client";

export default async function Home({
  searchParams,
}: {
  searchParams: { error?: string; error_code?: string; error_description?: string };
}) {
  // If Supabase redirected here with an auth error, forward it to /login so
  // the user sees a clean, branded message instead of a stranded URL.
  if (searchParams.error || searchParams.error_code) {
    const params = new URLSearchParams();
    if (searchParams.error) params.set("error", searchParams.error);
    if (searchParams.error_code) params.set("error_code", searchParams.error_code);
    if (searchParams.error_description)
      params.set("error_description", searchParams.error_description);
    redirect(`/login?${params.toString()}`);
  }

  let user = null;
  try {
    const supabase = await createClient();
    const res = await supabase.auth.getUser();
    user = res.data.user;
  } catch {
    // Supabase not configured yet — show landing page
  }

  if (user) {
    redirect("/dashboard");
  }

  return <LandingClient />;
}
