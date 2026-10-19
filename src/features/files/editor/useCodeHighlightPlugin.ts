import { useCodeTheme } from "../../../shared/hooks/useCodeTheme";
import { createBoundedCodePlugin } from "./codeHighlightPlugin";

// Share bounded caches across messages; do not rebuild a highlighter per block.
const plugins = {
  github: createBoundedCodePlugin({ themes: ["github-light-default", "github-dark-default"] }),
  dracula: createBoundedCodePlugin({ themes: ["github-light-default", "dracula"] }),
};

export function useCodeHighlightPlugin() {
  return plugins[useCodeTheme()];
}
