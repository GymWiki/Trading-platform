import Link from "next/link";
import { Bot } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { SignInButton, SignOutButton } from "@/components/AuthButtons";

export async function Navbar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <Bot className="h-6 w-6 text-primary" />
          <span>Freqtrade Command Center</span>
        </Link>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              <Link href="/platforms" className="text-sm font-medium text-slate-300 transition hover:text-primary">
                Platformen
              </Link>
              <Link href="/settings" className="text-sm font-medium text-slate-300 transition hover:text-primary">
                Instellingen
              </Link>
              <Link
                href="/dashboard"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-background transition hover:bg-primary-hover"
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
  );
}
