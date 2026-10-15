import { expose } from "comlink";
import { highlightSource } from "./diffHighlightSource";
import { languageForPath } from "../../files/editor/editorLanguage";
import type { ColorScheme } from "../../settings/model/appearance";
import { buildUnifiedFileAsync } from "./unifiedDiff";
const api = {
  async highlight(path: string, original: string, current: string, scheme: ColorScheme) {
    const language = await languageForPath(path);
    return [
      highlightSource(original, language, scheme),
      highlightSource(current, language, scheme),
    ] as const;
  },
  build: buildUnifiedFileAsync,
};
export type DiffWorkerApi = typeof api;
expose(api);
