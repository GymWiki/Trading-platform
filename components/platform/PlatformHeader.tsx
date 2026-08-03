import { Bell, Settings } from "lucide-react";

// Minimal top bar, deliberately not a nav: per the brief, no traditional
// sidebar on mobile, and this page doesn't need a second navigation
// system competing with the content below — just brand + the two
// account-level icons a user actually reaches for.
export function PlatformHeader() {
  return (
    <header className="flex items-center justify-between px-4 py-5 sm:px-6">
      <div className="flex items-center gap-2">
        <span className="text-2xl leading-none">🐼</span>
        <span className="font-panda-display text-lg font-semibold tracking-tight text-panda-cream">FreqPanda</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Meldingen"
          className="flex h-10 w-10 items-center justify-center rounded-full text-panda-mist transition hover:bg-panda-charcoal hover:text-panda-cream"
        >
          <Bell className="h-5 w-5" />
        </button>
        <button
          type="button"
          aria-label="Instellingen"
          className="flex h-10 w-10 items-center justify-center rounded-full text-panda-mist transition hover:bg-panda-charcoal hover:text-panda-cream"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
