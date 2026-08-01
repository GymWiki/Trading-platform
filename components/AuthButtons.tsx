"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  return (
    <Link
      href="/login"
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary hover:text-primary"
    >
      Sign in
    </Link>
  );
}

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-red-500/50 hover:text-red-400"
    >
      Sign out
    </button>
  );
}
