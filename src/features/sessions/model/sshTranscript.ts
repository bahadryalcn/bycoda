import type { useT } from "../../../shared/i18n";
import type { Block } from "./session";

export type SshActivity = {
  requestId: string;
  command: string;
  startedAt: number;
  state: string;
  output: string;
  exitCode: number | null;
  remoteOutcomeUnknown: boolean;
  truncated: boolean;
};

function commandStatus(receipt: SshActivity): string {
  if (receipt.remoteOutcomeUnknown) return "interrupted";
  switch (receipt.state) {
    case "running":
      return "running";
    case "exited":
      return receipt.exitCode === 0 ? "completed" : "failed";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
    default:
      return "interrupted";
  }
}

/** Project desktop-owned SSH observations into the ordinary, read-only tool trail. */
export function sshTranscript(
  blocks: Block[],
  activity: readonly SshActivity[],
  t: ReturnType<typeof useT>,
): Block[] {
  if (!activity.length) return blocks;
  const result = blocks.slice();
  for (const receipt of [...activity].sort((first, second) => first.startedAt - second.startedAt)) {
    // Native approval already has its own owner-facing prompt.
    if (receipt.state === "pendingApproval") continue;
    let owner = result.length - 1;
    for (; owner >= 0; owner -= 1) {
      const block = result[owner]!;
      if (
        block.role === "user" &&
        !block.draft &&
        block.startedAt != null &&
        block.startedAt <= receipt.startedAt
      )
        break;
    }
    if (owner === -1) continue;
    const id = `ssh-command:${result[owner]!.id}:${receipt.requestId}`;
    if (result.some((block) => block.id === id)) continue;
    let end = owner + 1;
    while (end < result.length && result[end]!.role !== "user") end += 1;
    // Keep the command in the activity trail above the agent's closing response.
    while (end > owner + 1 && result[end - 1]!.role === "assistant") end -= 1;
    const status = commandStatus(receipt);
    const detail =
      status === "interrupted"
        ? t("Outcome unknown")
        : status === "failed" && receipt.exitCode != null
          ? t("failed (exit code {p0})", { p0: receipt.exitCode })
          : undefined;
    result.splice(end, 0, {
      id,
      role: "tool",
      text: receipt.command,
      tool: {
        kind: "execute",
        status,
        detail,
        output: receipt.output,
        outputTruncated: receipt.truncated,
        preview: {
          kind: "shell",
          title: receipt.command,
          inspection: { kind: "command", text: receipt.command },
        },
      },
    });
  }
  return result.length === blocks.length ? blocks : result;
}
