import Link from "next/link";
import { getServerSession } from "next-auth";
import { ArrowRight, Cpu, Cloud, Download, ShieldCheck, Gauge, GitBranch } from "lucide-react";
import { authOptions } from "@/lib/auth";
import { Navbar } from "@/components/Navbar";
import { SignInButton } from "@/components/AuthButtons";

const FEATURES = [
  {
    icon: Cpu,
    title: "Train Locally, For Free",
    description:
      "Run the Desktop App to train FreqAI models against your own GPU and Docker setup — no cloud compute bill for backtesting or hyperopt.",
  },
  {
    icon: Cloud,
    title: "Deploy to the Cloud in One Click",
    description:
      "Push a trained strategy to a dedicated Hetzner VPS that trades 24/7, without keeping your own machine on.",
  },
  {
    icon: Gauge,
    title: "Pay Per Bot, Not Per Seat",
    description:
      "Quantity-based billing scales with the number of bots you actually run live — spin one up or down anytime.",
  },
  {
    icon: ShieldCheck,
    title: "Your Keys, Encrypted",
    description:
      "Exchange API credentials are encrypted at rest and only ever injected directly into your bot's container at deploy time.",
  },
  {
    icon: GitBranch,
    title: "Paper or Live, Your Call",
    description:
      "Every bot ships with a dry-run toggle so you can validate a strategy risk-free before flipping it to live trading.",
  },
];

export default async function LandingPage() {
  const session = await getServerSession(authOptions);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main>
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-24 text-center">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Built for Freqtrade &amp; FreqAI
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Train Locally.{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Trade in the Cloud.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
            The Freqtrade Command Center splits the work where it belongs: heavy FreqAI model
            training runs free on your own hardware through the Desktop App, then a single click
            deploys the trained bot to a always-on cloud VPS you only pay for while it&apos;s live.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            {session ? (
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-background transition hover:bg-primary-hover"
              >
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <SignInButton />
            )}
            <a
              href={process.env.NEXT_PUBLIC_DESKTOP_APP_WINDOWS_URL || "#"}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-6 py-3 text-sm font-semibold text-slate-200 transition hover:border-primary hover:text-primary"
            >
              <Download className="h-4 w-4" />
              Download Desktop App (Windows/Mac)
            </a>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            macOS build{" "}
            <a
              href={process.env.NEXT_PUBLIC_DESKTOP_APP_MAC_URL || "#"}
              className="underline hover:text-primary"
            >
              available here
            </a>{" "}
            &middot; free, no account required to train locally
          </p>
        </section>

        <section className="border-t border-border bg-surface/40">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight">One workflow, two environments</h2>
              <p className="mx-auto mt-3 max-w-xl text-slate-400">
                Everything you need to go from strategy idea to a live, 24/7 trading bot.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <div key={title} className="card-surface p-6 transition hover:border-primary/40">
                  <Icon className="h-8 w-8 text-primary" />
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-slate-400">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-20 text-center">
          <h2 className="text-3xl font-bold tracking-tight">Ready to put a bot to work?</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Download the Desktop App to start training for free, or jump straight into the
            dashboard if you already have a model ready to deploy.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            {session ? (
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-background transition hover:bg-primary-hover"
              >
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <SignInButton />
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-slate-500">
        &copy; {new Date().getFullYear()} Freqtrade Command Center. Not affiliated with the
        Freqtrade open-source project.
      </footer>
    </div>
  );
}
