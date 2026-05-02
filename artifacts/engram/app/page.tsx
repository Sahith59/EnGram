import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingClient } from "./landing-client";

export default async function Home() {
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
