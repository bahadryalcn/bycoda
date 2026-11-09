import { joinPath } from "../../../shared/lib/paths";
import type { ProjectAction } from "./projectActions";

export type ProjectActionPreset = Pick<ProjectAction, "name" | "command" | "icon" | "url"> & {
  devServer?: boolean;
  /** Where the preset came from, shown next to the chips. */
  source: "package.json" | "Cargo.toml";
};

type PresetIO = {
  read: (path: string) => Promise<string>;
  exists: (paths: string[]) => Promise<boolean[]>;
};

const LOCKFILES = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
] as const;
// Default ports of common dev servers, used only when the script names no port.
const TOOL_PORTS: [RegExp, number][] = [
  [/\bvite\b.*\bpreview\b/, 4173],
  [/\bvite\b/, 5173],
  [/\bnext\b/, 3000],
  [/\bnuxi?\b/, 3000],
  [/\bastro\b/, 4321],
  [/\b(react-scripts|remix|react-router)\b/, 3000],
  [/\bng serve\b/, 4200],
  [/\bsvelte-kit\b/, 5173],
];
const SERVER_SCRIPTS = /^(dev|start|serve|preview)(:|$)/;
/** Script names that start a long-running local server; `preview` serves a build instead. */
export const isServerScriptName = (name: string) => SERVER_SCRIPTS.test(name) && name !== "preview";
const RANK = ["dev", "start", "test", "build", "lint", "typecheck", "preview", "serve"];
const MAX_SCRIPTS = 200;

/** Package manager from `packageManager`, then lockfiles; npm when nothing says otherwise. */
async function packageManager(cwd: string, manifest: Record<string, unknown>, io: PresetIO) {
  const declared =
    typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : "";
  if (["pnpm", "yarn", "bun", "npm"].includes(declared)) return declared;
  const found = await io.exists(LOCKFILES.map(([file]) => joinPath(cwd, file))).catch(() => []);
  return LOCKFILES.find((_, index) => found[index])?.[1] ?? "npm";
}

function serverUrl(script: string): string {
  const port =
    /(?:--port[ =]|-p\s+|PORT=)(\d{2,5})\b/.exec(script)?.[1] ??
    TOOL_PORTS.find(([pattern]) => pattern.test(script))?.[1];
  return port ? `http://localhost:${port}` : "";
}

function scriptPreset(pm: string, name: string, script: string): ProjectActionPreset {
  const server = SERVER_SCRIPTS.test(name);
  const command = pm === "npm" && name === "test" ? "npm test" : `${pm} run ${name}`;
  return {
    name,
    command,
    icon: server
      ? "play"
      : /^(build|compile|bundle)/.test(name)
        ? "wrench"
        : /^(test|lint|typecheck|check)/.test(name)
          ? "code"
          : "terminal",
    url: server ? serverUrl(script) : "",
    devServer: isServerScriptName(name) ? true : undefined,
    source: "package.json",
  };
}

const rank = (name: string) => {
  const index = RANK.indexOf(name);
  return index < 0 ? RANK.length : index;
};

/**
 * Suggested actions for a project folder, read from its manifest. Missing or invalid
 * manifests yield no suggestions; nothing in the project runs.
 */
export async function detectProjectActionPresets(
  cwd: string,
  io: PresetIO,
): Promise<ProjectActionPreset[]> {
  try {
    const manifest = JSON.parse(await io.read(joinPath(cwd, "package.json"))) as Record<
      string,
      unknown
    >;
    const scripts = manifest.scripts;
    if (scripts && typeof scripts === "object") {
      const pm = await packageManager(cwd, manifest, io);
      return Object.entries(scripts as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .filter(
          ([name]) => !/^(pre|post)/.test(name) || !(name.replace(/^(pre|post)/, "") in scripts),
        )
        .slice(0, MAX_SCRIPTS)
        .map(([name, script]) => scriptPreset(pm, name, script))
        .sort((a, b) => rank(a.name) - rank(b.name));
    }
  } catch {
    /* No usable package.json; try the next manifest. */
  }
  try {
    await io.read(joinPath(cwd, "Cargo.toml"));
    return [
      {
        name: "run",
        command: "cargo run",
        icon: "play",
        url: "",
        source: "Cargo.toml",
      },
      {
        name: "test",
        command: "cargo test",
        icon: "code",
        url: "",
        source: "Cargo.toml",
      },
      {
        name: "build",
        command: "cargo build",
        icon: "wrench",
        url: "",
        source: "Cargo.toml",
      },
    ];
  } catch {
    return [];
  }
}
