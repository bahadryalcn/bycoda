import * as codex from "../../src/integrations/harness/providers/codex/codex";
import { listHostSkillCandidatesAsync } from "../skills/skills";
import { withInstalledSkillScope } from "../../src/features/skills/model/skillProviderScope";
import * as claude from "../../src/integrations/harness/providers/claude/claude";
import * as cursor from "../../src/integrations/harness/providers/cursor/cursor";
import * as grok from "../../src/integrations/harness/providers/grok/grok";
import * as opencode from "../../src/integrations/harness/providers/opencode/opencode";
import * as pi from "../../src/integrations/harness/providers/pi/pi";
import * as omp from "../../src/integrations/harness/providers/omp/omp";
import * as fx from "../../src/integrations/harness/providers/fx/fx";
import * as hermes from "../../src/integrations/harness/providers/hermes/hermes";
import * as genericAcp from "../../src/integrations/harness/providers/generic-acp/genericAcpAdapter";
import * as antigravity from "../../src/integrations/harness/providers/antigravity/antigravity";
import { antigravityAdapter } from "../../src/integrations/harness/providers/antigravity/antigravityAdapter";
import type {
  SendTurnInput,
  SteerTurnInput,
  CompactContextInput,
  RewindLastTurnInput,
  RewindLastTurnResult,
  ApprovalDecision,
  HarnessOperationContext,
} from "../../src/integrations/harness/core/types";
import type { UserQuestionReply } from "../../src/features/sessions/model/userQuestion";
import type { RemoteProvider } from "../../src/features/connections/model/protocol";
import type { GeneratedSessionTitle } from "../../src/features/sessions/model/sessionTitle";
import { generateCodexSessionTitle } from "../../src/integrations/harness/providers/codex/codexTitle";
import { generateClaudeSessionTitle } from "../../src/integrations/harness/providers/claude/claudeTitle";
import { generateCodexBranchName } from "../../src/integrations/harness/providers/codex/codexGit";
import { generateClaudeBranchName } from "../../src/integrations/harness/providers/claude/claudeGit";
import { generateCursorSessionTitle } from "../../src/integrations/harness/providers/cursor/cursorTitle";
import { generateGrokSessionTitle } from "../../src/integrations/harness/providers/grok/grokTitle";
import { generateOpenCodeSessionTitle } from "../../src/integrations/harness/providers/opencode/opencodeTitle";
import {
  generatePiSessionTitle,
  generateOmpSessionTitle,
} from "../../src/integrations/harness/providers/pi/piTitle";
import { PI_FLAVOR, OMP_FLAVOR } from "../../src/integrations/harness/providers/pi/piFlavor";
import { respondQuestion as respondPiQuestion } from "../../src/integrations/harness/providers/pi/piFamily";
import { readSkillPolicy } from "../skills/skill-policy";
import { crewDeniedSkills, crewNativeInput } from "../crews/crew-native-tools";
import { withSkillPolicy } from "../../src/integrations/harness/core/skillPolicy";
import {
  getReportedCommands,
  reportedSkillRestrictions,
} from "../../src/integrations/harness/core/reportedCommands";

export type HostPolicyInput =
  | SendTurnInput
  | CompactContextInput
  | RewindLastTurnInput
  | SteerTurnInput;

export interface HostProvider {
  send(input: SendTurnInput): Promise<void>;
  /** Capture machine restrictions for one handoff's budget and final provider input. */
  prepareSendPolicy?(): (input: SendTurnInput) => SendTurnInput | Promise<SendTurnInput>;
  /** Async metadata preparation must precede the caller's final authority guard. */
  prepareOperationPolicy?<T extends HostPolicyInput>(input: T): Promise<T>;
  steer?(input: SteerTurnInput): Promise<void>;
  compact?(input: CompactContextInput): Promise<void>;
  rewind?(input: RewindLastTurnInput): Promise<RewindLastTurnResult>;
  cancel(id: string, context?: HarnessOperationContext): Promise<void>;
  stop(id: string, context?: HarnessOperationContext): Promise<void>;
  /** Retire only this settled original writer; no by-session fallback or history reset. */
  retireOriginal?(id: string, context: HarnessOperationContext): Promise<void>;
  /** Exact provider task only; omission must never mean cancel the whole turn. */
  stopItem?(id: string, callId: string, context?: HarnessOperationContext): Promise<void>;
  bind(id: string, providerId: string, cwd: string, providerAccountId?: string): void;
  approve(
    id: string,
    request: number,
    decision: ApprovalDecision,
    approvalOccurrenceId?: string,
  ): void;
  answer(id: string, request: number, reply: UserQuestionReply): void;
  generateTitle?(input: {
    sessionId: string;
    cwd: string;
    message: string;
    model?: string;
    modelSettings?: Record<string, string>;
    providerAccountId?: string;
    operationContext?: HarnessOperationContext;
  }): Promise<GeneratedSessionTitle | null>;
  generateBranchName?(
    cwd: string,
    message: string,
    context?: HarnessOperationContext,
  ): Promise<string | null>;
}

const providers: Record<RemoteProvider, HostProvider> = {
  acp: {
    send: genericAcp.sendGenericAcpTurn,
    cancel: genericAcp.cancelGenericAcpTurn,
    stop: genericAcp.forgetGenericAcpSession,
    bind: genericAcp.bindGenericAcpSession,
    approve: genericAcp.respondGenericAcpApproval,
    answer: () => genericAcp.respondGenericAcpQuestion(),
  },
  codex: {
    steer: codex.steerCodexTurn,
    send: codex.sendCodexTurn,
    compact: codex.compactCodexContext,
    rewind: codex.rewindCodexLastTurn,
    cancel: codex.cancelCodexTurn,
    stop: codex.forgetCodexSession,
    retireOriginal: codex.retireOriginalCodexWriter,
    bind: codex.bindCodexSession,
    approve: codex.respondCodexApproval,
    answer: codex.respondCodexQuestion,
    generateTitle: generateCodexSessionTitle,
    generateBranchName: generateCodexBranchName,
  },
  claude: {
    stopItem: claude.stopClaudeBackgroundWork,
    send: claude.sendClaudeTurn,
    compact: claude.compactClaudeContext,
    cancel: claude.cancelClaudeTurn,
    stop: claude.forgetClaudeSession,
    bind: claude.bindClaudeSession,
    approve: claude.respondClaudeApproval,
    answer: claude.respondClaudeQuestion,
    generateTitle: generateClaudeSessionTitle,
    generateBranchName: generateClaudeBranchName,
  },
  cursor: {
    steer: cursor.steerCursorTurn,
    send: cursor.sendCursorTurn,
    cancel: cursor.cancelCursorTurn,
    stop: cursor.forgetCursorSession,
    bind: cursor.bindCursorSession,
    approve: cursor.respondCursorApproval,
    answer: cursor.respondCursorQuestion,
    generateTitle: generateCursorSessionTitle,
  },
  grok: {
    send: grok.sendGrokTurn,
    compact: grok.compactGrokContext,
    cancel: grok.cancelGrokTurn,
    stop: grok.forgetGrokSession,
    bind: grok.bindGrokSession,
    approve: grok.respondGrokApproval,
    answer: grok.respondGrokQuestion,
    generateTitle: generateGrokSessionTitle,
  },
  opencode: {
    steer: opencode.steerOpenCodeTurn,
    send: opencode.sendOpenCodeTurn,
    compact: opencode.compactOpenCodeContext,
    rewind: opencode.rewindOpenCodeLastTurn,
    cancel: opencode.cancelOpenCodeTurn,
    stop: opencode.forgetOpenCodeSession,
    bind: opencode.bindOpenCodeSession,
    approve: opencode.respondOpenCodeApproval,
    answer: opencode.respondOpenCodeQuestion,
    generateTitle: generateOpenCodeSessionTitle,
  },
  pi: {
    steer: pi.steerPiTurn,
    send: pi.sendPiTurn,
    compact: pi.compactPiContext,
    rewind: pi.rewindPiLastTurn,
    cancel: pi.cancelPiTurn,
    stop: pi.forgetPiSession,
    bind: pi.bindPiSession,
    approve: pi.respondPiApproval,
    answer: (id, request, reply) => respondPiQuestion(PI_FLAVOR, id, request, reply),
    generateTitle: generatePiSessionTitle,
  },
  omp: {
    steer: omp.steerOmpTurn,
    send: omp.sendOmpTurn,
    compact: omp.compactOmpContext,
    rewind: omp.rewindOmpLastTurn,
    cancel: omp.cancelOmpTurn,
    stop: omp.forgetOmpSession,
    bind: omp.bindOmpSession,
    approve: omp.respondOmpApproval,
    answer: (id, request, reply) => respondPiQuestion(OMP_FLAVOR, id, request, reply),
    generateTitle: generateOmpSessionTitle,
  },
  fx: {
    send: fx.sendFxTurn,
    cancel: fx.cancelFxTurn,
    stop: fx.forgetFxSession,
    bind: fx.bindFxSession,
    approve: fx.respondFxApproval,
    answer: unsupportedQuestion,
  },
  hermes: {
    steer: hermes.steerHermesTurn,
    send: hermes.sendHermesTurn,
    cancel: hermes.cancelHermesTurn,
    stop: hermes.forgetHermesSession,
    bind: hermes.bindHermesSession,
    approve: hermes.respondHermesApproval,
    answer: unsupportedQuestion,
  },
  // The adapter picks ACP or agy's headless stream-json from the resolved binary.
  antigravity: {
    send: antigravityAdapter.sendTurn,
    cancel: antigravityAdapter.cancelTurn,
    stop: antigravityAdapter.forgetSession!,
    bind: antigravityAdapter.bindSession!,
    approve: antigravity.respondAntigravityApproval,
    answer: unsupportedQuestion,
  },
};

/** Machine-owned preparation is shared by handoff accounting and final enforcement.
 * Only exact objects prepared here may skip a second append at the send boundary. */
export function withMachineSkillPolicy(
  id: RemoteProvider,
  provider: HostProvider,
  readPolicy = readSkillPolicy,
  installedSkills: (
    cwd: string,
  ) =>
    | readonly import("../../src/features/skills/model/skillProviderScope").ProviderScopedSkill[]
    | Promise<
        readonly import("../../src/features/skills/model/skillProviderScope").ProviderScopedSkill[]
      > = async (cwd) => {
    const result = await listHostSkillCandidatesAsync(cwd);
    if (result.truncated)
      throw new Error("Skill discovery is incomplete; provider admission refused.");
    return result.skills;
  },
): HostProvider {
  type Candidates =
    readonly import("../../src/features/skills/model/skillProviderScope").ProviderScopedSkill[];
  const preparedInputs = new WeakMap<
    HostPolicyInput,
    { original: HostPolicyInput; candidates: Candidates }
  >();
  const apply = <T extends HostPolicyInput>(
    input: T,
    candidates: Candidates,
    mode: string = id,
  ): T => {
    const machine = readPolicy();
    const native = reportedSkillRestrictions(getReportedCommands(input.sessionId));
    const policy = withInstalledSkillScope(
      {
        disabledNames: [
          ...new Set([
            ...machine.disabledNames,
            ...native.disabledNames,
            ...crewDeniedSkills(input.modelSettings, candidates),
          ]),
        ],
        disabledPaths: [...new Set([...machine.disabledPaths, ...native.disabledPaths])],
      },
      id,
      candidates,
    );
    return "text" in input && typeof input.text === "string"
      ? (withSkillPolicy(mode, { ...input, text: input.text }, policy) as T)
      : { ...input, skillPolicy: policy };
  };
  const prepare = async <T extends HostPolicyInput>(input: T): Promise<T> => {
    const candidates = (await installedSkills(input.cwd)).map((skill) => ({ ...skill }));
    const original = { ...input };
    const prepared = apply(original, candidates);
    preparedInputs.set(prepared, { original, candidates });
    return prepared;
  };
  const finish = <T extends HostPolicyInput>(input: T, mode: string = id): T => {
    const receipt = preparedInputs.get(input);
    if (!receipt) throw new Error("Skill policy preparation identity is missing.");
    preparedInputs.delete(input);
    // Preserve exact prepared-object identity while refreshing restrictions from
    // original prose; an appended preparation instruction is never appended twice.
    Object.assign(input, apply(receipt.original, receipt.candidates, mode));
    return input;
  };
  const dispatch = <T extends HostPolicyInput, R>(
    input: T,
    action: (prepared: T) => R,
    mode: string = id,
  ): R | Promise<R> => {
    if (preparedInputs.has(input)) return action(finish(input, mode));
    const unprepared = async (): Promise<R> => action(finish(await prepare(input), mode));
    return unprepared();
  };
  return {
    ...provider,
    prepareOperationPolicy: prepare,
    prepareSendPolicy: () => prepare,
    send: (input) => Promise.resolve(dispatch(input, (prepared) => provider.send(prepared))),
    ...(provider.compact
      ? {
          compact: (input: CompactContextInput) =>
            Promise.resolve(dispatch(input, (prepared) => provider.compact!(prepared))),
        }
      : {}),
    ...(provider.rewind
      ? {
          rewind: (input: RewindLastTurnInput) =>
            Promise.resolve(dispatch(input, (prepared) => provider.rewind!(prepared))),
        }
      : {}),
    ...(provider.steer
      ? {
          steer: (input: SteerTurnInput) =>
            Promise.resolve(dispatch(input, (prepared) => provider.steer!(prepared), "steer")),
        }
      : {}),
  };
}

/** A crew member's tool profile narrows provider-native tools; unsupported providers refuse. */
export function withCrewNativeTools(id: string, provider: HostProvider): HostProvider {
  return {
    ...provider,
    send: async (input) => provider.send(crewNativeInput(id, input)),
    ...(provider.compact
      ? {
          compact: async (input: CompactContextInput) =>
            provider.compact!(crewNativeInput(id, input)),
        }
      : {}),
    ...(provider.rewind
      ? {
          rewind: async (input: RewindLastTurnInput) =>
            provider.rewind!(crewNativeInput(id, input)),
        }
      : {}),
    ...(provider.steer
      ? { steer: async (input: SteerTurnInput) => provider.steer!(crewNativeInput(id, input)) }
      : {}),
  };
}

/** Every host entry point, including unattended tasks and follow-ups, uses machine settings. */
export const hostProviders = Object.fromEntries(
  Object.entries(providers).map(([id, provider]) => [
    id,
    withMachineSkillPolicy(id as RemoteProvider, withCrewNativeTools(id, provider)),
  ]),
) as Record<RemoteProvider, HostProvider>;

function unsupportedQuestion(): never {
  throw new Error("This provider does not support questions");
}
