"use client";

import { signIn, signOut } from "next-auth/react";

export function SignInButton() {
  return (
    <button
      onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-primary hover:text-primary"
    >
      Sign in
    </button>
  );
}

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-slate-400 transition hover:border-red-500/50 hover:text-red-400"
    >
      Sign out
    </button>
  );
}
