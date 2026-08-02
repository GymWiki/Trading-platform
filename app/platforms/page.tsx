import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Navbar } from "@/components/Navbar";
import { PlatformsGrid } from "@/components/PlatformsGrid";
import { listPlatformsForUser } from "@/lib/platforms";

export default async function PlatformsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const platforms = await listPlatformsForUser(user.id);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Gekoppelde Platformen</h1>
          <p className="mt-1 text-sm text-slate-400">
            Koppel je exchange-account één keer — elke bot die je daarna aanmaakt kan er direct gebruik van maken.
          </p>
        </div>

        <PlatformsGrid initialPlatforms={platforms} />
      </main>
    </div>
  );
}
