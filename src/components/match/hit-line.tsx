import type { HitRead } from "@/lib/football/hits";

export function HitLine({ read }: { read: HitRead }) {
  return (
    <p className="mt-3 text-xs leading-relaxed">
      <span className="font-medium text-value tabular-nums">{read.hits}</span>
      <span className="text-muted"> de {read.total} coincidieron. </span>
      {read.calls.map((call, index) => (
        <span key={call.label} className={call.hit ? "text-value" : "text-subtle"}>
          {index > 0 ? " · " : ""}
          {call.label}
          {call.hit ? "" : " no"}
        </span>
      ))}
    </p>
  );
}
