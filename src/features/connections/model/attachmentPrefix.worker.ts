import { createAttachmentPrefixHasher } from "./attachmentPrefixHash";

const process = createAttachmentPrefixHasher();

self.onmessage = async (event: MessageEvent) => {
  try {
    self.postMessage({ id: event.data.id, ...(await process(event.data)) });
  } catch (error) {
    self.postMessage({ id: event.data.id, error: String(error) });
  }
};
