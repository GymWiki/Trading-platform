// The one signature element on this page: FreqPanda as a visible companion,
// not a logo mark tucked in a corner. It anchors the welcome card at real
// size and "speaks" through the greeting — that's the whole personality
// budget for this screen; every other surface below stays deliberately
// quiet so this is what gets remembered.
export function PandaHero() {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-panda-charcoal p-6 sm:p-8">
      {/* Soft bamboo glow, purely atmospheric — sits behind the mascot,
          never competes with the text. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-panda-bamboo/20 blur-3xl"
      />

      <div className="relative flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-panda-mono text-[11px] uppercase tracking-[0.2em] text-panda-mist">Welkom terug</p>
          <h1 className="mt-2 font-panda-display text-2xl font-semibold leading-tight text-panda-cream sm:text-3xl">
            Je bots draaien door.
          </h1>
          <p className="mt-2 max-w-xs text-sm text-panda-mist">
            Alles rustig aan het bijhouden — hieronder zie je precies hoe het gaat.
          </p>
        </div>

        {/* Mascot slot. Drop the pixel-art sprite in here — an <img> for a
            still/GIF sprite sheet frame, or <video autoPlay loop muted
            playsInline> for a real animation. Sized to read clearly at
            96–140px; the dashed ring below is only a stand-in so the layout
            doesn't look broken before the real asset is wired in. */}
        <div className="relative shrink-0">
          <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-panda-bamboo/40 bg-panda-charcoal-light text-5xl sm:h-32 sm:w-32 sm:text-6xl">
            🐼
          </div>
          {/* <video
            src="/mascot/panda-idle.webm"
            autoPlay
            loop
            muted
            playsInline
            className="h-24 w-24 sm:h-32 sm:w-32 object-contain"
          /> */}

          {/* The mascot's "voice" — small, warm, replaceable one-liner. */}
          <div className="absolute -left-4 -top-3 rounded-full bg-panda-bamboo px-2.5 py-1 text-[11px] font-medium text-panda-ink shadow-md">
            Alles oké 🎋
          </div>
        </div>
      </div>
    </section>
  );
}
