import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Every infinite rotation of a pending glyph shares the decorative-loop policy that
 * WorkingIndicator follows: the clock stops while the window is behind another app or
 * decorative motion is off, and the glyph stays on screen so the state still reads as pending. */
const SPINNER_SHEETS = [
  "src/shared/ui/Spinner.module.css",
  "src/shared/ui/arc/button/button.module.css",
  "src/shared/ui/arc/inline-edit/inline-edit.module.css",
];

function ruleBody(css: string, selector: RegExp): string | undefined {
  return css.match(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`))?.[1];
}

it.each(SPINNER_SHEETS)(
  "%s pauses its spinner for window blur and decorative motion off",
  (path) => {
    const css = readFileSync(path, "utf8");
    const pauseRule = css.match(
      /:global\(html\[data-decorative-motion="off"\]\) \.spinner,\s*:global\(html\[data-window-focus="off"\]\) \.spinner\s*\{([^}]*)\}/,
    );
    expect(pauseRule?.[1]).toContain("animation-play-state: paused");
    // Paused, not removed: the glyph must stay visible as the pending signal.
    expect(pauseRule?.[1]).not.toMatch(/animation:\s*none|display:\s*none|visibility:\s*hidden/);
    expect(ruleBody(css, /\n\.spinner/)).toMatch(/animation:\s*\w+ var\(--motion-spin-duration\)/);
  },
);

it("keeps the shared Spinner's reduced-motion pulse and accessible name contract", () => {
  const css = readFileSync("src/shared/ui/Spinner.module.css", "utf8");
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.spinner\s*\{\s*animation: pulse/,
  );
  const tsx = readFileSync("src/shared/ui/Spinner.tsx", "utf8");
  expect(tsx).toContain('role={label ? "status" : undefined}');
  expect(tsx).toContain("aria-label={label}");
});
