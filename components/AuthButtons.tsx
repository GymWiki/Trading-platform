"use client";

import { useState } from "react";
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
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-red-500/50 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
