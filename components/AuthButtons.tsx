"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  return (
    <Link
      href="/login"
      className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-background transition hover:bg-primary-hover"
    >
      Inloggen
    </Link>
  );
}

// className, when passed, fully replaces the default styling instead of
// merging with it — lets a caller in a differently-themed page (e.g. the
// FreqPanda-styled landing page) restyle this without fighting Tailwind
// class ordering/specificity against the default border-border/slate-400
// classes below.
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (err) {
      console.error("[SignOutButton] Sign out failed:", err);
      setIsSigningOut(false);
    }
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={isSigningOut}
      className={
        className ??
        "rounded-full border border-border px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      Uitloggen
    </button>
  );
}
