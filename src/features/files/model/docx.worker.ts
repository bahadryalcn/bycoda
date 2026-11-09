import mammoth from "mammoth/mammoth.browser";
import { checkDocxExpansion, checkDocxHtml, MAX_DOCX_HTML_CHARACTERS } from "./docxPreview";
import { documentErrorMessage } from "./documentViewer";

self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try {
    const bytes = event.data;
    checkDocxExpansion(bytes);
    let imageCharacters = 0;
    const result = await mammoth.convertToHtml(
      {
        arrayBuffer: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const base64 = await image.readAsBase64String();
          imageCharacters += base64.length;
          if (imageCharacters > MAX_DOCX_HTML_CHARACTERS)
            throw new Error(
              "Document images are too large to preview. Open it in the default app instead.",
            );
          return { src: `data:${image.contentType};base64,${base64}` };
        }),
      },
    );
    if (imageCharacters > MAX_DOCX_HTML_CHARACTERS)
      throw new Error(
        "Document images are too large to preview. Open it in the default app instead.",
      );
    checkDocxHtml(result.value);
    self.postMessage({ ok: true, html: result.value });
  } catch (cause) {
    self.postMessage({ ok: false, message: documentErrorMessage(cause) });
  }
};
