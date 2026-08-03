import { OctagonAlert } from "lucide-react";

// Two renderings of the same action, per the brief: a fixed bottom bar on
// mobile (thumb reach, impossible to miss, no sidebar to bury it in), and
// a plain inline button on desktop where a sticky full-width bar would
// just be wasted chrome above a pointer that can already reach anywhere.
export function PanicBar() {
  return (
    <>
      <div className="hidden items-center justify-between gap-4 rounded-2xl bg-panda-charcoal p-4 md:flex">
        <p className="text-sm text-panda-mist">Iets niet pluis? Sluit direct alle open posities.</p>
        <PanicButton />
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-panda-charcoal-light bg-panda-ink/95 p-4 backdrop-blur md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
        <PanicButton fullWidth />
      </div>
    </>
  );
}

function PanicButton({ fullWidth }: { fullWidth?: boolean }) {
  return (
    <button
      type="button"
      className={`flex items-center justify-center gap-2 rounded-xl bg-panda-panic px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-panda-panic/20 transition hover:bg-panda-panic-deep ${
        fullWidth ? "w-full" : ""
      }`}
    >
      <OctagonAlert className="h-4 w-4" />
      Noodstop — sluit alle posities
    </button>
  );
}
