// Small hand-rolled inline SVGs — no icon library, matches the "pure CSS
// and inline SVG" constraint from the status hero work. currentColor lets
// each usage site set colour via a text-* class.

export function PlusIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M8 2v12M2 8h12" />
    </svg>
  )
}

// Media-eject glyph — universally reads as "give this back / open the tray",
// which is a more intuitive affordance for "release" than plain text alone.
export function EjectIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5l4.5 5h-9z" fill="currentColor" stroke="none" />
      <path d="M3.5 12h9" />
    </svg>
  )
}

// filled=true (currentColor fill) once you're on a slot's waitlist —
// outline otherwise. Same glyph either way so tapping it reads as toggling
// one thing, not switching to a different icon.
export function BellIcon({ className = 'h-4 w-4', filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.5c-2 0-3.2 1.5-3.2 3.7 0 3.3-1.1 4-1.1 4.6 0 .4.3.7.7.7h7.2c.4 0 .7-.3.7-.7 0-.6-1.1-1.3-1.1-4.6 0-2.2-1.2-3.7-3.2-3.7z" />
      <path d="M6.3 12.3a1.7 1.7 0 0 0 3.4 0" />
    </svg>
  )
}
