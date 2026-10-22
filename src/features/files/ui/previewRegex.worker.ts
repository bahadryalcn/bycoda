import { evaluatePreviewSearch } from "./previewSearchEvaluation";

self.onmessage = (event: MessageEvent<Parameters<typeof evaluatePreviewSearch>>) => {
  self.postMessage(evaluatePreviewSearch(...event.data));
};
