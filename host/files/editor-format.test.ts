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
  // Native delivery validates an exact two-field result; Prettier's internal
  // `comments` field must never escape the worker (including nonempty comments).
  expect(Object.keys(result!).sort()).toEqual(["cursorOffset", "formatted"]);
  expect(await readFile(path, "utf8")).toBe("disk content");
});
it("keeps Prettier comment metadata out of the native result", async () => {
  const { root, path } = await project();
  const result = await formatWorkspaceText(root, path, "// keep me\nconst a=1;", 0);
  expect(result).toEqual({ formatted: "// keep me\nconst a = 1;\n", cursorOffset: 0 });
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

it.each([
  [".prettierrc.toml", "semi = false\n"],
  [".prettierrc.json5", "{semi: false}\n"],
  [".prettierrc.ts", "export default { semi: false };\n"],
  [".prettierrc.mts", "export default { semi: false };\n"],
  [".prettierrc.cts", "module.exports = { semi: false };\n"],
  ["prettier.config.ts", "export default { semi: false };\n"],
  ["prettier.config.mts", "export default { semi: false };\n"],
  ["prettier.config.cts", "module.exports = { semi: false };\n"],
])("selects nearer %s ahead of the parent Oxfmt script", async (name, config) => {
  const { root } = await project();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { format: "oxfmt --write ." } }),
  );
  const nested = join(root, "nested");
  await mkdir(nested);
  await writeFile(join(nested, name), config);
  const path = join(nested, "example.js");
  await writeFile(path, "disk content");
  expect((await formatWorkspaceText(root, path, "const a=1;", 6))?.formatted).toBe("const a = 1\n");
  expect(await readFile(path, "utf8")).toBe("disk content");
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

it("skips unsupported Prettier files but honors an explicitly configured parser", async () => {
  const { root } = await project();
  const path = join(root, ".gitignore");
  await writeFile(path, "disk content");
  expect(await formatWorkspaceText(root, path, "node_modules/\n", 0)).toBeNull();
  await writeFile(
    join(root, ".prettierrc.json"),
    JSON.stringify({ overrides: [{ files: ".gitignore", options: { parser: "json" } }] }),
  );
  expect(await formatWorkspaceText(root, path, '{"a":1}', 0)).toMatchObject({
    formatted: '{ "a": 1 }\n',
  });
  await writeFile(
    join(root, "custom-plugin.mjs"),
    `export const parsers = {
    custom: { parse: text => ({ text }), astFormat: "custom", locStart: () => 0, locEnd: node => node.text.length }
  }; export const printers = { custom: { print: path => path.getValue().text.toUpperCase() } };`,
  );
  await writeFile(
    join(root, ".prettierrc.json"),
    JSON.stringify({ parser: "custom", plugins: ["./custom-plugin.mjs"] }),
  );
  expect(await formatWorkspaceText(root, path, "custom input", 0)).toMatchObject({
    formatted: "CUSTOM INPUT",
  });
  expect(await readFile(path, "utf8")).toBe("disk content");
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
