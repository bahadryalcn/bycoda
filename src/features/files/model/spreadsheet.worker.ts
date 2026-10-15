import { documentErrorMessage } from "./documentViewer";
import { parseDelimitedPreview } from "./delimitedPreview";

self.onmessage = async (
  event: MessageEvent<Uint8Array | { bytes: Uint8Array; format: "csv" | "tsv" }>,
) => {
  try {
    self.postMessage({
      ok: true,
      book:
        event.data instanceof Uint8Array
          ? (await import("./spreadsheet")).parseSpreadsheet(event.data)
          : parseDelimitedPreview(event.data.bytes, event.data.format),
    });
  } catch (cause) {
    self.postMessage({ ok: false, message: documentErrorMessage(cause) });
  }
};
