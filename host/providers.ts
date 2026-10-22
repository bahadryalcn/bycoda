import * as codex from "../src/integrations/harness/providers/codex/codex";
import * as claude from "../src/integrations/harness/providers/claude/claude";
import * as cursor from "../src/integrations/harness/providers/cursor/cursor";
import * as grok from "../src/integrations/harness/providers/grok/grok";
import * as opencode from "../src/integrations/harness/providers/opencode/opencode";
import * as pi from "../src/integrations/harness/providers/pi/pi";
import * as omp from "../src/integrations/harness/providers/omp/omp";
import * as fx from "../src/integrations/harness/providers/fx/fx";
import * as hermes from "../src/integrations/harness/providers/hermes/hermes";
import * as genericAcp from "../src/integrations/harness/providers/generic-acp/genericAcpAdapter";
import * as antigravity from "../src/integrations/harness/providers/antigravity/antigravity";
import { antigravityAdapter } from "../src/integrations/harness/providers/antigravity/antigravityAdapter";
import type {
  SendTurnInput,
  SteerTurnInput,
  CompactContextInput,
  RewindLastTurnInput,
  RewindLastTurnResult,
  ApprovalDecision,
} from "../src/integrations/harness/core/types";
import type { UserQuestionReply } from "../src/features/sessions/model/userQuestion";
import type { RemoteProvider } from "../src/features/connections/model/protocol";
import type { GeneratedSessionTitle } from "../src/features/sessions/model/sessionTitle";
import { generateCodexSessionTitle } from "../src/integrations/harness/providers/codex/codexTitle";
import { generateClaudeSessionTitle } from "../src/integrations/harness/providers/claude/claudeTitle";
import { generateCodexBranchName } from "../src/integrations/harness/providers/codex/codexGit";
import { generateClaudeBranchName } from "../src/integrations/harness/providers/claude/claudeGit";
import { generateCursorSessionTitle } from "../src/integrations/harness/providers/cursor/cursorTitle";
import { generateGrokSessionTitle } from "../src/integrations/harness/providers/grok/grokTitle";
import { generateOpenCodeSessionTitle } from "../src/integrations/harness/providers/opencode/opencodeTitle";
import {
  generatePiSessionTitle,
  generateOmpSessionTitle,
} from "../src/integrations/harness/providers/pi/piTitle";
import { PI_FLAVOR, OMP_FLAVOR } from "../src/integrations/harness/providers/pi/piFlavor";
import { respondQuestion as respondPiQuestion } from "../src/integrations/harness/providers/pi/piFamily";
import { readSkillPolicy } from "./skill-policy";
import { withSkillPolicy } from "../src/integrations/harness/core/skillPolicy";

export interface HostProvider {
  send(input: SendTurnInput): Promise<void>;
  steer?(input: SteerTurnInput): Promise<void>;
  compact?(input: CompactContextInput): Promise<void>;
  rewind?(input: RewindLastTurnInput): Promise<RewindLastTurnResult>;
  cancel(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  /** Exact provider task only; omission must never mean cancel the whole turn. */
  stopItem?(id: string, callId: string): Promise<void>;
  bind(id: string, providerId: string, cwd: string, providerAccountId?: string): void;
  approve(id: string, request: number, decision: ApprovalDecision): void;
  answer(id: string, request: number, reply: UserQuestionReply): void;
  generateTitle?(input: {
    sessionId: string;
    cwd: string;
    message: string;
  }): Promise<GeneratedSessionTitle | null>;
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
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
    bind: codex.bindCodexSession,
    approve: codex.respondCodexApproval,
    answer: codex.respondCodexQuestion,
    generateTitle: generateCodexSessionTitle,
    generateBranchName: generateCodexBranchName,
  },
  claude: {
    stopItem: claude.stopClaudeBackgroundWork,
    steer: claude.steerClaudeTurn,
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

/** Every host entry point, including unattended tasks and follow-ups, uses machine settings. */
export const hostProviders = Object.fromEntries(
  Object.entries(providers).map(([id, provider]) => [
    id,
    {
      ...provider,
      send: (input: SendTurnInput) => provider.send(withSkillPolicy(id, input, readSkillPolicy())),
      ...(provider.compact
        ? {
            compact: (input: CompactContextInput) =>
              provider.compact!({ ...input, skillPolicy: readSkillPolicy() }),
          }
        : {}),
      ...(provider.rewind
        ? {
            rewind: (input: RewindLastTurnInput) => {
              const policy = readSkillPolicy();
              return provider.rewind!(
                input.text === undefined
                  ? { ...input, skillPolicy: policy }
                  : withSkillPolicy(id, { ...input, text: input.text }, policy),
              );
            },
          }
        : {}),
      ...(provider.steer
        ? {
            steer: (input: SteerTurnInput) =>
              provider.steer!(withSkillPolicy("steer", input, readSkillPolicy())),
          }
        : {}),
    },
  ]),
) as Record<RemoteProvider, HostProvider>;

function unsupportedQuestion(): never {
  throw new Error("This provider does not support questions");
}
