export interface ExportSheet {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
  note?: string;
}

function file(name: string, ext: string): string {
  const base = name.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "meridiano";
  return base.toLowerCase().endsWith(ext) ? base : `${base}${ext}`;
}

function saveBlob(filename: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => link.remove(), 0);
  return url;
}

export function releaseDownload(url: string | null) {
  if (url) URL.revokeObjectURL(url);
}

export async function downloadExcel(filename: string, sheet: ExportSheet): Promise<string> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const data = [sheet.headers, ...sheet.rows.map((row) => row.map((cell) => (cell == null ? "" : cell)))];
  if (sheet.note) {
    data.push([]);
    data.push([sheet.note]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = sheet.headers.map((header, column) => {
    const widest = data.reduce((max, row) => Math.max(max, String(row[column] ?? "").length), header.length);
    return { wch: Math.min(46, Math.max(12, widest)) };
  });
  const safeName = (sheet.name || "Meridiano").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Meridiano";
  XLSX.utils.book_append_sheet(book, ws, safeName);
  const raw = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer | Uint8Array;
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return saveBlob(
    file(filename, ".xlsx"),
    new Blob([copy], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
}

function latin(text: string): number[] {
  const clean = text
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2026/g, "...");
  const bytes: number[] = [];
  for (const char of clean) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 255 && code !== 127)) bytes.push(code);
    else bytes.push(63);
  }
  return bytes;
}

function pdfText(text: string): string {
  return latin(text)
    .map((code) => {
      const char = String.fromCharCode(code);
      if (char === "\\" || char === "(" || char === ")") return `\\${char}`;
      if (code < 32 || code > 126) return `\\${code.toString(8).padStart(3, "0")}`;
      return char;
    })
    .join("");
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export function buildPdf(title: string, sheet: ExportSheet): Uint8Array {
  const lines: string[] = [title, ""];
  if (sheet.note) lines.push(...wrap(sheet.note, 92), "");
  if (sheet.rows.length === 0) lines.push("No hay filas para exportar.");
  sheet.rows.forEach((row, index) => {
    const head = sheet.headers[0] ? String(row[0] ?? "") : `Fila ${index + 1}`;
    lines.push(head);
    sheet.headers.forEach((header, column) => {
      if (column === 0) return;
      const value = row[column];
      if (value == null || value === "") return;
      lines.push(...wrap(`${header}: ${value}`, 96).map((part, partIndex) => (partIndex === 0 ? part : `  ${part}`)));
    });
    lines.push("");
  });
  lines.push("Meridiano estima probabilidades. No garantiza resultados.");

  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of lines) {
    if (line === "" && block.length) {
      blocks.push(block);
      block = [];
    } else if (line !== "") {
      block.push(line);
    }
  }
  if (block.length) blocks.push(block);

  const MAX_LINES = 50;
  const pages: string[][] = [];
  let page: string[] = [];

  function flush() {
    if (page.length) pages.push(page);
    page = [];
  }

  for (const item of blocks) {
    let rest = item;
    let continued = false;
    while (rest.length) {
      const room = page.length === 0 ? MAX_LINES : MAX_LINES - page.length;
      if (room < 4) {
        flush();
        continue;
      }
      const take = Math.min(rest.length, room);
      if (continued) page.push(`${item[0]} (sigue)`);
      page.push(...rest.slice(0, take));
      rest = rest.slice(take);
      continued = rest.length > 0;
      if (rest.length) flush();
    }
    if (page.length) page.push("");
  }
  if (page.length) pages.push(page);
  if (!pages.length) pages.push(["Meridiano"]);

  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3 + pages.length * 2;
  pages.forEach((page, index) => {
    const contentId = 3 + index * 2;
    const pageId = contentId + 1;
    pageIds.push(pageId);
    const body = page
      .map((line, lineIndex) => {
        const size = lineIndex === 0 && index === 0 ? 14 : 9;
        const y = 800 - lineIndex * 14;
        return `BT /F1 ${size} Tf 40 ${y} Td (${pdfText(line)}) Tj ET`;
      })
      .join("\n");
    objects[contentId] = `<< /Length ${latin(body).length} >>\nstream\n${body}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  });
  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id <= fontId; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id] ?? "<<>>"}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${fontId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= fontId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${fontId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Uint8Array.from(latin(pdf));
}

export function downloadPdf(filename: string, title: string, sheet: ExportSheet): string {
  const bytes = buildPdf(title, sheet);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return saveBlob(file(filename, ".pdf"), new Blob([copy], { type: "application/pdf" }));
}
