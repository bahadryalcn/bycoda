import { parseVoiceOfficeDocument } from "./voiceDocumentParser";

self.onmessage = async (
  event: MessageEvent<{ bytes: Uint8Array; format: "docx" | "spreadsheet" }>,
) => {
  try {
    self.postMessage({
      ok: true,
      result: await parseVoiceOfficeDocument(event.data.bytes, event.data.format),
    });
  } catch {
    // Parsers can include private document content in exception messages.
    self.postMessage({ ok: false });
  }
};
