import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import bycoda from "./app-skills/bycoda/SKILL.md?raw";
import bycodaWork from "./app-skills/bycoda/references/work.md?raw";
import bycodaWorkspace from "./app-skills/bycoda/references/workspace.md?raw";
import bycodaRuntime from "./app-skills/bycoda/references/runtime.md?raw";
import bycodaInboxSocial from "./app-skills/bycoda/references/inbox-social.md?raw";
import bycodaSkillRouter from "./app-skills/bycoda-skill-router/SKILL.md?raw";
import { appSkillsRoot } from "./skills";

/** App-owned skills bundled into the host, keyed by skill folder then relative path. */
export const APP_SKILLS: Record<string, Record<string, string>> = {
  bycoda: {
    "SKILL.md": bycoda,
    "references/work.md": bycodaWork,
    "references/workspace.md": bycodaWorkspace,
    "references/runtime.md": bycodaRuntime,
    "references/inbox-social.md": bycodaInboxSocial,
  },
  "bycoda-skill-router": {
    "SKILL.md": bycodaSkillRouter,
  },
};

/** Mirror the bundled skills on disk so every provider and skills.read sees this version. */
export function installAppSkills(home = homedir()): void {
  const root = appSkillsRoot(home);
  for (const [name, files] of Object.entries(APP_SKILLS)) {
    const dir = join(root, name);
    for (const [path, text] of Object.entries(files)) {
      const file = join(dir, path);
      let current: string | undefined;
      try {
        current = readFileSync(file, "utf8");
      } catch {
        /* first install */
      }
      if (current === text) continue;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(entry.parentPath, entry.name);
      if (!(relative(dir, file).replace(/\\/g, "/") in files)) rmSync(file, { force: true });
    }
  }
}
