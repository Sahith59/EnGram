import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      redirect("/dashboard");
    }
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err;
  }
  return <>{children}</>;
}
