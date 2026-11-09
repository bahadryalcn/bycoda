/** Advisory passive Git diff data; never labels, closes, approves or blocks a PR by size. */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
export function category(file) {
  if (/(?:^|\/)(?:generated|__generated__)(?:\/|$)|(?:pnpm-lock\.yaml|Cargo\.lock)$/.test(file))
    return "generated";
  if (/\.(?:test|spec|e2e)\.|(?:^|\/)(?:tests|__tests__|fixtures)(?:\/|$)/.test(file))
    return "tests";
  if (/\/locales\/|(?:^|\/)i18n\/.+\.json$/.test(file)) return "locales";
  if (/\.md$|^docs\//.test(file)) return "docs";
  if (/^(?:scripts|\.github|\.agents)\//.test(file)) return "tooling";
  return "production";
}
export function parseNumstat(text) {
  const fields = text.split("\0");
  if (fields.at(-1) !== "") throw new Error("Diff must be NUL terminated");
  fields.pop();
  const files = [];
  for (let index = 0; index < fields.length; index++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[index]);
    if (!match || (match[1] === "-") !== (match[2] === "-"))
      throw new Error("Malformed Git numstat");
    const renamed = match[3] === "";
    const oldPath = renamed ? fields[++index] : null;
    const file = renamed ? fields[++index] : match[3];
    if (!file || (renamed && !oldPath)) throw new Error("Incomplete rename record");
    const additions = match[1] === "-" ? null : Number(match[1]);
    const deletions = match[2] === "-" ? null : Number(match[2]);
    if (
      additions !== null &&
      (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions))
    )
      throw new Error("Diff count exceeds safe range");
    files.push({
      path: file,
      oldPath,
      renamed,
      category: category(file),
      additions,
      deletions,
      binary: additions === null,
    });
  }
  return files;
}
export function reviewReport(files, identity) {
  const groups = Object.fromEntries(
    ["production", "tests", "generated", "locales", "docs", "tooling"].map((key) => [
      key,
      { files: 0, additions: 0, deletions: 0, binary: 0, renames: 0 },
    ]),
  );
  for (const file of files) {
    const group = groups[file.category];
    group.files++;
    group.additions += file.additions ?? 0;
    group.deletions += file.deletions ?? 0;
    group.binary += Number(file.binary);
    group.renames += Number(file.renamed);
  }
  return {
    schemaVersion: 1,
    ...identity,
    advisory: true,
    scope:
      "Line/file counts only; binary content, moves and generated changes still require review. No eligibility or automatic action.",
    groups,
    files,
  };
}
export function summary(report) {
  return [
    "### Advisory review scope",
    "",
    "Size never decides merge eligibility. Binary changes have unknown line counts; renamed files are shown separately.",
    "",
    "| Area | Files | Added | Removed | Binary | Renamed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.groups).map(
      ([name, group]) =>
        `| ${name} | ${group.files} | ${group.additions} | ${group.deletions} | ${group.binary} | ${group.renames} |`,
    ),
    "",
  ].join("\n");
}
export function fromGit({ root = defaultRoot, base, head = "HEAD" }) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
  const oid = (ref) => git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim();
  if (!base) throw new Error("An explicit diff base is required");
  const baseSha = oid(base),
    headSha = oid(head);
  const bytes = git("diff", "--numstat", "--find-renames", "-z", baseSha, headSha, "--");
  return reviewReport(parseNumstat(bytes), { baseSha, headSha });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (
      !["--base", "--head", "--output"].includes(args[index]) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--")
    )
      throw new Error("Usage: --base REF [--head REF] [--output temp/...json]");
    options[args[index].slice(2)] = args[index + 1];
  }
  const report = fromGit(options);
  if (options.output) {
    const output = resolve(defaultRoot, options.output);
    if (
      !output.startsWith(resolve(defaultRoot, "temp") + (process.platform === "win32" ? "\\" : "/"))
    )
      throw new Error("Reports belong under temp/");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(report));
  console.log(
    JSON.stringify(
      { ...report, files: `${report.files.length} file records (see artifact)` },
      null,
      2,
    ),
  );
}
