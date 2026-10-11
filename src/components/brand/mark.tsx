export function MeridianMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#141612" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#9aab96" strokeWidth="1.4" />
      <path d="M16 5.5v21" stroke="#eceee8" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.1" fill="#eceee8" />
    </svg>
  );
}
