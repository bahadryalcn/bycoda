import type { CodeHighlighterPlugin, ThemeInput } from "@streamdown/code";
import { bundledLanguages, bundledLanguagesInfo } from "shiki/langs";
import type { BoundedCodePlugin } from "./codeHighlightCore";
export type { BoundedCodePlugin } from "./codeHighlightCore";
const aliases = Object.fromEntries(
  bundledLanguagesInfo.flatMap((info) => (info.aliases ?? []).map((alias) => [alias, info.id])),
);
const supported = new Set(Object.keys(bundledLanguages));
/** Keep the synchronous Streamdown contract; load the highlighting engine on first use. */
export function createBoundedCodePlugin(
  options: { themes?: [ThemeInput, ThemeInput]; maxEntries?: number; maxChars?: number } = {},
): BoundedCodePlugin {
  let delegate: BoundedCodePlugin | undefined;
  let loading: Promise<BoundedCodePlugin> | undefined;
  const load = () =>
    (loading ??= import("./codeHighlightCore")
      .then((core) => (delegate = core.createBoundedCodePlugin(options)))
      .catch((error) => {
        loading = undefined;
        throw error;
      }));
  return {
    name: "shiki",
    type: "code-highlighter",
    supportsLanguage(language) {
      const lang = language.trim().toLowerCase();
      return supported.has(aliases[lang] ?? lang);
    },
    getSupportedLanguages: () =>
      Object.keys(bundledLanguages) as ReturnType<CodeHighlighterPlugin["getSupportedLanguages"]>,
    getThemes: () => options.themes ?? ["github-light", "github-dark"],
    cachedResults: () => delegate?.cachedResults() ?? 0,
    highlight(args, callback) {
      if (delegate) return delegate.highlight(args, callback);
      void load()
        .then((plugin) => {
          const result = plugin.highlight(args, callback);
          if (result) callback?.(result);
        })
        .catch((error) => console.error("[Code highlight] Failed to load engine:", error));
      return null;
    },
  };
}
export const boundedCode = createBoundedCodePlugin();
