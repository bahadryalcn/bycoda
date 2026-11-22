import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { REMOTE_PATH_PREFIX } from "../../../shared/lib/remotePaths";
import { withTimeout } from "../../../shared/lib/withTimeout";
import {
  DecisionRequestSchema,
  DecisionResultSchema,
} from "../../../shared/model/host-contracts/decision-models";
import { remoteMachineFor, remoteRequest } from "../../connections/public/connections";
import { parseRemotePath } from "../../connections/public/remoteProjects";

export type VoiceWorkLayoutContext = {
  projectPath: string;
  scopeId: string;
  expectedEnvironmentId?: string;
};

export type VoiceWorkLayoutFacts = {
  statuses: Record<"running" | "done" | "failed" | "stopped" | "interrupted", number>;
  sourceCounts: number[];
};

const layoutSchema = z.enum(["status_ring", "table_first", "source_bars", "table_only"]);
const sortSchema = z.enum(["activity", "status", "source"]);

export type VoiceWorkLayout = {
  layout: z.infer<typeof layoutSchema>;
  sort: z.infer<typeof sortSchema>;
};

const layouts = {
  status_ring: "Show work status counts in a donut chart, then the work table.",
  table_first: "Show the work table first, then the status donut chart.",
  source_bars: "Compare counts by work source in a bar chart, then show the work table.",
  table_only: "Show just the compact work table, without a chart.",
};

export async function requestVoiceWorkLayout(
  { projectPath, expectedEnvironmentId }: VoiceWorkLayoutContext,
  facts: VoiceWorkLayoutFacts,
  signal: AbortSignal,
): Promise<VoiceWorkLayout | null> {
  const remote = parseRemotePath(projectPath);
  if (!projectPath.trim() || (!remote && projectPath.startsWith(REMOTE_PATH_PREFIX))) return null;
  if (remote && expectedEnvironmentId && remote.environmentId !== expectedEnvironmentId)
    return null;
  const compareSources = facts.sourceCounts.length > 1;
  const { source_bars, ...baseLayouts } = layouts;
  const params = DecisionRequestSchema.parse({
    taskType: "generic",
    personalData: false,
    state: { statusCounts: facts.statuses, sourceCounts: facts.sourceCounts },
    questions: {
      layout: {
        type: "choice",
        instructions: "Choose the clearest read-only presentation for these aggregate work counts.",
        criteria: compareSources ? { ...baseLayouts, source_bars } : baseLayouts,
      },
      sort: {
        type: "choice",
        instructions: "Choose the first ordering for the work table.",
        criteria: {
          activity: "Keep the current activity order.",
          status: "Group the same status.",
          source: "Group the same source.",
        },
      },
    },
    timeoutMs: 8_000,
  });

  signal.throwIfAborted();
  const machine = await withTimeout(
    remote
      ? remoteMachineFor(remote.environmentId)
      : invoke<{ id: string; environmentId: string } | null>("local_host_connect"),
    5_000,
    "Host discovery",
  );
  signal.throwIfAborted();
  const environmentId = remote?.environmentId ?? expectedEnvironmentId;
  if (!machine?.environmentId || (environmentId && machine.environmentId !== environmentId)) {
    return null;
  }
  const value = await withTimeout(
    remoteRequest<unknown>(
      machine.id,
      "decisionModels.decide",
      params,
      false,
      true,
      machine.environmentId,
    ),
    12_000,
    "Work layout",
  );
  signal.throwIfAborted();
  const result = DecisionResultSchema.safeParse(value);
  if (!result.success) return null;

  const layout = result.data.answers.layout;
  const sort = result.data.answers.sort;
  const parsedLayout = layout && "value" in layout ? layoutSchema.safeParse(layout.value) : null;
  if (!parsedLayout?.success || (parsedLayout.data === "source_bars" && !compareSources)) {
    return null;
  }
  const parsedSort = sort && "value" in sort ? sortSchema.safeParse(sort.value) : null;
  return { layout: parsedLayout.data, sort: parsedSort?.success ? parsedSort.data : "activity" };
}
