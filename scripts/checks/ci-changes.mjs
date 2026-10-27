import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const gates = ["web", "host", "native", "rpm", "browser", "scripts", "python"];
export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
// Literal cross-root includes inventoried by repository-graph.mjs. The
// regression test below checks that new literal embeds cannot go unclassified.
const nativeEmbeddedInputs = new Set([
  "src/shared/model/host-contracts/generated/manifest.json",
  "src/features/social/model/socialClient.ts",
  "host/windows-acl.ps1",
]);

export function classifyChanges(paths, { full = false, reason } = {}) {
  const selected = Object.fromEntries(gates.map((gate) => [gate, false]));
  const files = [];
  const reasons = [];
  const select = (...names) => names.forEach((name) => (selected[name] = true));
  const everything = (why) => {
    full = true;
    reasons.push(why);
    select(...gates);
  };
  if (full || !Array.isArray(paths))
    everything(reason ?? "Full coverage requested or diff unavailable");
  for (const input of Array.isArray(paths) ? paths : []) {
    if (
      typeof input !== "string" ||
      !input ||
      /[\r\n\0]/.test(input) ||
      path.posix.isAbsolute(input) ||
      /^[A-Za-z]:/.test(input) ||
      input.split(/[\\/]/).includes("..")
    ) {
      everything("Invalid changed path");
      continue;
    }
    const file = input.replaceAll("\\", "/").replace(/^\.\//, "");
    files.push(file);
    if (
      /^(docs\/|\.agents\/|\.vscode\/)|^[^/]+\.md$|^LICENSE$/.test(file) ||
      file === ".github/CI.md"
    )
      continue;
    if (file.startsWith("mobile/")) {
      reasons.push("Mobile belongs to its independent repository and checks");
      continue;
    }
    if (/^\.github\/(ISSUE_TEMPLATE\/|pull_request_template\.md$)/.test(file)) {
      select("scripts");
      continue;
    }
    if (
      file.startsWith("scripts/local-update/") ||
      /^scripts\/update-local\.(ps1|sh)$/.test(file)
    ) {
      select("scripts", "python");
      continue;
    }
    // The Host imports src and script fixtures import Host helpers. Native
    // checks need the inventoried Rust includes, not every production UI asset.
    if (/^(src\/|host\/|public\/)/.test(file)) {
      select("web", "host", "browser", "scripts");
      if (nativeEmbeddedInputs.has(file) || file.startsWith("host/fixtures/"))
        select("native", "rpm");
      continue;
    }
    if (/^(src-tauri\/|Cargo\.(toml|lock)$|rust-toolchain|\.?(rustfmt|clippy)\.toml$)/.test(file)) {
      select("web", "host", "native", "rpm", "scripts");
      continue;
    }
    if (file.startsWith("tests/browser/") || file.startsWith("playwright.config.")) {
      select("web", "browser", "scripts");
      continue;
    }
    if (/^(\.github\/|scripts\/|vendor\/|\.cargo\/|patches\/)/.test(file)) {
      everything(`Shared tooling input: ${file}`);
      continue;
    }
    if (
      /^(package(-lock)?\.json|pnpm-(lock|workspace)\.ya?ml|\.npmrc|tsconfig[^/]*\.json|vite(st)?\.config\.[^/]+|index\.html|\.ox[^/]+|\.artifact|\.gitignore|\.gitattributes)$/.test(
        file,
      )
    ) {
      everything(`Shared configuration: ${file}`);
      continue;
    }
    everything(`Unknown input: ${file}`);
  }
  return {
    schemaVersion: 1,
    full,
    files: [...new Set(files)].sort(),
    reasons: [...new Set(reasons)],
    gates: selected,
  };
}

export function detectChanges({
  root = repositoryRoot,
  base = "origin/main",
  full = false,
  ci = false,
  event = process.env.GITHUB_EVENT_NAME,
} = {}) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
  let sourceSha;
  try {
    sourceSha = git("rev-parse", "HEAD").trim();
    if (full || (ci && event !== "pull_request")) {
      return {
        ...classifyChanges([], { full: true, reason: "Main/manual CI retains full coverage" }),
        sourceSha,
      };
    }
    const baseSha = git("merge-base", "HEAD", base).trim();
    // --no-renames emits both paths of renames, including removals. NUL
    // delimiters preserve spaces and prevent quoted filenames hiding inputs.
    const files = git("diff", "--name-only", "--no-renames", "-z", baseSha, "--")
      .split("\0")
      .filter(Boolean);
    if (!ci)
      files.push(
        ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean),
      );
    return { ...classifyChanges(files), sourceSha, baseSha };
  } catch {
    return {
      ...classifyChanges(null, {
        reason: "Git base/diff could not be resolved; running full coverage",
      }),
      ...(sourceSha ? { sourceSha } : {}),
    };
  }
}

export function optionsFromArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (["--full", "--ci", "--json"].includes(argument)) options[argument.slice(2)] = true;
    else if (["--base", "--github-output"].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
      options[argument === "--base" ? "base" : "githubOutput"] = value;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = optionsFromArguments(process.argv.slice(2));
  const decision = detectChanges(options);
  if (options.githubOutput) {
    appendFileSync(
      options.githubOutput,
      `${gates.map((gate) => `${gate}=${decision.gates[gate]}`).join("\n")}\nsource_sha=${decision.sourceSha ?? ""}\n`,
    );
  }
  console.log(JSON.stringify(decision, null, 2));
}
