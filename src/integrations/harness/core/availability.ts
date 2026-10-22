import type { HarnessId } from "../../../features/sessions/model/session";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  HARNESSES,
  setHarnessAttachmentsSupported,
  setHarnessModeLimits,
} from "../../../features/sessions/model/session";
import {
  resolveAntigravityBinary,
  resolveClaudeBinary,
  resolveCodexBinary,
  resolveCursorBinary,
  resolveFxBinary,
  resolveGrokBinary,
  resolveHermesBinary,
  resolveOmpBinary,
  resolveOpenCodeBinary,
  resolvePiBinary,
  invokeProviderCommand,
} from "./child";
import { STREAM_MODE_LIMITS } from "../providers/antigravity/antigravityStreamProtocol";
import { isLiveHarness } from "./registry";
import {
  emitHarnessAvailability,
  harnessAvailabilityProbedAt,
  markHarnessAvailabilityProbed,
  setHarnessAvailability,
  type HarnessAvailability,
} from "./availabilityState";

export type { HarnessAvailability } from "./availabilityState";
export {
  getHarnessAvailabilitySnapshot,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  subscribeHarnessAvailability,
} from "./availabilityState";

/**
 * We only ever check whether the binary exists, never whether it is
 * authenticated, so the hint must not blame a login.
 */
const CLI: Record<HarnessId, { name: string; install?: string }> = {
  acp: {
    name: "Configured ACP agent",
    install: "Add a local command or install an agent in ACP settings",
  },
  claude: { name: "Claude Code CLI" },
  codex: { name: "Codex CLI" },
  cursor: { name: "Cursor CLI" },
  grok: {
    name: "Grok Build CLI",
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  opencode: { name: "OpenCode CLI" },
  pi: { name: "Pi CLI", install: "npm i -g @earendil-works/pi-coding-agent" },
  omp: { name: "omp CLI", install: "curl -fsSL https://omp.sh/install | sh" },
  fx: { name: "fx CLI", install: "curl -fsSL https://fx.sh/setup.sh | bash" },
  hermes: {
    name: "Hermes Agent CLI",
    install: "Install from hermes-agent.nousresearch.com, then run hermes model",
  },
  antigravity: {
    name: "Antigravity CLI",
    install: "https://antigravity.google/docs/cli/install/",
  },
};

let inflight: Promise<void> | null = null;

/**
 * A probe stats ~100 paths across the resolvers. The model picker and the
 * providers pane both probe on open, so without a TTL every open pays for it
 * again to learn what it already knows. Installing a CLI mid-session is rare,
 * and `force` covers it.
 */
const PROBE_TTL_MS = 30_000;

export function harnessUnavailableHint(id: HarnessId): string {
  const { name, install } = CLI[id];
  const how = install ? ` (\`${install}\`)` : "";
  return `${name} not found${how}. Install it, or restart ${PRODUCT_IDENTITY.displayName} if it is already installed.`;
}

export function probeHarnessAvailability(options?: { force?: boolean }): Promise<void> {
  if (inflight) return inflight;
  const lastProbe = harnessAvailabilityProbedAt();
  if (!options?.force && lastProbe > 0 && Date.now() - lastProbe < PROBE_TTL_MS) {
    return Promise.resolve();
  }
  inflight = Promise.all(
    HARNESSES.map(async (id) => {
      if (!isLiveHarness(id)) return [id, false] as const;
      if (id === "acp") {
        try {
          const configs = await invokeProviderCommand<unknown[]>("generic_acp_list");
          return [id, configs.length > 0] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "cursor") {
        try {
          await resolveCursorBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "claude") {
        try {
          await resolveClaudeBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "codex") {
        try {
          await resolveCodexBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "opencode") {
        try {
          await resolveOpenCodeBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "pi") {
        try {
          await resolvePiBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "omp") {
        try {
          await resolveOmpBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "fx") {
        try {
          await resolveFxBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "grok") {
        try {
          await resolveGrokBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "hermes") {
        try {
          await resolveHermesBinary();
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      if (id === "antigravity") {
        try {
          const binary = await resolveAntigravityBinary();
          // The agy CLI transport has no way to carry attachments.
          setHarnessAttachmentsSupported("antigravity", binary.transport !== "stream-json");
          // The same transport cannot ask before editing or hold a plan turn
          // back, so the pickers must not offer those.
          setHarnessModeLimits(
            "antigravity",
            binary.transport === "stream-json" ? STREAM_MODE_LIMITS : undefined,
          );
          return [id, true] as const;
        } catch {
          return [id, false] as const;
        }
      }
      return [id, false] as const;
    }),
  )
    .then((entries) => {
      const next = {} as HarnessAvailability;
      for (const [id, ok] of entries) next[id] = ok;
      setHarnessAvailability(next);
      emitHarnessAvailability();
    })
    .finally(() => {
      markHarnessAvailabilityProbed();
      inflight = null;
    });
  return inflight;
}
