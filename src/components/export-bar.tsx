import { useState } from "react";
import { downloadExcel, downloadPdf, releaseDownload, type ExportSheet } from "@/lib/export/download";

export function ExportBar({
  filename,
  title,
  build,
}: {
  filename: string;
  title: string;
  build: () => ExportSheet;
}) {
  const [busy, setBusy] = useState<"pdf" | "excel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ href: string; name: string } | null>(null);

  async function run(kind: "pdf" | "excel") {
    setBusy(kind);
    setError(null);
    try {
      const sheet = build();
      const href = kind === "excel" ? await downloadExcel(filename, sheet) : downloadPdf(filename, title, sheet);
      const name = kind === "excel" ? `${filename}.xlsx` : `${filename}.pdf`;
      setFile((current) => {
        if (current) releaseDownload(current.href);
        return { href, name };
      });
    } catch {
      setError("No se pudo armar el archivo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy != null}
        onClick={() => void run("pdf")}
        className="h-10 rounded-full bg-elevated px-4 text-xs uppercase tracking-wider text-fg disabled:opacity-60"
      >
        {busy === "pdf" ? "PDF…" : "PDF"}
      </button>
      <button
        type="button"
        disabled={busy != null}
        onClick={() => void run("excel")}
        className="h-10 rounded-full bg-elevated px-4 text-xs uppercase tracking-wider text-fg disabled:opacity-60"
      >
        {busy === "excel" ? "Excel…" : "Excel"}
      </button>
      {file ? (
        <a
          href={file.href}
          download={file.name}
          className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-xs text-accent-fg"
        >
          Bajar {file.name.endsWith(".pdf") ? "PDF" : "Excel"}
        </a>
      ) : null}
      {error ? <span className="text-xs text-muted">{error}</span> : null}
    </div>
  );
}