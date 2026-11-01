import type { VoiceDocumentKind, VoiceDocumentText } from "./voiceDocumentParser";
import { VOICE_DOCUMENT_MAX_BYTES, VOICE_DOCUMENT_MAX_TEXT } from "./voiceDocumentParser";

export const VOICE_DOCUMENT_MAX_PAGES = 20;
const PARSE_TIMEOUT = 15_000;

export function voiceDocumentKind(name: string, mimeType: string): VoiceDocumentKind | undefined {
  if (/\.pdf$/i.test(name) || /^application\/pdf(?:;|$)/i.test(mimeType)) return "pdf";
  if (
    /\.docx$/i.test(name) ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (
    /\.(?:xlsx|xlsm)$/i.test(name) ||
    /application\/vnd\.(?:openxmlformats-officedocument\.spreadsheetml\.sheet|ms-excel\.sheet\.macroEnabled\.12)/i.test(
      mimeType,
    )
  )
    return "spreadsheet";
  return undefined;
}

/** Office parsers stay off the UI thread and are terminated on completion or timeout. */
function office(bytes: Uint8Array, format: "docx" | "spreadsheet"): Promise<VoiceDocumentText> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./voiceDocument.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = (result?: VoiceDocumentText) => {
      clearTimeout(timer);
      worker.terminate();
      if (result) resolve(result);
      else reject(new Error("Document text could not be extracted."));
    };
    const timer = setTimeout(() => finish(), PARSE_TIMEOUT);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: VoiceDocumentText }>) =>
      finish(event.data.ok ? event.data.result : undefined);
    worker.onerror = () => finish();
    worker.onmessageerror = () => finish();
    worker.postMessage({ bytes, format });
  });
}

async function pdf(bytes: Uint8Array): Promise<VoiceDocumentText> {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { default: workerUrl } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
  if (!GlobalWorkerOptions.workerSrc) GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void loading.destroy();
  }, PARSE_TIMEOUT);
  try {
    const document = await loading.promise;
    let text = "";
    let truncated = document.numPages > VOICE_DOCUMENT_MAX_PAGES;
    for (let i = 1; i <= Math.min(document.numPages, VOICE_DOCUMENT_MAX_PAGES); i++) {
      if (timedOut) throw new Error("Document text extraction timed out.");
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      text += `Page ${i}\n`;
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
        if (text.length > VOICE_DOCUMENT_MAX_TEXT) {
          truncated = true;
          break;
        }
      }
      page.cleanup();
      if (text.length > VOICE_DOCUMENT_MAX_TEXT) break;
      text += "\n";
    }
    return {
      text: text.slice(0, VOICE_DOCUMENT_MAX_TEXT),
      textLength: text.length,
      truncated,
      format: "pdf",
      coverage: "text-only",
    };
  } finally {
    clearTimeout(timer);
    await loading.destroy();
  }
}

/** Text extraction does not inspect embedded images, charts or scanned page pixels. */
export function extractVoiceDocument(bytes: Uint8Array, format: VoiceDocumentKind) {
  if (!bytes.length || bytes.byteLength > VOICE_DOCUMENT_MAX_BYTES)
    return Promise.reject(new Error("Document size is outside the voice read limit."));
  return format === "pdf" ? pdf(bytes) : office(bytes, format);
}
