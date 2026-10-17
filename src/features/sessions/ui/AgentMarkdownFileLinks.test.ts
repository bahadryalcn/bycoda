// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import * as filesystem from "../../../platform/tauri/fs";

const copy = vi.hoisted(() => vi.fn(async (_text: string) => {}));
vi.mock("../../../platform/tauri/clipboard", () => ({ copyText: copy }));
const existingPaths = new Set([
  "G:/My Projects/ayşe/özet.md",
  "G:/My Projects/ayşe",
  "/repo/My Project/özet.md",
  "/repo/src",
  "/Users/me/projects/shop/.artifacts/reports/assessment-pdf/prs-tr.pdf",
  "/Users/me/projects/shop/.artifacts/reports/assessment-pdf/ancestry-tr.pdf",
  "G:/Projects/app/output/previews/pacing-character.html",
  "remote://mac/Users/me/My Project/özet.htm",
  "G:/My Project/Türkçe/özet.md",
]);
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  statFiles: async (paths: string[]) =>
    paths.map((path) => ({
      path,
      mtimeMs: existingPaths.has(path) ? 1 : null,
      isDir: path === "/repo/src" || path === "G:/My Projects/ayşe",
    })),
}));

describe("markdown file navigation", () => {
  let root: Root;
  let container: HTMLDivElement;
  const onOpenFile = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onOpenFile.mockClear();
    copy.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(text: string, cwd = "/repo") {
    await act(async () =>
      root.render(
        createElement(AgentMarkdown, {
          text,
          cwd,
          onOpenFile,
        }),
      ),
    );
  }

  it.each(["/clear", "/help"])("keeps slash command %s as ordinary code", async (command) => {
    await render(`\`${command}\``);
    expect(container.querySelector('code[role="link"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open containing folder"]')).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("preserves explicit editor links without revealing absent files", async () => {
    await render("[Missing](/repo/missing-verification-file.ts)");
    expect(container.querySelector('[aria-label="Open containing folder"]')).toBeNull();
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/missing-verification-file.ts", undefined);
  });

  it("hides a prior folder action while the replacement path is unverified", async () => {
    await render("[Existing](<G:/My Projects/ayşe/özet.md>)");
    expect(container.querySelector('[aria-label="Open containing folder"]')).not.toBeNull();
    let resolveMetadata!: (
      value: { path: string; mtimeMs: number | null; isDir: boolean }[],
    ) => void;
    vi.spyOn(filesystem, "statFiles").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMetadata = resolve;
        }),
    );
    await render("[Checking](/repo/pending-verification-file.ts)");
    expect(container.querySelector('[aria-label="Open containing folder"]')).toBeNull();
    await act(async () =>
      resolveMetadata([
        { path: "/repo/pending-verification-file.ts", mtimeMs: null, isDir: false },
      ]),
    );
    expect(container.querySelector('[aria-label="Open containing folder"]')).toBeNull();
  });

  it("copies table email addresses without file icons or folder actions", async () => {
    const emails = [
      "admin-e2e@itms.local",
      "pm-e2e@itms.local",
      "assignee-e2e@itms.local",
      "e2e@itms.local",
    ];
    await render(
      "| User | Email |\n| --- | --- |\n" +
        emails.map((email, i) => `| ${i} | \`${email}\` |`).join("\n"),
    );
    expect(container.querySelector('code[role="link"]')).toBeNull();
    expect(container.querySelector('[aria-label="Open containing folder"]')).toBeNull();
    expect(container.querySelectorAll("code svg")).toHaveLength(0);
    const buttons = container.querySelectorAll<HTMLButtonElement>('[aria-label="Copy"]');
    expect(buttons).toHaveLength(4);
    for (const [index, button] of Array.from(buttons).entries()) {
      await act(async () => button.click());
      expect(copy).toHaveBeenLastCalledWith(emails[index]);
      expect(button.getAttribute("aria-label")).toBe("Copied");
    }
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("reports email copy failures and allows retry", async () => {
    copy.mockRejectedValueOnce(new Error("clipboard unavailable"));
    await render("`user+tag@example.com`");
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Copy"]')!;
    await act(async () => button.click());
    expect(button.getAttribute("aria-label")).toBe("Copy failed — try again");
    await act(async () => button.click());
    expect(copy).toHaveBeenLastCalledWith("user+tag@example.com");
    expect(button.getAttribute("aria-label")).toBe("Copied");
  });

  it("keeps an explicit file path containing an email clickable", async () => {
    await render("`./exports/user@example.com.json`");
    const link = container.querySelector<HTMLElement>('code[role="link"]')!;
    expect(link).not.toBeNull();
    expect(container.querySelector('[aria-label="Copy"]')).toBeNull();
    await act(async () => link.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/exports/user@example.com.json", undefined);
  });

  it.each([
    ["G:\\My Projects\\ayşe\\özet.md", "G:/My Projects/ayşe/özet.md"],
    ["G:\\My Projects\\ayşe", "G:/My Projects/ayşe"],
    ["/repo/My Project/özet.md", "/repo/My Project/özet.md"],
    ["./src", "/repo/src"],
    ["src/", "/repo/src"],
  ])("makes the file or folder %s clickable with a folder action", async (reference, path) => {
    await render(`\`${reference}\``);
    const link = container.querySelector<HTMLElement>('code[role="link"]');
    expect(link).not.toBeNull();
    expect(container.querySelector('[aria-label="Open containing folder"]')).not.toBeNull();
    await act(async () => link!.click());
    expect(onOpenFile).toHaveBeenCalledWith(path, undefined);
  });

  it("adds file actions to a standalone plain-text path", async () => {
    await render("G:/My Projects/ayşe/özet.md");
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link).not.toBeNull();
    expect(container.querySelector('[aria-label="Open containing folder"]')).not.toBeNull();
    await act(async () => link!.click());
    expect(onOpenFile).toHaveBeenCalledWith("G:/My Projects/ayşe/özet.md", undefined);
  });

  it("renders output citations as named file links with folder actions", async () => {
    const directory = "/Users/me/projects/shop/.artifacts/reports/assessment-pdf";
    await render(
      `:codex-file-citation{path="${directory}/prs-tr.pdf" purpose="output"}\n\n` +
        `:codex-file-citation{path="${directory}/ancestry-tr.pdf" purpose="output"}`,
    );
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
    expect(links.map((link) => link.textContent)).toEqual(["prs-tr.pdf", "ancestry-tr.pdf"]);
    expect(container.textContent).not.toContain("codex-file-citation");
    expect(container.querySelectorAll('[aria-label="Open containing folder"]')).toHaveLength(2);
    for (const [index, name] of ["prs-tr.pdf", "ancestry-tr.pdf"].entries()) {
      await act(async () => links[index].click());
      expect(onOpenFile).toHaveBeenLastCalledWith(`${directory}/${name}`, undefined);
    }
  });

  it.each([
    ["G:/Projects/app/output/previews/pacing-character.html", "G:/Projects/app"],
    ["/Users/me/My Project/özet.htm", "remote://mac/Users/me/My Project"],
  ])("renders visualize HTML %s as a file link with folder access", async (path, cwd) => {
    await render(`Önizleme: \uE200visualize\uE202${JSON.stringify({ path })}\uE201 hazır.`, cwd);
    expect(container.textContent).not.toContain("visualize");
    expect(container.querySelector('[aria-label="Open containing folder"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onOpenFile).toHaveBeenCalledWith(
      cwd.startsWith("remote://") ? `remote://mac${path}` : path,
      undefined,
    );
  });

  it.each([
    '\uE200visualize\uE202{"path":"/repo/page.html"}',
    '\uE200visualize\uE202{"path":"https://example.com/page.html"}\uE201',
    '\uE200visualize\uE202{"path":"/repo/page.js"}\uE201',
    "\uE200visualize\uE202{broken}\uE201",
    '`\uE200visualize\uE202{"path":"/repo/page.html"}\uE201`',
    '```text\n\uE200visualize\uE202{"path":"/repo/page.html"}\uE201\n```',
  ])("leaves invalid or example visualize markers literal: %s", async (text) => {
    await render(text);
    expect(container.textContent).toContain("visualize");
    expect(container.querySelector('[aria-label="Open containing folder"]')).toBeNull();
  });

  it("routes inline citations with spaces and Unicode to their remote host", async () => {
    await render(
      `Rapor: :codex-file-citation{purpose='output' path='/Users/me/My Project/özet.pdf'} hazır.`,
      "remote://mac/Users/me/My Project",
    );
    expect(container.textContent).toContain("Rapor: özet.pdf");
    expect(container.textContent).toContain(" hazır.");
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onOpenFile).toHaveBeenCalledWith("remote://mac/Users/me/My Project/özet.pdf", undefined);
  });

  it.each(["C:\\temp\\reports\\özet.pdf", "G:\\My Projects\\ayşe\\özet.pdf", "./reports/özet.pdf"])(
    "opens citations using the file path %s",
    async (path) => {
      await render(`:codex-file-citation{path="${path}" purpose="output"}`);
      expect(container.textContent).not.toContain("codex-file-citation");
      await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
      expect(onOpenFile).toHaveBeenCalledWith(
        path.startsWith("./") ? `/repo/${path.slice(2)}` : path.replace(/\\/g, "/"),
        undefined,
      );
    },
  );

  it.each([
    ':codex-file-citation{path="/repo/report.pdf"',
    ':codex-file-citation{purpose="output"}',
    ':codex-file-citation{path="https://example.com/report.pdf" purpose="output"}',
    ':codex-file-citation{path="//host/share/report.pdf" purpose="output"}',
    '`:codex-file-citation{path="/repo/report.pdf" purpose="output"}`',
    '```text\n:codex-file-citation{path="/repo/report.pdf" purpose="output"}\n```',
  ])("keeps incomplete, unsafe, and code citations literal: %s", async (text) => {
    await render(text);
    expect(container.querySelector('[aria-label="Open containing folder"]')).toBeNull();
    expect(container.textContent).toContain("codex-file-citation");
  });

  it.each([
    [
      "[Source](/home/dev/repo/src/main.ts:8:2)",
      "remote://env/home/dev/repo",
      "remote://env/home/dev/repo/src/main.ts",
    ],
    [
      "[Source](<G:/My Project/özet.md:8:2>)",
      "remote://env/G:/My Project",
      "remote://env/G:/My Project/özet.md",
    ],
  ])("keeps remote markdown navigation on the owning machine", async (text, cwd, path) => {
    await render(text, cwd);
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onOpenFile).toHaveBeenCalledWith(path, { line: 8, column: 2 });
  });

  it("keeps protocol methods and ordinary identifiers as code, not file chips", async () => {
    await render("`currentTime/read` and `experimentalApi` and `true`");
    for (const code of container.querySelectorAll("code")) {
      expect(code.getAttribute("role")).toBeNull();
      expect(code.querySelector('[aria-hidden="true"]')).toBeNull();
      await act(async () => code.click());
    }
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it.each(["Dockerfile", "Makefile", "Gemfile", "LICENSE", ".gitignore"])(
    "opens the extensionless/dotfile reference %s",
    async (name) => {
      await render(`\`${name}\``);
      const link = container.querySelector<HTMLElement>('code[role="link"]');
      expect(link).not.toBeNull();
      await act(async () => link!.click());
      expect(onOpenFile.mock.calls).toHaveLength(1);
      expect(onOpenFile.mock.calls[0][0]).toBe(`/repo/${name}`);
    },
  );

  it("opens inline file references at their line and column with the keyboard", async () => {
    await render("`src/main.ts:12:3`");
    const link = container.querySelector<HTMLElement>('code[role="link"]')!;
    await act(async () =>
      link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(onOpenFile).toHaveBeenCalledWith("/repo/src/main.ts", {
      line: 12,
      column: 3,
    });
  });

  it.each([
    ["docs/my%20file.md", "/repo/docs/my file.md", undefined],
    ["docs/my%20file.md:12:3", "/repo/docs/my file.md", { line: 12, column: 3 }],
    ["docs/progress%25.md", "/repo/docs/progress%.md", undefined],
  ] as const)("opens the encoded inline file reference %s", async (reference, path, navigation) => {
    await render(`\`${reference}\``);
    const link = container.querySelector<HTMLElement>('code[role="link"]');
    expect(link).not.toBeNull();
    await act(async () => link!.click());
    expect(onOpenFile).toHaveBeenCalledWith(path, navigation);
  });

  it("decodes spaces in markdown file links and preserves the source line", async () => {
    await render("[Guide](<docs/My Guide.md#L7-L9>)");
    expect(container.innerHTML).toContain("<a");
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/docs/My Guide.md", {
      line: 7,
    });
  });

  it.each(["`main.ts:12`", "[Source](main.ts:12)"])(
    "opens a bare filename with a line number: %s",
    async (text) => {
      await render(text);
      const link = container.querySelector<HTMLElement>('code[role="link"], a');
      expect(link).not.toBeNull();
      await act(async () => link!.click());
      expect(onOpenFile).toHaveBeenCalledWith("/repo/main.ts", { line: 12 });
    },
  );

  it.each(["/%2Fhost/share/file.md", "%2F%2Fhost/share/file.md:12", "%5C%5Chost/share/file.md"])(
    "does not open an encoded network path as a local file: %s",
    async (href) => {
      await render(`[Source](${href})`);
      for (const link of container.querySelectorAll<HTMLAnchorElement>("a")) {
        await act(async () => link.click());
      }
      expect(onOpenFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["./docs/guide.md#installation", "/repo/docs/guide.md"],
    ["./report%23L2.md#installation", "/repo/report#L2.md"],
  ])("opens %s without treating the heading anchor as part of its filename", async (href, path) => {
    await render(`[Guide](${href})`);
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onOpenFile).toHaveBeenCalledWith(path, undefined);
  });

  it("opens absolute file URLs at the referenced line", async () => {
    await render("[Source](file:///Users/me/My%20Project/main.ts#L4)");
    expect(container.innerHTML).toContain("<a");
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    expect(onOpenFile).toHaveBeenCalledWith("/Users/me/My Project/main.ts", {
      line: 4,
    });
  });

  it.each([
    "[Source](file://localhost/%2Fhost/share/file.md)",
    "`file://localhost/%2Fhost/share/file.md`",
    "`file://localhost/%5Chost/share/file.md`",
    "`%2F%2Fhost%2Fshare%2Ffile.md`",
    "```12:16:file://localhost/%2Fhost/share/file.md\nexample\n```",
  ])("does not pass a network file URL to the native file opener: %s", async (text) => {
    await render(text);
    expect(container.querySelector('code[role="link"], .markdown-code-path-link')).toBeNull();
    for (const link of container.querySelectorAll<HTMLAnchorElement>("a")) {
      await act(async () => link.click());
    }
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("opens a code citation at the first displayed source line", async () => {
    await render("```12:16:src/main.ts\nexport const answer = 42;\n```");
    const link = container.querySelector<HTMLButtonElement>(".markdown-code-path-link");
    expect(link).not.toBeNull();
    await act(async () => link!.click());
    expect(onOpenFile).toHaveBeenCalledWith("/repo/src/main.ts", { line: 12 });
  });

  it.each([
    "```12:16:G:/My Project/Türkçe/özet.md\nconst answer = 42;\n```",
    "```G:/My Project/Türkçe/özet.md startLine=12\nconst answer = 42;\n```",
  ])("preserves spaces and Unicode in code fence paths: %s", async (text) => {
    await render(text);
    const link = container.querySelector<HTMLButtonElement>(".markdown-code-path-link")!;
    expect(link.textContent).toBe("G:/My Project/Türkçe/özet.md");
    expect(container.querySelector('[aria-label="Open containing folder"]')).not.toBeNull();
    await act(async () => link.click());
    expect(onOpenFile).toHaveBeenCalledWith("G:/My Project/Türkçe/özet.md", {
      line: 12,
    });
  });

  it("preserves external web links and keeps executable URL schemes blocked", async () => {
    await render(
      [
        "[Documentation](https://example.com/docs)",
        "[Script](javascript:alert%281%29)",
        "[Data](data:text/html,bad)",
        "[Hidden](javascript:../src/main.ts)",
      ].join("\n\n"),
    );
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://example.com/docs"]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
