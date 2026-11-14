import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Providers stays mounted (hidden) beside Usage and other pages keep hidden tabs mounted, so a
// `[data-settings-scroller]:has(<page content>)` rule also matches while another page shows and
// clipped Usage & limits so it could not scroll. Only the section identity may select the scroller.
it("sizes the shared settings scroller by section identity, never by page content", () => {
  const offenders = readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".css"))
    .flatMap((path) =>
      [
        ...readFileSync(join("src", path), "utf8").matchAll(
          /\[data-settings-scroller\]:has\(([^{]*)\{/g,
        ),
      ]
        .filter((match) => !/^\[data-settings-section="[a-z-]+"\]\)\s*$/.test(match[1]))
        .map((match) => `${path}: ${match[0]}`),
    );
  expect(offenders).toEqual([]);
});
