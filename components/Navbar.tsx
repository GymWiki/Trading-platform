import Link from "next/link";
import { Bot } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignInButton, SignOutButton } from "@/components/AuthButtons";
import { BottomNav } from "@/components/BottomNav";

export async function Navbar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Bot className="h-6 w-6 shrink-0 text-primary" />
            {/* Full name only where there's room — BottomNav (mobile) and
                these same three destinations, so nothing is lost by hiding
                the wordmark, just the branding is compacted. */}
            <span className="hidden sm:inline">Freqtrade Command Center</span>
          </Link>
          <div className="flex items-center gap-3 sm:gap-4">
            {user ? (
              <>
                {/* Text links + the "Go to Dashboard" pill move into
                    BottomNav below md: — repeating them here too would
                    just be the overflowing row this replaces. */}
                <Link
                  href="/platforms"
                  className="hidden text-sm font-medium text-slate-300 transition hover:text-primary md:inline"
                >
                  Platformen
                </Link>
                <Link
                  href="/settings"
                  className="hidden text-sm font-medium text-slate-300 transition hover:text-primary md:inline"
                >
                  Instellingen
                </Link>
                <Link
                  href="/dashboard"
                  className="hidden rounded-lg bg-primary px-4 py-2 text-sm font-medium text-background transition hover:bg-primary-hover md:inline-block"
                >
                  Go to Dashboard
                </Link>
                <SignOutButton />
              </>
            ) : (
              <SignInButton />
            )}
          </div>
        </nav>
      </header>
      {user && <BottomNav />}
    </>
  );
}
