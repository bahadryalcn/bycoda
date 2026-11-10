import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatWorkspaceText } from "./editor-format";
import { WorkspaceCommands } from "../workspaces/workspace-commands";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function project() {
  const base = resolve("temp/verification/editor-format");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "project-"));
  roots.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { format: "oxfmt --write ." } }),
  );
  const path = join(root, "Page.tsx");
  await writeFile(path, "disk content");
  return { root, path };
}
it("formats the unsaved JSX buffer using project configuration without touching disk", async () => {
  const { root, path } = await project();
  await writeFile(join(root, ".oxfmtrc.json"), JSON.stringify({ semi: false }));
  const result = await formatWorkspaceText(
    root,
    path,
    "const Page=()=>{return <div title='hello'/>;}",
    6,
  );
  expect(result?.formatted).toBe('const Page = () => {\n  return <div title="hello" />\n}\n');
  expect(result?.cursorOffset).toBe(6);
  // Native delivery validates an exact two-field result.
  expect(Object.keys(result!).sort()).toEqual(["cursorOffset", "formatted"]);
  expect(await readFile(path, "utf8")).toBe("disk content");
});
it("reports syntax errors", async () => {
  const { root, path } = await project();
  await expect(formatWorkspaceText(root, path, "invalid JSX <", 0)).rejects.toThrow();
});
// bycoda does not ship Prettier; a project that installs it gets its own copy.
async function installProjectPrettier(root: string) {
  const dir = join(root, "node_modules", "prettier");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "prettier", main: "index.cjs" }),
  );
  await writeFile(
    join(dir, "index.cjs"),
    `const { readFileSync } = require("node:fs");
const { basename } = require("node:path");
exports.resolveConfig = async () => null;
exports.getFileInfo = async (path, { ignorePath }) => ({
  ignored: !!ignorePath && readFileSync(ignorePath, "utf8").split("\\n").includes(basename(path)),
  inferredParser: path.endsWith(".tsx") ? "typescript" : null,
});
exports.formatWithCursor = async (source, { cursorOffset }) => ({
  formatted: source.toUpperCase(), cursorOffset, comments: [{ type: "CommentLine" }],
});`,
  );
}
it("uses the project's installed Prettier when its format script names it", async () => {
  const { root, path } = await project();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { format: "prettier --write ." } }),
  );
  await installProjectPrettier(root);
  // Internal `comments` metadata never escapes the worker.
  expect(await formatWorkspaceText(root, path, "// a\nconst a=1;", 2)).toEqual({
    formatted: "// A\nCONST A=1;",
    cursorOffset: 2,
  });
  expect(await formatWorkspaceText(root, join(root, ".gitignore"), "x", 0)).toBeNull();
  await writeFile(join(root, ".prettierignore"), "Page.tsx\n");
  expect(await formatWorkspaceText(root, path, "keep", 0)).toEqual({
    formatted: "keep",
    cursorOffset: 0,
  });
  expect(await readFile(path, "utf8")).toBe("disk content");
});
it("skips formatting when the configured project formatter is not installed", async () => {
  const { root, path } = await project();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { format: "prettier --write ." } }),
  );
  expect(await formatWorkspaceText(root, path, "const a=1;", 0)).toBeNull();
  expect(await formatWorkspaceText(root, join(root, ".gitignore"), "x", 0)).toBeNull();
});
it("selects Oxfmt when the project format script specifies it", async () => {
  const { root, path } = await project();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { format: "oxfmt --write ." } }),
  );
  await writeFile(join(root, ".oxfmtrc.json"), JSON.stringify({ semi: false }));
  expect((await formatWorkspaceText(root, path, "const a=1;", 0))?.formatted).toBe("const a = 1\n");
});

it("rejects oversized buffers and paths outside registered projects", async () => {
  const { root, path } = await project();
  expect(() => formatWorkspaceText(root, path, "x".repeat(512 * 1024 + 1), 0)).toThrow("too large");
  const commands = new WorkspaceCommands(
    { projects: () => [{ cwd: root }], attachmentDir: join(root, "attachments") } as never,
    (async (_id: string, action: () => Promise<unknown>) => action()) as never,
  );
  await expect(
    commands.run("format_text_file", { path: process.execPath, source: "", cursorOffset: 0 }),
  ).rejects.toThrow("outside");
});

it("does not corrupt multibyte characters split across stdin chunks in the formatter worker", async () => {
  const { path, root } = await project();
  const source = `const a = "${"ğ".repeat(70_000)}";\n`;
  const result = await formatWorkspaceText(root, path, source, 0);
  expect(JSON.stringify(result)).not.toContain("�");
});

it("skips an unsupported Oxfmt file while retaining syntax errors", async () => {
  const { root } = await project();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { format: "oxfmt --write ." } }),
  );
  const path = join(root, ".gitignore");
  await writeFile(path, "disk content");
  expect(await formatWorkspaceText(root, path, "node_modules/\n", 0)).toBeNull();
  await expect(
    formatWorkspaceText(root, join(root, "broken.js"), "const = ;", 0),
  ).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("disk content");
});
