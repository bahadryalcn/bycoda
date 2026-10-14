import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ClaudeCommandEntry } from "../src/platform/tauri/fs";
import { claudePluginRoots } from "./skills";

/** Bounded metadata discovery with project/user/plugin precedence. */
export async function listHostClaudeCommands(
  project: string,
  home = homedir(),
): Promise<ClaudeCommandEntry[]> {
  const out = new Map<string, ClaudeCommandEntry>();
  const scan = async (
    root: string,
    prefix: string,
    scope: ClaudeCommandEntry["scope"],
    depth = 0,
  ): Promise<void> => {
    if (depth > 4 || out.size >= 300) return;
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.size >= 300) break;
      if (entry.name.startsWith(".")) continue;
      const name = prefix
        ? `${prefix}:${entry.name.replace(/\.md$/, "")}`
        : entry.name.replace(/\.md$/, "");
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        await scan(path, prefix ? `${prefix}:${entry.name}` : entry.name, scope, depth + 1);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        /^[A-Za-z0-9_.:-]+$/.test(name) &&
        !out.has(name)
      ) {
        const file = await open(path, "r").catch(() => undefined);
        if (!file) continue;
        let head: string;
        try {
          const buffer = Buffer.alloc(16 * 1024);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          head = buffer
            .subarray(0, bytesRead)
            .toString("utf8")
            .replace(/^\uFEFF/, "");
        } finally {
          await file.close();
        }
        const front = head.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        const value = (key: string) =>
          (front?.[1].match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1] ?? "")
            .trim()
            .replace(/^['"]|['"]$/g, "");
        const body = front ? head.slice(front[0].length) : head;
        out.set(name, {
          name,
          description:
            value("description") ||
            (
              body
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => line && !line.startsWith("#")) ?? ""
            ).slice(0, 200),
          argumentHint: value("argument-hint"),
          scope,
        });
      }
    }
  };
  await scan(join(project, ".claude/commands"), "", "project");
  await scan(join(home, ".claude/commands"), "", "user");
  for (const plugin of claudePluginRoots(home, project))
    await scan(join(dirname(plugin.root), "commands"), plugin.namespace, "plugin");
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
