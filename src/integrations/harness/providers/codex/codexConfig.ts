import type { HarnessSessionInput } from "../../core/types";

type RuntimeMode = HarnessSessionInput["runtimeMode"];
import { nativeReadOnly } from "../../core/nativeToolLimits";

/** Codex approval / sandbox settings for thread/start and turn/start. */
export type CodexThreadConfig = {
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  approvalsReviewer: "user" | "auto_review";
  sandboxPolicy:
    | { type: "readOnly"; networkAccess?: boolean }
    | {
        type: "workspaceWrite";
        networkAccess?: boolean;
        writableRoots?: string[];
      }
    | { type: "dangerFullAccess" };
};

/**
 * Lets a workspace-write sandbox edit folders beyond the cwd. Read-only and
 * full-access policies need nothing: reads are not confined to the cwd.
 */
export function withWritableRoots(
  config: CodexThreadConfig,
  additionalDirs?: readonly string[],
): CodexThreadConfig {
  if (!additionalDirs?.length || config.sandboxPolicy.type !== "workspaceWrite") return config;
  return {
    ...config,
    sandboxPolicy: {
      ...config.sandboxPolicy,
      writableRoots: [...additionalDirs],
    },
  };
}

/**
 * `readOnly` and `workspaceWrite` both default to networkAccess: false, which
 * blocks loopback too. An orchestration lead or a /operator-enabled thread
 * needs the local CLI socket, so its turns enable network access.
 */
export function withNetwork(
  config: CodexThreadConfig,
  controlsAgents?: boolean,
): CodexThreadConfig {
  if (!controlsAgents || config.sandboxPolicy.type === "dangerFullAccess") return config;
  return {
    ...config,
    sandboxPolicy: { ...config.sandboxPolicy, networkAccess: true },
  };
}

/** Crew read-only member: no writes and no escalation path, whatever the run's mode. */
const READ_ONLY_CONFIG: CodexThreadConfig = {
  approvalPolicy: "never",
  sandbox: "read-only",
  approvalsReviewer: "user",
  sandboxPolicy: { type: "readOnly" },
};

/** Launch inputs every Codex thread/turn start derives its sandbox from. */
export const codexMode = (input: {
  runtimeMode: RuntimeMode;
  controlsAgents?: boolean;
  modelSettings?: Readonly<Record<string, string>>;
}) => ({
  runtimeMode: input.runtimeMode,
  controlsAgents: input.controlsAgents,
  readOnly: nativeReadOnly(input.modelSettings),
});

export function runtimeModeToCodexConfig(
  mode: RuntimeMode,
  controlsAgents?: boolean,
  readOnly?: boolean,
): CodexThreadConfig {
  return withNetwork(readOnly ? READ_ONLY_CONFIG : baseCodexConfig(mode), controlsAgents);
}

function baseCodexConfig(mode: RuntimeMode): CodexThreadConfig {
  switch (mode) {
    case "supervised":
      return {
        approvalPolicy: "untrusted",
        sandbox: "read-only",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly" },
      };
    case "auto-accept-edits":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "workspaceWrite" },
      };
    case "auto":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        approvalsReviewer: "auto_review",
        sandboxPolicy: { type: "workspaceWrite" },
      };
    case "full-access":
      return {
        // Explicit escalations still need an approval round-trip. "never"
        // rejects them before the client's full-access handler can allow them.
        approvalPolicy: "on-request",
        sandbox: "danger-full-access",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "dangerFullAccess" },
      };
  }
}
