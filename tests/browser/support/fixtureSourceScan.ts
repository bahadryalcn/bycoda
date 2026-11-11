import type { Plugin } from "vite";
import { readFileSync } from "node:fs";

/** Product classes only, matching index.css exclusions; avoids scanning sibling workspaces. */
export function fixtureSourceScan(): Plugin {
  return {
    name: "fixture-product-source-scan",
    enforce: "pre",
    transform(code, id) {
      const path = id.replace(/\\/g, "/");
      if (path.endsWith("/src/styles/index.css"))
        return code.replace(
          '@import "tailwindcss" source("..");',
          '@import "tailwindcss" source("../");',
        );
      if (!path.endsWith("/tests/browser/support/w7-shell.css")) return;
      // Tailwind resolves nested CSS imports internally, bypassing the index transform.
      // Inline current product styles and rebase their imports; keep fixture sources.
      const product = readFileSync(
        new URL("../../../src/styles/index.css", import.meta.url),
        "utf8",
      )
        .replace(
          '@import "tailwindcss" source("..");',
          '@import "tailwindcss" source("../../../src");',
        )
        .replaceAll('@import "./', '@import "../../../src/styles/');
      return code.replace('@import "../../../src/styles/index.css";', product);
    },
  };
}
