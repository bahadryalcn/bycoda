import type { DiagnosticSection } from "@bycoda/account-contracts";
import { rpcErrorCode } from "./breadcrumbs";
import { recordUiLog } from "./uiLogBuffer";

export const REMOTE_HOST_LIMIT = 3;
export const REMOTE_HOST_DEADLINE_MS = 4_000;
const METHOD = "diagnostics.logs.read";

/** Where to find remote Hosts; the app layer supplies the connected, non-local ones. */
export type RemoteHostLogSource = {
  hosts: () => string[];
  request: (hostId: string, method: string) => Promise<unknown>;
};

const BASE: Record<string, string> = {
  host: "remote-host",
  "host-crash": "remote-host-crash",
  "host-environment": "remote-host-env",
};

/** `remote-host`, and `remote-host-2` for the second Host. Only the latest logs are kept. */
export function remoteSectionName(name: string, index: number): string | null {
  const base = BASE[name];
  return base ? (index === 0 ? base : `${base}-${index + 1}`) : null;
}

type Answer = { hostVersion: string; sections: DiagnosticSection[] };

function parse(value: unknown, index: number): Answer | null {
  if (typeof value !== "object" || value === null) return null;
  const { hostVersion, sections } = value as { hostVersion?: unknown; sections?: unknown };
  if (!Array.isArray(sections)) return null;
  const out: DiagnosticSection[] = [];
  for (const entry of sections) {
    const section = entry as { name?: unknown; text?: unknown; truncated?: unknown };
    if (typeof section?.name !== "string" || typeof section.text !== "string") continue;
    const name = remoteSectionName(section.name, index);
    if (name) out.push({ name, text: section.text, truncated: section.truncated === true });
  }
  return {
    hostVersion: typeof hostVersion === "string" ? hostVersion.slice(0, 64) : "",
    sections: out,
  };
}

async function readOne(source: RemoteHostLogSource, id: string, index: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      source.request(id, METHOD),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), REMOTE_HOST_DEADLINE_MS);
      }),
    ]);
    return parse(value, index);
  } catch (error) {
    // -- an older Host without the capability or an unreachable one: the report goes on without it.
    recordUiLog("info", "ui.diagnostics", "remote host logs unavailable", {
      host: index + 1,
      code: rpcErrorCode(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads up to three remote Hosts in parallel; failures are skipped. Sections keep Host order. */
export async function collectRemoteHostLogs(
  source: RemoteHostLogSource | undefined,
): Promise<{ sections: DiagnosticSection[]; versions: string[] }> {
  if (!source) return { sections: [], versions: [] };
  let ids: string[];
  try {
    ids = source.hosts().slice(0, REMOTE_HOST_LIMIT);
  } catch {
    return { sections: [], versions: [] };
  }
  const answers = await Promise.all(ids.map((id, index) => readOne(source, id, index)));
  const found = answers.filter((answer): answer is Answer => answer !== null);
  return {
    sections: found.flatMap((answer) => answer.sections),
    versions: found.map((answer) => answer.hostVersion).filter(Boolean),
  };
}

const LOW_PRIORITY = /-(previous|stdout)(-\d)?$/;

/**
 * Keeps at most `max` non-empty sections in order. Over the limit, older-run and stdout
 * sections go first (last listed first), then the last-listed remaining ones.
 */
export function limitSections(sections: DiagnosticSection[], max: number): DiagnosticSection[] {
  const kept = sections.filter((section) => section.text.trim().length > 0);
  const drop = (pick: (section: DiagnosticSection) => boolean) => {
    for (let i = kept.length - 1; i >= 0 && kept.length > max; i--) {
      if (pick(kept[i]!)) kept.splice(i, 1);
    }
  };
  drop((section) => LOW_PRIORITY.test(section.name));
  drop(() => true);
  return kept;
}
