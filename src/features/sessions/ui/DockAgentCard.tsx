import { useT } from "../../../shared/i18n";
import type { DockAgent } from "../model/activityDock";
import { modelNameBesideIcon } from "../model/modelDisplayName";
import type { HarnessId } from "../model/session";
import { useSession } from "../model/sessionsStore";
import type { SubagentStepStrip } from "../model/subagentStepStrip";
import { SubagentRowContent } from "./SubagentRowContent";
import { SubagentRunStatus } from "./SubagentRunStatus";
import { useSubagentRunIdentity } from "./useSubagentRunIdentity";

const NO_STEPS: SubagentStepStrip = { cells: [], total: 0, failed: 0 };

/** A subagent's dock row, in the same card as its transcript row. */
export function DockAgentCard({ agent, provider }: { agent: DockAgent; provider?: HarnessId }) {
  const t = useT();
  const child = useSession(agent.sessionId);
  const { account, effort } = useSubagentRunIdentity(
    child ?? { harness: provider, providerAccountId: agent.providerAccountId },
    child?.model,
  );
  return (
    <SubagentRowContent
      layout="dock"
      harness={provider}
      account={account}
      name={agent.name}
      active={agent.status === "running"}
      failed={agent.status === "failed"}
      handle={agent.crewMember?.handle}
      details={[
        agent.round && agent.round > 1 ? t("Round {p0}", { p0: agent.round }) : undefined,
        agent.model ? modelNameBesideIcon(agent.model) : t("Subagent"),
        // An account this device does not list (a remote Host's) still names the exact one used.
        account?.accountLabel ?? agent.providerAccountId,
        effort,
        agent.nested ? t("Subagents: {p0}", { p0: agent.nested }) : undefined,
      ]}
      status={
        <SubagentRunStatus
          status={agent.status}
          needsInput={!!agent.needsInput}
          startedAt={agent.startedAt}
          endedAt={agent.endedAt}
          strip={agent.stepStrip ?? NO_STEPS}
        />
      }
    />
  );
}
