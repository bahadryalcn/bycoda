import { useMemo, useSyncExternalStore } from "react";
import { hasNativeCommands, rankSkills, type SlashToken } from "../../skills/model/skills";
import {
  loadPromptTemplates,
  subscribePromptTemplates,
  templateSkill,
  type PromptTemplate,
} from "../model/promptTemplates";
import { BTW_COMMAND, supportsBtwHarness } from "../model/btw";
import { COMPACT_COMMAND } from "../model/compact";
import { DRAFT_COMMAND } from "../model/draftCommand";
import { SUBAGENTS_COMMAND, TASK_COMMAND } from "../model/delegationCommands";
import { MCP_COMMAND } from "../model/mcpCommand";
import { CLEAR_SESSION_COMMAND, NEW_SESSION_COMMAND } from "../model/newSessionCommand";
import { OPERATOR_COMMAND } from "../model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { PLAN_COMMAND } from "../model/plan";
import { RESUME_COMMAND } from "../model/resumeCommand";
import { SESSION_FOLDER_COMMAND } from "../model/sessionFolderCommand";
import type { HarnessId } from "../model/session";
import { useCliCommands } from "./useCliCommands";
import { useComposerSkills } from "./useComposerSkills";

const noPromptTemplates: PromptTemplate[] = [];
const emptyPromptTemplates = () => noPromptTemplates;

/**
 * Read-only slash / `$` inventory for the composer menus: file and native
 * skills, the CLI's own commands, prompt templates and the Bycoda commands that
 * apply to this session. Every list is scoped by harness and execution
 * directory inside the skill and command hooks, which reject results from a
 * previous scope. Nothing here reads or changes the draft; the Composer passes
 * the open token's trigger and query and keeps command execution itself.
 */
export function useComposerSlashInventory(input: {
  harness: HarnessId;
  executionCwd: string;
  sessionId?: string;
  /** A slash, session-folder or MCP menu is open. */
  pickerOpen: boolean;
  remote: boolean;
  remotePlan: boolean;
  hideOrchestrator: boolean;
  canStartNewSession: boolean;
  canSaveDraft: boolean;
  canResumeProviderSession: boolean;
  slashTrigger: SlashToken["trigger"] | undefined;
  slashQuery: string;
}) {
  const {
    harness,
    executionCwd,
    sessionId,
    pickerOpen,
    remote,
    remotePlan,
    hideOrchestrator,
    canStartNewSession,
    canSaveDraft,
    canResumeProviderSession,
    slashTrigger,
    slashQuery,
  } = input;
  const skillCatalog = useComposerSkills({ harness, executionCwd, sessionId, pickerOpen });
  const skills = skillCatalog.skills;
  const promptTemplates = useSyncExternalStore(
    subscribePromptTemplates,
    loadPromptTemplates,
    emptyPromptTemplates,
  );
  const templateItems = useMemo(() => promptTemplates.map(templateSkill), [promptTemplates]);
  // The CLI's own commands never replace a Bycoda command or a skill that
  // Bycoda already lists under the same name.
  const takenNames = useMemo(
    () =>
      new Set([
        ...[
          PLAN_COMMAND,
          COMPACT_COMMAND,
          NEW_SESSION_COMMAND,
          CLEAR_SESSION_COMMAND,
          SESSION_FOLDER_COMMAND,
          MCP_COMMAND,
          OPERATOR_COMMAND,
          ORCHESTRATOR_COMMAND,
          DRAFT_COMMAND,
          BTW_COMMAND,
          RESUME_COMMAND,
          SUBAGENTS_COMMAND,
          TASK_COMMAND,
        ].map((command) => command.name),
        "mono",
        "bycoda",
        ...skills.map((skill) => skill.name),
      ]),
    [skills],
  );
  const cliCommands = useCliCommands({
    harness,
    localCwd: executionCwd,
    sessionId,
    menuOpen: pickerOpen,
    taken: takenNames,
    files: skills,
  });
  const slashItems = useMemo(
    () => [
      ...(canStartNewSession ? [NEW_SESSION_COMMAND, CLEAR_SESSION_COMMAND] : []),
      ...(remote
        ? [
            ...(remotePlan ? [PLAN_COMMAND] : []),
            COMPACT_COMMAND,
            ...skills.filter(
              (skill) =>
                skill.name !== NEW_SESSION_COMMAND.name &&
                skill.name !== CLEAR_SESSION_COMMAND.name &&
                (skill.kind === "file" || skill.kind === "native"),
            ),
            ...cliCommands.slashCommands,
          ]
        : [
            SESSION_FOLDER_COMMAND,
            MCP_COMMAND,
            ...(hideOrchestrator ? [] : [ORCHESTRATOR_COMMAND]),
            PLAN_COMMAND,
            SUBAGENTS_COMMAND,
            TASK_COMMAND,
            ...(canSaveDraft ? [DRAFT_COMMAND] : []),
            COMPACT_COMMAND,
            ...(supportsBtwHarness(harness) ? [BTW_COMMAND] : []),
            // Reading and replaying stored conversations is written against
            // Claude Code's own on-disk format, so the command only exists
            // where it works.
            ...((harness === "claude" || harness === "codex") && canResumeProviderSession
              ? [RESUME_COMMAND]
              : []),
            ...skills.filter(
              (skill) =>
                ![
                  NEW_SESSION_COMMAND.name,
                  CLEAR_SESSION_COMMAND.name,
                  OPERATOR_COMMAND.name,
                  "mono",
                  "bycoda",
                ].includes(skill.name) &&
                (skill.kind === "native" ||
                  (skill.name !== PLAN_COMMAND.name &&
                    skill.name !== COMPACT_COMMAND.name &&
                    skill.name !== SESSION_FOLDER_COMMAND.name &&
                    skill.name !== MCP_COMMAND.name &&
                    skill.name !== ORCHESTRATOR_COMMAND.name &&
                    skill.name !== DRAFT_COMMAND.name &&
                    skill.name !== RESUME_COMMAND.name &&
                    skill.name !== BTW_COMMAND.name &&
                    skill.name !== SUBAGENTS_COMMAND.name &&
                    skill.name !== TASK_COMMAND.name)),
            ),
            ...cliCommands.slashCommands,
          ]),
      ...templateItems,
    ],
    [
      harness,
      templateItems,
      skills,
      cliCommands.slashCommands,
      remote,
      remotePlan,
      hideOrchestrator,
      canSaveDraft,
      canResumeProviderSession,
      canStartNewSession,
    ],
  );
  const skillLimit = hasNativeCommands(harness) ? Number.POSITIVE_INFINITY : undefined;
  const dollarSkills = cliCommands.dollarSkills;
  const rankedSkills = useMemo(
    () =>
      rankSkills(
        slashTrigger === "$" ? dollarSkills : slashItems,
        slashQuery,
        slashTrigger === "$" ? undefined : skillLimit,
      ),
    [dollarSkills, slashTrigger, slashQuery, slashItems, skillLimit],
  );
  const skillNames = useMemo(
    () =>
      new Set(
        [OPERATOR_COMMAND, ...slashItems, ...dollarSkills]
          .filter((skill) => skill.kind !== "template")
          .map((skill) => skill.invocation),
      ),
    [slashItems, dollarSkills],
  );
  return {
    skillCatalog,
    promptTemplates,
    dollarSkills,
    rankedSkills,
    skillNames,
  };
}
