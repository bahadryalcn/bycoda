import type { HighlightResult } from "@streamdown/code";
import * as shiki from "shiki";
import type { BundledLanguage } from "shiki";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBoundedCodePlugin,
  MAX_HIGHLIGHT_CHARS,
  MAX_HIGHLIGHT_LINES,
  plainHighlightResult,
} from "./codeHighlightCore";

vi.mock("shiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("shiki")>();
  return { ...actual, createHighlighter: vi.fn(actual.createHighlighter) };
});

function text(result: HighlightResult): string {
  return result.tokens.map((line) => line.map((token) => token.content).join("")).join("\n");
}

function request(
  plugin: ReturnType<typeof createBoundedCodePlugin>,
  code: string,
  language: string,
  callback?: (result: HighlightResult) => void,
) {
  return plugin.highlight(
    { code, language: language as BundledLanguage, themes: plugin.getThemes() },
    callback,
  );
}

afterEach(() => {
  vi.mocked(shiki.createHighlighter).mockClear();
  vi.restoreAllMocks();
});

describe("plain text without tokenizing", () => {
  it("returns plain lines synchronously for plaintext fences without loading Shiki", () => {
    const plugin = createBoundedCodePlugin();
    const code = "rm -rf build/*\r\nmkdir build";
    const result = request(plugin, code, "text");
    expect(result && text(result)).toBe("rm -rf build/*\nmkdir build");
    expect(result?.tokens[1][0].offset).toBe(code.indexOf("mkdir"));
    expect(shiki.createHighlighter).not.toHaveBeenCalled();
  });

  it("caps highlighting by line count and size", () => {
    const plugin = createBoundedCodePlugin();
    const manyLines = "const x = 1;\n".repeat(MAX_HIGHLIGHT_LINES);
    const lines = request(plugin, manyLines, "ts");
    expect(lines && text(lines)).toBe(manyLines);
    const large = `const x = "${"y".repeat(MAX_HIGHLIGHT_CHARS)}";`;
    const chars = request(plugin, large, "ts");
    expect(chars && text(chars)).toBe(large);
    expect(shiki.createHighlighter).not.toHaveBeenCalled();
  });

  it("still highlights a block just under the cap", async () => {
    const plugin = createBoundedCodePlugin();
    const code = "const x = 1;\n".repeat(MAX_HIGHLIGHT_LINES - 2);
    const result = await new Promise<HighlightResult>((resolve) => {
      const cached = request(plugin, code, "ts", resolve);
      if (cached) resolve(cached);
    });
    expect(result.tokens[0].length).toBeGreaterThan(1);
  }, 30_000);
});

describe("highlight failure", () => {
  it("calls back with the whole current code as plain text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const highlighter = await vi.mocked(shiki.createHighlighter).getMockImplementation()!({
      themes: ["github-light", "github-dark"],
      langs: [],
    });
    vi.spyOn(highlighter, "codeToTokens").mockImplementation(() => {
      throw new Error("grammar crashed");
    });
    vi.mocked(shiki.createHighlighter).mockResolvedValueOnce(highlighter);
    const plugin = createBoundedCodePlugin();
    const code = "const first = 1;\nconst later = 2;";
    try {
      const result = await new Promise<HighlightResult>((resolve) => {
        expect(request(plugin, code, "ts", resolve)).toBeNull();
      });
      expect(text(result)).toBe(code);
      expect(result).toEqual(plainHighlightResult(code));
    } finally {
      highlighter.dispose();
    }
  }, 30_000);
});
