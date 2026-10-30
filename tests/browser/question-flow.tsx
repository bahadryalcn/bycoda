import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { QuestionForm } from "../../src/features/sessions/ui/QuestionForm";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { Button } from "../../src/shared/ui/Button";
import {
  CUSTOM_OPTION_ID,
  selectedAnswerLabels,
  type UserQuestionPrompt,
  type UserQuestionReply,
} from "../../src/features/sessions/model/userQuestion";
import { newSession, type Block, type Session } from "../../src/features/sessions/model/session";
import { ApprovalToasts } from "../../src/features/sessions/ui/ApprovalToasts";
import type { ApprovalDispatch } from "../../src/features/sessions/ui/ApprovalDecisionContext";
import {
  PooledTranscript,
  TranscriptPool,
  TranscriptPoolOutlet,
} from "../../src/features/sessions/ui/TranscriptPool";
import { pendingApprovalNotices } from "../../src/features/notifications/model/approvalToast";
import { rememberNotificationProjects } from "../../src/features/notifications/model/notificationProjects";
import { useApprovalActions } from "../../src/app/workspace/sessions/useApprovalActions";
import { registerRemoteSessionActions } from "../../src/features/connections/model/remoteSessionActions";
import { applyHarnessEvent } from "../../src/integrations/harness/core/apply";
import type { ApprovalDecision } from "../../src/integrations/harness";
import { captureApprovalRequest } from "../../src/features/sessions/model/approvalIntents";
import { applyThemePreference } from "../../src/features/settings/model/appearance";
import {
  associateQuestionDraft,
  discardQuestionDraft,
  writeQuestionDraft,
} from "../../src/features/sessions/model/questionDrafts";
import {
  beginParentInputClosure,
  captureParentInputs,
} from "../../src/features/sessions/data/parentInputClosure";
import { languageReady, setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";

// Entirely local fixture. No provider processes, host mutations or network sends.
const query = new URLSearchParams(location.search);
applyThemePreference(query.get("theme") === "light" ? "light" : "dark");
document.body.style.margin = "0";
await setLanguagePreference(query.get("lang") === "tr" ? "tr" : "en");
await languageReady;

if (query.has("approval")) {
  // The actual central hook uses a synthetic remote owner; no real Host/Native transport exists.
  mockWindows("main");
  mockIPC(() => []);
  rememberNotificationProjects([
    {
      id: "repository:decision-fixture",
      name: "Decision fixture",
      detail: "synthetic",
      kind: "repository",
      paths: ["G:/fixture-decisions"],
    },
  ]);
}

const initial: UserQuestionPrompt = {
  requestId: 17,
  providerTurnId: "turn-fixture",
  callId: "question-fixture",
  behavior: "blocking",
  dismissAction: query.get("dismiss") === "decline" ? "decline" : "cancel",
  questions: [
    {
      id: "scope",
      header: "Release scope",
      prompt:
        "Which platforms should this release support? Include any constraints that the implementation must preserve.",
      options:
        query.get("variant") === "choices"
          ? [
              {
                id: "desktop",
                label: "Windows and macOS",
                description: "Focus on the desktop experience.",
              },
              {
                id: "all",
                label: "Desktop and mobile",
                description: "Include the phone experience in this scope.",
              },
            ]
          : [],
      allowCustom: true,
      multiSelect: false,
    },
  ],
};

const CAPACITY_ROOT = "fixture-decision-capacity-session";
const CAPACITY_SCOPE = "fixture-decision-capacity-cache";
const FIRST_EXACT = "  Original retained answer\r\n漢🦀\n";
const capacityPrompts: UserQuestionPrompt[] = Array.from({ length: 65 }, (_, index) => ({
  requestId: 1000 + index,
  callId: `fixture-capacity-call-${index}`,
  providerTurnId: "fixture-capacity-turn",
  title:
    index === 64
      ? "A new question while retained answers are full"
      : `Retained question ${index + 1}`,
  behavior: "blocking",
  dismissAction: "cancel",
  questions: [
    {
      id: "answer",
      prompt: "Keep this answer until it is explicitly released.",
      options: [],
      allowCustom: true,
      multiSelect: false,
    },
  ],
}));

// Actual production cache/association APIs; these are synthetic local question occurrences.
if (query.has("capacity")) {
  for (let index = 0; index < 64; index++) {
    const prompt = capacityPrompts[index];
    const unmount = associateQuestionDraft(CAPACITY_SCOPE, prompt, CAPACITY_ROOT);
    writeQuestionDraft(CAPACITY_SCOPE, prompt, {
      step: 0,
      answers: { answer: [CUSTOM_OPTION_ID] },
      custom: {
        answer: index === 0 ? FIRST_EXACT : `Retained original ${index + 1}\r\n`,
      },
    });
    unmount?.();
  }
}

function CapacityFixture() {
  const [index, setIndex] = useState(64);
  const [shown, setShown] = useState(true);
  const [calls, setCalls] = useState(0);
  const [capture, setCapture] = useState("");
  const [gateState, setGateState] = useState("open");
  const gate = useRef<ReturnType<typeof beginParentInputClosure> | null>(null);
  const read = async () => {
    const lease = await captureParentInputs(CAPACITY_ROOT);
    try {
      setCapture(JSON.stringify(lease.snapshots));
    } finally {
      lease.release();
    }
  };
  return (
    <main
      data-decision-capacity
      style={{
        minHeight: "100dvh",
        background: "var(--ui-surface)",
        color: "var(--ui-tone-neutral-fg)",
        fontFamily: "var(--font-sans)",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "56rem",
          margin: "0 auto",
          display: "grid",
          gap: "16px",
        }}
      >
        <header>
          <h1>Question capacity</h1>
          <p>Local component fixture · synthetic questions · no provider or Native checkpoint</p>
        </header>
        <nav
          aria-label="Capacity fixture controls"
          style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
        >
          <Button onClick={() => setIndex(0)}>Open first retained answer</Button>
          <Button onClick={() => setIndex(64)}>Open new question</Button>
          <Button onClick={() => setShown((value) => !value)}>
            {shown ? "Unmount question" : "Remount question"}
          </Button>
          <Button onClick={() => discardQuestionDraft(CAPACITY_SCOPE, capacityPrompts[1])}>
            Release one retained draft
          </Button>
          <Button onClick={() => void read().catch((error: unknown) => setCapture(String(error)))}>
            Capture actual drafts
          </Button>
          <Button
            onClick={() => {
              if (gate.current) return;
              const actual = beginParentInputClosure(CAPACITY_ROOT, {
                owner: {},
                timeoutMs: 30_000,
              });
              gate.current = actual;
              setGateState("closing");
              void actual.capture().then(
                (lease) => {
                  setCapture(JSON.stringify(lease.snapshots));
                  setGateState(actual.current() ? "closed" : "invalid");
                },
                (error: unknown) => setGateState(`held: ${String(error)}`),
              );
            }}
          >
            Close actual Parent admission
          </Button>
          <Button
            onClick={() => {
              gate.current?.release();
              gate.current = null;
              setGateState("open");
            }}
          >
            Reopen actual Parent admission
          </Button>
        </nav>
        <output aria-label="Decision send count">{calls}</output>
        <output aria-label="Parent gate state">{gateState}</output>
        <section aria-label="Actual question surface" data-decision-surface>
          {shown ? (
            <QuestionForm
              prompt={capacityPrompts[index]}
              draftScope={CAPACITY_SCOPE}
              parentSessionId={CAPACITY_ROOT}
              onReply={() => setCalls((count) => count + 1)}
            />
          ) : null}
        </section>
        <output aria-label="Captured question data" hidden>
          {capture}
        </output>
      </div>
    </main>
  );
}

const APPROVAL_ROOT = "fixture-decision-approval-session";
function approvalSession(): Session {
  let session = newSession("codex", "G:/fixture-decisions");
  session = {
    ...session,
    id: APPROVAL_ROOT,
    title: "Review a synthetic fixture effect",
    hostBinding: {
      kind: "local-host",
      machineId: "fixture-machine",
      environmentId: "fixture-environment",
      projectId: "fixture-project",
      sessionId: APPROVAL_ROOT,
      authorityGeneration: 1,
      created: true,
    },
  };
  for (const requestId of [71, 72]) {
    session = applyHarnessEvent(session, {
      type: "approval.requested",
      requestId,
      callId: `fixture-approval-${requestId}`,
      title: `Synthetic fixture effect ${requestId}`,
    });
  }
  if (query.has("approvalLegacy")) {
    // An old saved wire snapshot remains readable; response must not mint identity.
    session = {
      ...session,
      blocks: session.blocks.map((block) => {
        if (!block.approval) return block;
        const { occurrenceId: _source, ...approval } = block.approval;
        return { ...block, approval };
      }),
    };
  }
  return session;
}

function ApprovalFixture() {
  const [session, setSession] = useState(approvalSession);
  const pool = useMemo(() => new TranscriptPool(), []);
  const sessionsRef = useRef([session]);
  sessionsRef.current = [session];
  const [calls, setCalls] = useState<{ requestId: number; decision: string }[]>([]);
  const [settled, setSettled] = useState(0);
  const [gateState, setGateState] = useState("open");
  const [captured, setCaptured] = useState("");
  const [feedback, setFeedback] = useState("");
  const [ownerReady, setOwnerReady] = useState(false);
  const gate = useRef<ReturnType<typeof beginParentInputClosure> | null>(null);
  const pending = useRef(new Map<number, { resolve(): void; reject(error: Error): void }>());
  const registeredOwner = useRef<(() => void) | null>(null);
  const replaceBeforeDispatch = useRef(false);
  const source = useMemo(() => {
    const unsupported = () => {
      throw new Error("This synthetic decision owner supports only approval callbacks");
    };
    return {
      approvalOccurrenceSupported: !query.has("approvalOldHost"),
      buildPlan: unsupported,
      submit: unsupported,
      saveDraft: unsupported,
      stop: unsupported,
      rewind: async () => unsupported(),
      compact: unsupported,
      answer: unsupported,
      approve: async (requestId: number, decision: ApprovalDecision) => {
        setCalls((current) => [...current, { requestId, decision }]);
        try {
          await new Promise<void>((resolve, reject) =>
            pending.current.set(requestId, { resolve, reject }),
          );
        } finally {
          pending.current.delete(requestId);
          setSettled((count) => count + 1);
        }
      },
    } satisfies Parameters<typeof registerRemoteSessionActions>[1];
  }, []);
  useLayoutEffect(() => {
    const detach = registerRemoteSessionActions(APPROVAL_ROOT, source);
    registeredOwner.current = detach;
    setOwnerReady(true);
    return () => {
      registeredOwner.current?.();
      registeredOwner.current = null;
    };
  }, [source]);
  const actions = useApprovalActions({
    sessionsRef,
    setInspectedWorkerId: () => {},
    focusOpenSession: () => true,
    onSelectHistorySession: async () => {},
  });
  const otherRequest = ownerReady ? captureApprovalRequest(session, 71) : null;
  const dispatch: ApprovalDispatch = (...args) => {
    // Controlled synthetic transport replacement after render, before actual central entry.
    if (replaceBeforeDispatch.current) {
      replaceBeforeDispatch.current = false;
      registeredOwner.current?.();
      registeredOwner.current = registerRemoteSessionActions(APPROVAL_ROOT, source);
    }
    return actions.onApproval(...args);
  };
  return (
    <main
      data-decision-approval
      style={{
        minHeight: "100dvh",
        background: "var(--ui-surface)",
        color: "var(--ui-tone-neutral-fg)",
        fontFamily: "var(--font-sans)",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "56rem",
          margin: "0 auto",
          display: "grid",
          gap: "16px",
        }}
      >
        <header>
          <h1>Approval decision conservation</h1>
          <p>
            Actual components and central hook · synthetic remote callback · provider ACK unproved
          </p>
          {ownerReady ? (
            <ApprovalToasts
              notices={pendingApprovalNotices([session])}
              popupNotices={[]}
              onFocusSession={(id) => setFeedback(`Opened ${id}`)}
              onApproval={dispatch}
            />
          ) : null}
        </header>
        <nav
          aria-label="Approval fixture controls"
          style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
        >
          <Button
            onClick={() => {
              if (gate.current) return;
              const actual = beginParentInputClosure(APPROVAL_ROOT, {
                owner: {},
                timeoutMs: 30_000,
              });
              gate.current = actual;
              setGateState("closing");
              void actual.capture().then(
                (lease) => {
                  setCaptured(JSON.stringify(lease.snapshots));
                  setGateState(actual.current() ? "closed" : "invalid");
                },
                (error: unknown) => setGateState(`held: ${String(error)}`),
              );
            }}
          >
            Close actual approval Parent admission
          </Button>
          <Button
            onClick={() => {
              gate.current?.release();
              gate.current = null;
              setGateState("open");
            }}
          >
            Reopen actual approval Parent admission
          </Button>
          <Button
            onClick={() => {
              void Promise.resolve(
                actions.onApproval(APPROVAL_ROOT, 71, "allow", otherRequest ?? undefined),
              ).then((value) => setFeedback(`Fresh callback returned ${String(value)}`));
            }}
          >
            Attempt another approval through central hook
          </Button>
          <Button
            onClick={() =>
              pending.current.get(72)?.reject(new Error("synthetic callback outcome is uncertain"))
            }
          >
            Reject original callback
          </Button>
          <Button onClick={() => pending.current.get(73)?.resolve()}>Complete new callback</Button>
          <Button
            onClick={() =>
              setSession((current) =>
                applyHarnessEvent(current, {
                  type: "approval.resolved",
                  requestId: 72,
                  decision: "allow",
                }),
              )
            }
          >
            Simulate original provider resolution
          </Button>
          <Button
            onClick={() =>
              setSession((current) =>
                applyHarnessEvent(current, {
                  type: "approval.requested",
                  requestId: 73,
                  callId: "fixture-approval-73",
                  title: "Synthetic fixture effect 73",
                }),
              )
            }
          >
            Simulate a new provider request
          </Button>
          <Button
            onClick={() => {
              replaceBeforeDispatch.current = true;
            }}
          >
            Arm source replacement before next dispatch
          </Button>
          <Button onClick={() => setSession((current) => ({ ...current }))}>
            Refresh current request source
          </Button>
          <Button
            onClick={() => {
              void captureParentInputs(APPROVAL_ROOT).then((lease) => {
                try {
                  setCaptured(JSON.stringify(lease.snapshots));
                } finally {
                  lease.release();
                }
              });
            }}
          >
            Capture actual approval data
          </Button>
        </nav>
        <output aria-label="Approval callback count">{calls.length}</output>
        <output aria-label="Approval callback settlements">{settled}</output>
        <output aria-label="Approval gate state">{gateState}</output>
        <output aria-label="Approval original source ready">
          {otherRequest ? "ready" : "unavailable"}
        </output>
        <output aria-label="Approval fixture feedback">{feedback}</output>
        <section
          data-decision-surface
          aria-label="Actual approval transcript"
          style={{ height: "400px", display: "flex", minWidth: 0 }}
        >
          {ownerReady ? (
            <PooledTranscript pool={pool} sessionId={session.id}>
              <AgentTranscript
                sessionId={session.id}
                blocks={session.blocks}
                visible
                approvalContext={{ session, dispatch }}
                onApproval={(...args) => actions.onApproval(APPROVAL_ROOT, ...args)}
              />
            </PooledTranscript>
          ) : null}
        </section>
        <TranscriptPoolOutlet pool={pool} />
        <output hidden aria-label="Captured approval data">
          {captured}
        </output>
        <output hidden aria-label="Approval callback identities">
          {JSON.stringify(calls)}
        </output>
      </div>
    </main>
  );
}

function Fixture() {
  const [prompt, setPrompt] = useState<UserQuestionPrompt | undefined>(initial);
  const [shown, setShown] = useState(true);
  const [scope, setScope] = useState("fixture-session-a");
  const [reply, setReply] = useState<UserQuestionReply>();
  const [calls, setCalls] = useState(0);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const update = (delivery: UserQuestionPrompt["delivery"]) =>
    setPrompt((current) => current && { ...current, delivery });

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "var(--ui-surface)",
        color: "var(--ui-tone-neutral-fg)",
        fontFamily: "var(--font-sans)",
        padding: "16px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          maxWidth: "56rem",
          margin: "0 auto",
          display: "grid",
          gap: "16px",
        }}
      >
        <header
          aria-label="Fixture controls"
          style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
        >
          <Button onClick={() => setShown((value) => !value)}>
            {shown ? "Hide question" : "Show question"}
          </Button>
          <Button
            onClick={() =>
              setScope((value) => (value.endsWith("a") ? "fixture-session-b" : "fixture-session-a"))
            }
          >
            Switch session
          </Button>
          <Button
            onClick={() =>
              setPrompt(
                (current) =>
                  current && {
                    ...current,
                    behavior: current.behavior === "blocking" ? "nonBlocking" : "blocking",
                  },
              )
            }
          >
            Toggle continuing work
          </Button>
          <Button onClick={() => update("failed")}>Simulate not sent</Button>
          <Button onClick={() => update("unknown")}>Simulate uncertain delivery</Button>
          <Button onClick={() => update("queued")}>Queue answer</Button>
          <Button
            onClick={() => {
              if (!prompt || !reply || reply.kind !== "answered") return;
              const questionAnswers = prompt.questions.map((question) => ({
                prompt: question.prompt,
                answers: selectedAnswerLabels(question, reply),
              }));
              setBlocks([
                {
                  id: "accepted-answer",
                  role: "user",
                  text: questionAnswers
                    .map((answer) => `${answer.prompt}\n${answer.answers.join("\n")}`)
                    .join("\n\n"),
                  questionAnswers,
                },
              ]);
              setPrompt(undefined);
            }}
          >
            Confirm delivery
          </Button>
        </header>
        <output aria-label="Send count">{calls}</output>
        {shown && prompt ? (
          <QuestionForm
            prompt={prompt}
            draftScope={scope}
            onReply={(_, value) => {
              setReply(value);
              setCalls((count) => count + 1);
              update("sending");
            }}
          />
        ) : null}
        <div style={{ height: "360px", display: "flex", minWidth: 0 }}>
          <AgentTranscript blocks={blocks} />
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  query.has("capacity") ? (
    <CapacityFixture />
  ) : query.has("approval") ? (
    <ApprovalFixture />
  ) : (
    <Fixture />
  ),
);
