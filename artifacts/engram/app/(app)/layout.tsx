import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ResumeBanner } from "@/components/resume/ResumeBanner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: { id: string; email?: string | null } | null = null;
  let profile: { full_name: string | null; avatar_url: string | null; email: string | null } | null = null;

  try {
    const supabase = await createClient();
    const res = await supabase.auth.getUser();
    user = res.data.user;

    if (!user) {
      redirect("/login");
    }

    const { data } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, email")
      .eq("id", user.id)
      .maybeSingle();
    profile = data;
  } catch (err) {
    // Re-throw redirect errors (Next.js uses thrown errors for redirects)
    if (err && typeof err === "object" && "digest" in err) throw err;
    // Supabase not configured — render the shell anyway with no user data
  }

  return (
    <div className="flex min-h-screen bg-gh-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          email={profile?.email ?? user?.email}
          fullName={profile?.full_name}
          avatarUrl={profile?.avatar_url}
        />
        <main className="flex-1">{children}</main>
      </div>
      <ResumeBanner />
    </div>
  );
}
