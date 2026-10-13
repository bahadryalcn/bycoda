import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatWorkspaceText } from "./editor-format";
import { WorkspaceCommands } from "./workspace-commands";

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
    JSON.stringify({ scripts: { format: "prettier --write ." } }),
  );
  const path = join(root, "Page.tsx");
  await writeFile(path, "disk content");
  return { root, path };
}
it("formats the unsaved JSX buffer using project overrides and EditorConfig without touching disk", async () => {
  const { root, path } = await project();
  await writeFile(
    join(root, ".prettierrc.json"),
    JSON.stringify({
      semi: false,
      singleQuote: true,
      overrides: [{ files: "*.tsx", options: { singleQuote: false } }],
    }),
  );
  await writeFile(
    join(root, ".editorconfig"),
    "root = true\n[*]\nindent_style = space\nindent_size = 4\n",
  );
  const result = await formatWorkspaceText(
    root,
    path,
    "const Page=()=>{return <div title='hello'/>;}",
    6,
  );
  expect(result?.formatted).toBe('const Page = () => {\n    return <div title="hello" />\n}\n');
  expect(result?.cursorOffset).toBe(6);
  expect(await readFile(path, "utf8")).toBe("disk content");
});
it("respects prettierignore and reports syntax/config errors", async () => {
  const { root, path } = await project();
  await writeFile(join(root, ".prettierignore"), "Page.tsx\n");
  expect(await formatWorkspaceText(root, path, "invalid JSX <", 0)).toEqual({
    formatted: "invalid JSX <",
    cursorOffset: 0,
  });
  await writeFile(join(root, ".prettierignore"), "");
  await expect(formatWorkspaceText(root, path, "invalid JSX <", 0)).rejects.toThrow();
  await writeFile(join(root, ".prettierrc.json"), "{");
  await expect(formatWorkspaceText(root, path, "const a=1", 0)).rejects.toThrow();
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
    { projects: () => [{ cwd: root }] } as never,
    (async (_id: string, action: () => Promise<unknown>) => action()) as never,
  );
  await expect(
    commands.run("format_text_file", { path: process.execPath, source: "", cursorOffset: 0 }),
  ).rejects.toThrow("outside");
});
