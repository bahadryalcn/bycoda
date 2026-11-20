import { redactDiagnosticText } from "@bycoda/account-contracts";
import type { HarnessId } from "../../../features/sessions/model/session";
import { errorText } from "../../../shared/lib/errors";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { withTimeout } from "../../../shared/lib/withTimeout";
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
  isHarnessAvailable,
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

/**
 * One resolver call may not outlive this. A remote Host that stops answering
 * would otherwise pin the shared probe forever, and `force` returns the pinned
 * probe too.
 */
const PROBE_CALL_TIMEOUT_MS = 10_000;

/**
 * `harness_resolve_*` rejects with "<name> CLI not found. ..." (Antigravity
 * puts the executable in parentheses before "not found") only when the binary
 * is absent. Any other rejection is an IPC, Host or runtime failure that says
 * nothing about whether the CLI is installed.
 */
const BINARY_NOT_FOUND = /\bCLI(?: \([^)]*\))? not found\b/;

/** `present` / `missing` are answers; `failed` means the probe learned nothing about this provider. */
type ProbeOutcome = "present" | "missing" | "failed";

function safeErrorText(error: unknown): string {
  return redactDiagnosticText(errorText(error));
}

async function probeOne(id: HarnessId, check: () => Promise<boolean>): Promise<ProbeOutcome> {
  try {
    return (await withTimeout(check(), PROBE_CALL_TIMEOUT_MS, `${id} availability probe`))
      ? "present"
      : "missing";
  } catch (error) {
    const text = safeErrorText(error);
    if (BINARY_NOT_FOUND.test(text)) return "missing";
    console.warn(`[harness] availability probe for "${id}" failed: ${text}`);
    return "failed";
  }
}

/** Resolves a binary; resolving at all means it exists. */
function exists(resolve: () => Promise<unknown>): () => Promise<boolean> {
  return async () => {
    await resolve();
    return true;
  };
}

const CHECKS: Partial<Record<HarnessId, () => Promise<boolean>>> = {
  acp: async () => {
    const configs = await invokeProviderCommand<unknown[]>("generic_acp_list");
    return configs.length > 0;
  },
  cursor: exists(() => resolveCursorBinary()),
  claude: exists(() => resolveClaudeBinary()),
  codex: exists(() => resolveCodexBinary()),
  opencode: exists(() => resolveOpenCodeBinary()),
  pi: exists(() => resolvePiBinary()),
  omp: exists(() => resolveOmpBinary()),
  fx: exists(() => resolveFxBinary()),
  grok: exists(() => resolveGrokBinary()),
  hermes: exists(() => resolveHermesBinary()),
  antigravity: async () => {
    const binary = await resolveAntigravityBinary();
    // The agy CLI transport has no way to carry attachments.
    setHarnessAttachmentsSupported("antigravity", binary.transport !== "stream-json");
    // The same transport cannot ask before editing or hold a plan turn
    // back, so the pickers must not offer those.
    setHarnessModeLimits(
      "antigravity",
      binary.transport === "stream-json" ? STREAM_MODE_LIMITS : undefined,
    );
    return true;
  },
};

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
      const check = CHECKS[id];
      if (!check || !isLiveHarness(id)) return [id, "missing"] as const;
      return [id, await probeOne(id, check)] as const;
    }),
  )
    .then((entries) => {
      const next = {} as HarnessAvailability;
      let complete = true;
      for (const [id, outcome] of entries) {
        // A failed probe keeps what we knew: it is not evidence the CLI is gone.
        next[id] = outcome === "failed" ? isHarnessAvailable(id) : outcome === "present";
        if (outcome === "failed") complete = false;
      }
      setHarnessAvailability(next);
      // Only a probe that answered for every provider may count as done: that
      // starts the TTL and lets the UI claim "not found". Otherwise the next
      // call retries instead of serving the failure from cache.
      if (complete) markHarnessAvailabilityProbed();
      emitHarnessAvailability();
    })
    .finally(() => {
      inflight = null;
      // Subscribers waiting on the first probe read "probed" only after the mark above.
      emitHarnessAvailability();
    });
  return inflight;
}
