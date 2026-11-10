// In-browser file reading. PDF and DOCX are converted to text here, so binary files never
// need to be uploaded; only the extracted text is sent to the server for parsing and redaction.

export interface ReadFile { name: string; text?: string; pages?: string[]; sourceFormat?: "pdf" | "docx" }

export const ACCEPT = ".txt,.md,.markdown,.json,.csv,.pdf,.docx,.log";
export const MAX_FILE_MB = 4;

export async function readFile(file: File): Promise<ReadFile> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name} is larger than ${MAX_FILE_MB} MB. Export a shorter date range or split the file.`);
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return { name: file.name, pages: await pdfPages(file), sourceFormat: "pdf" };
  if (lower.endsWith(".docx")) return { name: file.name, pages: [await docxText(file)], sourceFormat: "docx" };
  if (/\.(doc|ppt|pptx|xls|xlsx|zip|png|jpe?g)$/.test(lower)) throw new Error(`${file.name}: this file type is not supported. Use PDF, DOCX, TXT, MD, CSV or a JSON chat export.`);
  return { name: file.name, text: await file.text() };
}

async function pdfPages(file: File): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/assets/js/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    let lastY: number | undefined;
    for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = item.transform?.[5];
      if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 4) text += "\n";
      text += item.str;
      if (item.hasEOL) text += "\n";
      lastY = y;
    }
    pages.push(text.replace(/\n{3,}/g, "\n\n"));
  }
  if (!pages.some((p) => p.trim())) throw new Error(`${file.name} has no selectable text (it may be a scanned image). Export it as text or use OCR first.`);
  return pages;
}

async function docxText(file: File): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error(`${file.name} does not look like a Word document.`);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const out: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
    const style = p.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || "";
    let line = "";
    for (const node of Array.from(p.getElementsByTagNameNS(W, "*"))) {
      if (node.localName === "t") line += node.textContent || "";
      else if (node.localName === "tab") line += "\t";
      else if (node.localName === "br") line += "\n";
    }
    const h = /^Heading(\d)/i.exec(style);
    out.push(h ? `${"#".repeat(Math.min(6, +h[1]))} ${line}` : line);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
