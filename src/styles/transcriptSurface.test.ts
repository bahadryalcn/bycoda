import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/** K12 contract: one reading surface per reply, opaque ink roles, no per-block fills. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (path: string) => strip(readFileSync(path, "utf8"));
const surface = read("src/styles/transcript-surface.css");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

it("imports the surface sheet right after surface-roles.css", () => {
  const index = readFileSync("src/styles/index.css", "utf8");
  expect(index).toMatch(
    /@import "\.\/surface-roles\.css";\n@import "\.\/transcript-surface\.css";/,
  );
});

it("defines --transcript-surface-* and --transcript-ink-* only in transcript-surface.css", () => {
  for (const file of cssFiles("src")) {
    if (file.endsWith("transcript-surface.css")) continue;
    expect(read(file), file).not.toMatch(/--transcript-(surface|ink)-[\w-]+\s*:/);
  }
});

it("rolls ink from a body share so chrome can never exceed body", () => {
  expect(surface).toMatch(/--transcript-ink-emphasis:\s*var\(--color-content\)/);
  expect(surface).toMatch(
    /--transcript-ink-chrome:\s*color-mix\(\s*in srgb,\s*var\(--transcript-ink-body\)\s*var\(--appearance-transcript-chrome-ink, 61%\),\s*var\(--ui-tint-base\)/,
  );
  expect(surface).toMatch(
    /--transcript-ink-command:\s*color-mix\(\s*in srgb,\s*var\(--transcript-ink-chrome\) \d+%/,
  );
  expect(surface).toMatch(
    /--transcript-ink-faint:\s*color-mix\(\s*in srgb,\s*var\(--transcript-ink-chrome\) \d+%/,
  );
  expect(surface).toMatch(/--appearance-transcript-body-ink, 92%/);
  expect(surface).toMatch(/--appearance-contrast-scale, 1/);
  expect(surface).toMatch(/--ui-secondary-boost, 1/);
  expect(surface).not.toMatch(/--transcript-ink-[\w-]+:[^;]*transparent/);
});

it("paints the reading surface without the floating chat glass", () => {
  expect(surface).not.toContain("--ui-chat-glass-");
  expect(surface).toMatch(/--transcript-surface-color:\s*var\(--ui-chat-pane-canvas\)/);
  expect(surface).toMatch(/--appearance-transcript-surface-opacity, 90%/);
  expect(surface).toMatch(/--transcript-surface-filter:\s*none/);
});

it("keeps streaming away from the surface fill", () => {
  const rules = [...surface.matchAll(/([^{}]*data-session-streaming[^{}]*)\{([^}]*)\}/g)];
  expect(rules.length).toBeGreaterThan(0);
  for (const [, , body] of rules) expect(body).not.toMatch(/background|--transcript-surface/);
});

it("blurs only over artwork or native glass", () => {
  expect(surface).toMatch(
    /html:is\(\.has-chat-background, \.has-native-glass\)[^{]*\{[^}]*blur\(var\(--appearance-transcript-surface-blur/,
  );
  expect(surface).not.toMatch(/saturate\(|brightness\(/);
});

it("drops transparency and blur under reduced transparency and forced colors", () => {
  const block =
    /@media \(forced-colors: active\), \(prefers-reduced-transparency: reduce\) \{([\s\S]*)\}\s*$/.exec(
      surface,
    )?.[1];
  expect(block).toBeDefined();
  expect(block).toMatch(/--transcript-surface-fill:\s*var\(--transcript-surface-color\)/);
  expect(block).toMatch(/--transcript-surface-filter:\s*none/);
  expect(block).toMatch(
    /data-transcript-surface="off"\][^{]*\{[^}]*--transcript-reply-fill:\s*var\(--transcript-surface-color\)/,
  );
});

it("roots every scope rule at html or the preview root", () => {
  expect(surface).toMatch(
    /\[data-transcript-reply\]\s*\{[^}]*background:\s*var\(--transcript-reply-fill\)/,
  );
  for (const attr of ["surface", "cards"]) {
    for (const [selector] of surface.matchAll(
      new RegExp(`[^{}]*data-transcript-${attr}=[^{}]*`, "g"),
    )) {
      expect(selector).toContain(":is(html, [data-transcript-preview])");
    }
  }
});

it("no longer scopes assistant fills per block", () => {
  for (const file of ["src/styles/bycoda.css", "src/styles/index.css"]) {
    const css = read(file);
    expect(css, file).not.toMatch(
      /data-chat-message-surface="assistant"|assistant-message-opacity|assistant-surface-off|data-chat-message-preview/,
    );
  }
});
