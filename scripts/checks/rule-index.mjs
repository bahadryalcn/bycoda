/**
 * One list of every static rule the repository enforces.
 *
 * Rules are defined once: TypeScript rules in the oxlint plugin (scripts/checks/oxlint-plugin)
 * and in the `lint` block of vite.config.ts (scripts/checks/lint-config.mjs); Rust rules as ast-grep files; CSS and
 * component-usage rules in the UI drift table. A rule is known by its name alone. This script
 * reads those definitions, rejects a rule that is defined twice or is not switched on, and
 * renders docs/reference/rules.md so contributors and agents read one list.
 *
 *   node scripts/checks/rule-index.mjs           fail when the list is stale or invalid
 *   node scripts/checks/rule-index.mjs --write   regenerate docs/reference/rules.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rules as uiDriftRules } from "./check-ui-drift.mjs";
import { lint } from "./lint-config.mjs";
import { rules as pluginRules } from "./oxlint-plugin/index.mjs";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
export const indexFile = "docs/reference/rules.md";
const pluginName = "bycoda";
const pluginRulesDir = "scripts/checks/oxlint-plugin/rules";
const astGrepRulesDir = "scripts/checks/invariants/rules";
const lintConfig = "scripts/checks/lint-config.mjs";

/**
 * How each engine is run, ratcheted and suppressed; rendered once at the top of the list.
 * oxlint severity decides the ratchet: "error" rules are code invariants, "warn" rules lint debt.
 */
export const engines = {
  "oxlint plugin": {
    definitions: `${pluginRulesDir}/*.mjs`,
    baseline: "scripts/checks/invariants-baseline.json",
    command: "pnpm check:invariants",
    suppress: `// oxlint-disable-next-line ${pluginName}/<rule> -- <reason>`,
  },
  "oxlint error": {
    definitions: `${lintConfig} (rules set to "error")`,
    baseline: "scripts/checks/invariants-baseline.json",
    command: "pnpm check:invariants",
    suppress: "// oxlint-disable-next-line <rule> -- <reason>",
  },
  "oxlint warn": {
    definitions: `${lintConfig} (categories and rules set to "warn")`,
    baseline: "scripts/checks/lint-baseline.json",
    command: "pnpm lint:baseline",
    suppress: "// oxlint-disable-next-line <rule> -- <reason>",
  },
  "ui-drift": {
    definitions: "scripts/checks/check-ui-drift.mjs (rules)",
    baseline: "scripts/checks/ui-drift-baseline.json",
    command: "pnpm check:ui-drift",
    suppress: "// ui-drift-ignore: <rule> -- <reason>",
  },
  "ast-grep (Rust)": {
    definitions: `${astGrepRulesDir}/*.yml`,
    baseline: "scripts/checks/invariants-baseline.json",
    command: "pnpm check:invariants",
    suppress: "// ast-grep-ignore: <rule> -- <reason>",
  },
};

/** What an oxlint rule without a message of its own requires. */
const builtInText = [
  [/^jsx-a11y\//, "Accessibility rule; see the oxlint rule of the same name."],
  [/^react\/no-danger$/, "dangerouslySetInnerHTML only in the reviewed sanitised renderers."],
  [
    /^no-console$/,
    "No console.log/info/debug in UI components; console.warn and console.error report defects.",
  ],
  [
    /^react(?:-hooks-js)?\//,
    "React hooks and React Compiler diagnostic; see the rule of the same name in eslint-plugin-react-hooks.",
  ],
];

const oxlintId = (name) => (name.includes("/") ? name : `oxlint/${name}`);
const severity = (value) => (Array.isArray(value) ? value[0] : value);
const enabled = (value) => severity(value) !== "off";

function yamlString(value) {
  if (value.startsWith('"')) return JSON.parse(value);
  if (value.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

/** ast-grep rule files use a flat subset of YAML: scalar keys and one `files:` list. */
export function parseAstGrepRule(text, file) {
  const scalar = (key) => new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(text)?.[1];
  const id = scalar("id");
  const message = scalar("message");
  if (!id || !message) throw new Error(`${file}: rule needs an id and a message`);
  const files = /^files:\n((?:\s+- .+\n?)+)/m.exec(text)?.[1] ?? "";
  return {
    id,
    engine: "ast-grep (Rust)",
    scope: [...files.matchAll(/- (\S+)/g)].map((match) => yamlString(match[1])).join(", "),
    text: yamlString(message),
    source: file,
  };
}

/** Restricted-API entries of one oxlint rule, as { target, message }. */
function restrictedEntries(name, value) {
  if (!Array.isArray(value)) return [];
  const options = value.slice(1);
  if (name === "no-restricted-imports")
    return options.flatMap((option) =>
      (option.paths ?? []).map((entry) => ({
        target: entry.importNames ? `${entry.name} {${entry.importNames.join(", ")}}` : entry.name,
        message: entry.message,
      })),
    );
  if (name === "no-restricted-globals")
    return options.map((entry) => ({ target: entry.name, message: entry.message }));
  if (name === "no-restricted-properties")
    return options.map((entry) => ({
      target: `${entry.object}.${entry.property}`,
      message: entry.message,
    }));
  return [];
}

/** Rules switched on in the `lint` block, other than the plugin's own. */
function configuredRules(config) {
  const byKey = new Map();
  const add = (name, value, scope) => {
    if (!enabled(value) || name.startsWith(`${pluginName}/`)) return;
    const engine = severity(value) === "error" ? "oxlint error" : "oxlint warn";
    const entries = restrictedEntries(name, value);
    if (entries.length === 0) {
      if (byKey.has(`${name}|`)) return;
      byKey.set(`${name}|`, {
        id: oxlintId(name),
        engine,
        scope,
        text: builtInText.find(([pattern]) => pattern.test(name))?.[1] ?? "",
        source: lintConfig,
      });
      return;
    }
    // Targets banned with the same message are one row.
    for (const { target, message = "" } of entries) {
      const key = `${name}|${message}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.targets.includes(target)) existing.targets.push(target);
        continue;
      }
      byKey.set(key, {
        id: oxlintId(name),
        engine,
        scope,
        targets: [target],
        text: message,
        source: lintConfig,
      });
    }
  };
  for (const [name, value] of Object.entries(config.rules ?? {}))
    add(name, value, "whole repository");
  for (const override of config.overrides ?? [])
    for (const [name, value] of Object.entries(override.rules ?? {}))
      add(name, value, override.files.join(", "));
  return [...byKey.values()];
}

/** The plugin rules the `lint` block switches on, in any of its rule blocks. */
function switchedOn(config) {
  const names = new Set();
  for (const block of [config, ...(config.overrides ?? [])])
    for (const [name, value] of Object.entries(block.rules ?? {}))
      if (name.startsWith(`${pluginName}/`) && enabled(value)) names.add(name);
  return names;
}

/** Every rule definition in the repository, in a stable order. */
export function collectRules(root = defaultRoot) {
  const config = lint;
  const on = switchedOn(config);
  const plugin = Object.entries(pluginRules).map(([name, rule]) => ({
    id: `${pluginName}/${name}`,
    engine: "oxlint plugin",
    scope: rule.meta.files.join(", "),
    text: rule.meta.docs.description,
    source: `${pluginRulesDir}/${name}.mjs`,
    enabled: on.has(`${pluginName}/${name}`),
  }));
  for (const name of on)
    if (!pluginRules[name.slice(pluginName.length + 1)])
      throw new Error(`${lintConfig} enables ${name}, which the plugin does not define`);
  const categories = Object.entries(config.categories ?? {})
    .filter(([, value]) => value !== "off")
    .map(([name]) => ({
      id: `oxlint/${name}`,
      engine: "oxlint warn",
      scope: "whole repository",
      text: `Every rule of the oxlint \`${name}\` category.`,
      source: lintConfig,
    }));
  const uiDrift = Object.entries(uiDriftRules).map(([id, text]) => ({
    id,
    engine: "ui-drift",
    scope: "src/app, src/features, shared stylesheets",
    text,
    source: "scripts/checks/check-ui-drift.mjs",
  }));
  const dir = path.join(root, astGrepRulesDir);
  const astGrep = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".yml"))
    .sort()
    .map((file) =>
      parseAstGrepRule(
        fs.readFileSync(path.join(dir, file), "utf8").replaceAll("\r\n", "\n"),
        `${astGrepRulesDir}/${file}`,
      ),
    );
  return [...plugin, ...configuredRules(config), ...categories, ...uiDrift, ...astGrep];
}

/** A rule is defined in one place only and is switched on. */
export function validateRules(rules) {
  const errors = [];
  const sourceOf = new Map();
  for (const rule of rules) {
    if (rule.enabled === false)
      errors.push(
        `${rule.id} (${rule.source}) is not switched on: set it to "error" in ${lintConfig}.`,
      );
    const first = sourceOf.get(rule.id);
    if (first && first !== rule.source)
      errors.push(
        `${rule.id} is defined in ${first} and in ${rule.source}: keep one definition and delete the other.`,
      );
    sourceOf.set(rule.id, rule.source);
  }
  return errors;
}

/** Bare `<tag>` in rule text would render as HTML; code spans stay as written. */
const escapeText = (text) =>
  text
    .split("`")
    .map((part, index) => (index % 2 ? part : part.replaceAll("<", "\\<")))
    .join("`");

export function renderIndex(rules) {
  const lines = [
    "# Rule set",
    "",
    "<!-- Generated by `node scripts/checks/rule-index.mjs --write`. Do not edit by hand. -->",
    "",
    "Every static rule this repository enforces, in one list. A rule is defined once; this page",
    "is generated from those definitions, and `pnpm check:rule-index` fails when it is stale,",
    "when a rule is defined in two places or is not switched on.",
    "",
    "TypeScript rules written for this repository live in one oxlint plugin,",
    "`scripts/checks/oxlint-plugin`: one file per rule with its message and file scope. They are",
    "switched on in the `lint` block of `vite.config.ts` (Vite+, `vp lint`), which lives in",
    "`scripts/checks/lint-config.mjs`, next to the API bans and the lint categories. Rust rules",
    "are ast-grep files; CSS and component-usage rules are the UI drift table.",
    "",
    "A rule is known by its name. The rationale and the sanctioned helper behind each code",
    "invariant are in [code-invariants.md](code-invariants.md); UI conventions are explained in",
    "[ui-design-system.md](ui-design-system.md).",
    "",
    'In the `lint` block a rule set to `"error"` is a code invariant and a rule set to `"warn"`',
    "is lint debt; the two are counted in separate baselines.",
    "",
    "`pnpm check:rules` runs every engine below. Each one is a ratchet: existing findings are",
    "counted per file and rule in its baseline, only new findings fail, and baselines may only",
    "fall. Suppress one line only, always with a reason.",
    "",
    "## Engines",
    "",
  ];
  for (const [name, engine] of Object.entries(engines)) {
    lines.push(
      `- **${name}**: \`${engine.command}\``,
      `  - Definitions: \`${engine.definitions}\``,
      `  - Baseline: \`${engine.baseline}\``,
      `  - Suppress: \`${engine.suppress}\``,
    );
  }
  lines.push("", "## Rules", "");
  const sections = [...new Set([...Object.keys(engines), ...rules.map((rule) => rule.engine)])];
  for (const engine of sections) {
    const sorted = rules
      .filter((rule) => rule.engine === engine)
      .toSorted((a, b) => a.id.localeCompare(b.id));
    if (!sorted.length) continue;
    lines.push(`### ${engine}`, "");
    for (const rule of sorted) {
      const targets = rule.targets ? `: ${rule.targets.map((t) => `\`${t}\``).join(", ")}` : "";
      lines.push(`- \`${rule.id}\`${targets} (\`${rule.scope}\`)`);
      if (rule.text) lines.push(`  - ${escapeText(rule.text)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Programmatic entry: { errors, stale, text, count }. */
export function checkRuleIndex({ root = defaultRoot } = {}) {
  const rules = collectRules(root);
  const errors = validateRules(rules);
  const text = renderIndex(rules);
  const file = path.join(root, indexFile);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n") : "";
  return { errors, stale: current !== text, text, count: rules.length };
}

function main(argv) {
  const result = checkRuleIndex();
  for (const error of result.errors) console.error(error);
  if (result.errors.length) return 1;
  if (argv.includes("--write")) {
    fs.writeFileSync(path.join(defaultRoot, indexFile), result.text);
    console.log(`Rule set: wrote ${result.count} rules to ${indexFile}.`);
    return 0;
  }
  if (result.stale) {
    console.error(
      `${indexFile} is stale: a rule definition changed. Run \`node scripts/checks/rule-index.mjs --write\` and review the diff.`,
    );
    return 1;
  }
  console.log(`Rule set: ${result.count} rules, one definition each, ${indexFile} is current.`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exitCode = main(process.argv.slice(2));
