import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ResumeBanner } from "@/components/resume/ResumeBanner";
import { EmbeddingsBanner } from "@/components/dashboard/EmbeddingsBanner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let user: { id: string; email?: string | null } | null = null;
  let profile:
    | { full_name: string | null; avatar_url: string | null; email: string | null; team_id: string | null }
    | null = null;

  try {
    const supabase = await createClient();
    const res = await supabase.auth.getUser();
    user = res.data.user;

    if (!user) {
      redirect("/login");
    }

    // Load profile (created by the on_auth_user_created trigger)
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("full_name, avatar_url, email, team_id")
      .eq("id", user.id)
      .maybeSingle();

    profile = profileRow;

    // Self-heal: if the profile row is missing (signed up before schema was
    // applied) or has no team yet, create both on the fly so the user can
    // immediately use the app.
    if (!profile || !profile.team_id) {
      const personalName =
        (user.email ? user.email.split("@")[0] : "Personal") + "'s workspace";

      // Use the service-role client so we can write to teams/profiles
      // regardless of RLS policies.
      const admin = createAdminClient();

      const { data: newTeam } = await admin
        .from("teams")
        .insert({ name: personalName })
        .select("id")
        .single();

      if (newTeam) {
        await admin.from("profiles").upsert(
          {
            id: user.id,
            email: user.email ?? profile?.email ?? null,
            full_name:
              profile?.full_name ??
              ((user as { user_metadata?: { full_name?: string } })
                .user_metadata?.full_name ?? null),
            avatar_url:
              profile?.avatar_url ??
              ((user as { user_metadata?: { avatar_url?: string } })
                .user_metadata?.avatar_url ?? null),
            team_id: newTeam.id,
          },
          { onConflict: "id" }
        );

        const { data: refreshed } = await supabase
          .from("profiles")
          .select("full_name, avatar_url, email, team_id")
          .eq("id", user.id)
          .maybeSingle();
        profile = refreshed;
      }
    }
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
      {/* Auto-fires backfill on every authenticated page load.
          Self-hides when nothing to do or when OpenAI is healthy. */}
      <EmbeddingsBanner />
    </div>
  );
}
