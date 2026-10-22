import { execFile } from "node:child_process";

export type EditorFormatResult = { formatted: string; cursorOffset: number };

/** Run project code/config in a bounded, isolated process, without writing the file. */
export function formatWorkspaceText(
  root: string,
  path: string,
  source: unknown,
  cursorOffset: unknown,
): Promise<EditorFormatResult | null> {
  if (typeof source !== "string" || source.length > 512 * 1024)
    throw new Error("File is too large to format (maximum 512 KB).");
  if (
    !Number.isSafeInteger(cursorOffset) ||
    (cursorOffset as number) < 0 ||
    (cursorOffset as number) > source.length
  )
    throw new Error("Invalid formatting cursor offset");
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["--input-type=module", "-e", FORMAT_WORKER],
      {
        cwd: root,
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(stderr.trim().slice(0, 2000) || "Project formatter failed or timed out."),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("Invalid project formatter response"));
        }
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(JSON.stringify({ root, path, source, cursorOffset }));
  });
}

// Use the project's installed tools, never npx/downloads or arbitrary package scripts.
const FORMAT_WORKER = String.raw`
import { createRequire } from 'node:module';
import { readFile, access } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { root, path, source, cursorOffset } = JSON.parse(input);
const req = createRequire(join(dirname(path), '__bycoda_formatter.cjs'));
const installed = name => { try { return req.resolve(name); } catch { return null; } };
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const tools = { prettier: installed('prettier'), biome: installed('@biomejs/biome/package.json'), oxfmt: installed('oxfmt/package.json') };
let tool;
let ignorePath;
for (let dir = dirname(path);; dir = dirname(dir)) {
  if (!ignorePath && await exists(join(dir, '.prettierignore'))) ignorePath = join(dir, '.prettierignore');
  let pkg = {};
  try { pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); } catch {}
  const script = pkg.scripts?.format || '';
  // An explicit project format command wins over incidental installed dependencies.
  if (!tool) {
    if (/\boxfmt\b/.test(script)) tool = 'oxfmt';
    else if (/\bbiome\s+(?:format|check)\b/.test(script)) tool = 'biome';
    else if (/\bprettier\b/.test(script)) tool = 'prettier';
    else if (await exists(join(dir, 'biome.json')) || await exists(join(dir, 'biome.jsonc'))) tool = 'biome';
    else if (await exists(join(dir, '.oxfmtrc.json')) || await exists(join(dir, '.oxfmtrc.jsonc'))) tool = 'oxfmt';
    else if (pkg.prettier || (await Promise.all(['.prettierrc', '.prettierrc.json', '.prettierrc.json5', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.ts', '.prettierrc.cts', '.prettierrc.mts', '.prettierrc.toml', '.prettierrc.yaml', '.prettierrc.yml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts', 'prettier.config.cts', 'prettier.config.mts'].map(name => exists(join(dir, name))))).some(Boolean)) tool = 'prettier';
  }
  if (relative(root, dir) === '' || dirname(dir) === dir) break;
}
tool ||= ['prettier', 'biome', 'oxfmt'].find(name => tools[name]);
if (!tool) { process.stdout.write('null'); }
else if (!tools[tool]) { throw new Error('Install the project formatter: ' + tool); }
else if (tool === 'prettier') {
  const imported = await import(pathToFileURL(tools.prettier).href);
  const prettier = imported.default || imported;
  const options = await prettier.resolveConfig(path, { editorconfig: true });
  const plugins = await Promise.all((options?.plugins || []).map(plugin => typeof plugin === 'string' ? pathToFileURL(req.resolve(plugin)).href : plugin));
  const info = await prettier.getFileInfo(path, { ignorePath, plugins });
  if (info.ignored) process.stdout.write(JSON.stringify({ formatted: source, cursorOffset }));
  else {
    const result = await prettier.formatWithCursor(source, { ...options, plugins, filepath: path, cursorOffset });
    process.stdout.write(JSON.stringify(result));
  }
} else {
  const pkg = JSON.parse(await readFile(tools[tool], 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[tool];
  const args = tool === 'biome' ? ['format', '--stdin-file-path=' + path] : ['--stdin-filepath', path];
  const result = spawnSync(process.execPath, [join(dirname(tools[tool]), bin), ...args], { cwd: dirname(path), input: source, encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Formatting failed');
  process.stdout.write(JSON.stringify({ formatted: result.stdout, cursorOffset: Math.min(cursorOffset, result.stdout.length) }));
}
`;
