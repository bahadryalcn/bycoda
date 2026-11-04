import type { Plugin } from "vite";

/** Product classes only, matching index.css exclusions; avoids scanning sibling workspaces. */
export function fixtureSourceScan(): Plugin {
  return {
    name: "fixture-product-source-scan",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/src/styles/index.css")) return;
      return code.replace('@import "tailwindcss";', '@import "tailwindcss" source("../");');
    },
  };
}
