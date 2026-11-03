import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AssistantView } from "../../src/features/assistant/ui/AssistantView";
import { AssistantSetup } from "../../src/features/assistant/ui/AssistantSetup";
import { ModelSourceContext, LOCAL_MODEL_SOURCE } from "../../src/features/sessions/ui/modelSource";
import { setupModelSource } from "./assistant-setup-controls-mocks";
import { setLanguagePreference } from "../../src/shared/i18n";
import "../../src/styles/index.css";
import { DesktopControlStrip } from "../../src/features/host-tools/DesktopControlStrip";
import type {
  DesktopIndicatorPort,
  DesktopIndicatorView,
} from "../../src/features/host-tools/desktopControlIndicator";
import { SessionFiltersMenu } from "../../src/features/sessions/ui/SessionFiltersMenu";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  filterAssistantManagedSessions,
} from "../../src/features/sessions/model/sessionFilters";
import { AssistantManagedBadge } from "../../src/features/sessions/ui/AssistantManagedBadge";
import { Button } from "../../src/shared/ui/Button";
import type { SessionSummary } from "../../src/features/sessions/data/sessionStore";
import { KeybindingsPage } from "../../src/features/settings/ui/ShortcutSettings";
import { VoiceJobReview } from "../../src/features/voice/ui/VoiceJobReview";
import type { VoiceJobReviewState } from "../../src/features/voice/model/voiceJobs";
import { VoiceChoiceCard } from "../../src/features/voice/ui/VoiceChoiceCard";
import { parseVoiceChoice } from "../../src/features/voice/model/voiceChoices";
import { voiceAssistantControlChoice } from "../../src/features/voice/model/voiceAssistantControlChoice";
import voiceStyles from "../../src/features/voice/ui/VoiceCompanion.module.css";
import { AssistantSessionControl } from "../../src/features/sessions/ui/AssistantSessionControl";
import { AssistantTaskBadge } from "../../src/features/tasks/ui/AssistantTaskBadge";
const params = new URLSearchParams(location.search);
if (params.has("real-controls")) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: async () => [],
      getUserMedia: async () => {
        (window as any).setupVoice.forbiddenMediaRequests++;
        throw new Error("Real device access is forbidden in this fixture.");
      },
    },
  });
}
const indicatorListeners = new Set<(value: DesktopIndicatorView) => void>();
let indicator: DesktopIndicatorView = {
  revision: 1,
  status: {
    enabled: true,
    active: true,
    stopped: false,
    assistantName: "Arif",
    currentAction: { app: "Notepad", action: "set-value" },
  },
  statusError: false,
  stopError: false,
  stopping: false,
  visible: true,
};
const indicatorPort: DesktopIndicatorPort = {
  read: async () => indicator,
  subscribe: async (receive) => {
    indicatorListeners.add(receive);
    return () => {
      indicatorListeners.delete(receive);
    };
  },
  stop: async () => {
    indicator = {
      ...indicator,
      revision: indicator.revision + 1,
      status: { enabled: false, active: false, stopped: true },
      visible: false,
    };
    for (const receive of indicatorListeners) receive(indicator);
  },
};
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(
  <ModelSourceContext.Provider
    value={params.has("real-controls") ? setupModelSource : LOCAL_MODEL_SOURCE}
  >
    {params.has("setup") ? (
      <AssistantSetupFixture />
    ) : params.has("session-controls") ? (
      <SessionControlsFixture />
    ) : params.has("keybindings") ? (
      <KeybindingsPage />
    ) : params.has("session-filter") ? (
      <ManagedSessionFilterFixture />
    ) : params.has("voice-delete") ? (
      <VoiceDeleteReviewFixture />
    ) : params.has("voice-jobs") ? (
      <VoiceJobReviewFixture />
    ) : (
      <AssistantRoomFixture />
    )}
  </ModelSourceContext.Provider>,
);
function AssistantSetupFixture() {
  const [open, setOpen] = useState(true);
  return (
    <main>
      <p>
        Fixture evidence · real setup controls with synthetic Host, provider and microphone ports.
      </p>
      <Button onClick={() => setOpen(true)}>Reopen setup</Button>
      {open && (
        <AssistantSetup voice={params.get("setup") !== "core"} onClose={() => setOpen(false)} />
      )}
    </main>
  );
}
function VoiceDeleteReviewFixture() {
  const [answer, setAnswer] = useState("");
  const [choice] = useState(() =>
    parseVoiceChoice(
      voiceAssistantControlChoice(
        {
          kind: "job",
          action: "delete",
          id: "fixture-job",
          title: "Review the recovery workflow",
          version: 2,
          projectId: "one",
          projectIds: ["one", "two"],
          deleteReview: {
            jobId: "fixture-job",
            jobVersion: 2,
            sourceToken: "a".repeat(64),
            goalId: "assistant-fixture-job",
            projectIds: ["one", "two"],
            tasks: [
              {
                id: "task-one",
                title: "Inspect the recovery source",
                projectId: "one",
                status: "running",
                updatedAt: 1,
              },
              {
                id: "task-two",
                title: "Check the service contract",
                projectId: "two",
                status: "queued",
                updatedAt: 1,
              },
            ],
          },
        },
        ["MonoCode", "Backend"],
      ),
    ),
  );
  return (
    <section className={voiceStyles.panel} aria-label="Voice deletion review fixture">
      <header className={voiceStyles.header}>
        <h2 className={voiceStyles.title}>Assistant Arif</h2>
      </header>
      <div className={voiceStyles.body}>
        {answer ? (
          <p role="status">{answer}</p>
        ) : (
          <VoiceChoiceCard
            choice={choice}
            onReply={(reply) => {
              document.body.dataset.deletionDecision =
                reply.kind === "answered" ? reply.answers.choice?.join(",") : "skipped";
              setAnswer("Synthetic confirmation captured. No Host or task was changed.");
            }}
          />
        )}
      </div>
    </section>
  );
}

function VoiceJobReviewFixture() {
  const [review, setReview] = useState<VoiceJobReviewState>({
    id: "fixture-review",
    jobs: [
      {
        id: "row",
        title: "Coordinate both projects",
        request: "Review frontend and backend changes together.",
        projectId: "one",
        projectIds: ["one"],
        idempotencyKey: "fixture-key",
      },
    ],
    projects: [
      { id: "one", path: "/fixture", name: "MonoCode" },
      { id: "two", path: "/backend", name: "Backend" },
    ],
    quickNotes: true,
    quickAutomations: true,
    busy: false,
    error: "",
    accepted: [],
  });
  return (
    <section className={voiceStyles.panel} aria-label="Voice job review fixture">
      <header className={voiceStyles.header}>
        <h2 className={voiceStyles.title}>Assistant Arif</h2>
      </header>
      <div className={voiceStyles.body}>
        <VoiceJobReview
          review={review}
          onChange={(jobs) => setReview((current) => ({ ...current, jobs }))}
          onStart={(jobs) =>
            setReview((current) => ({
              ...current,
              jobs,
              error: "Job status is unknown. Check the Room before retrying.",
            }))
          }
          onCancel={() => setReview((current) => ({ ...current, error: "" }))}
        />
      </div>
    </section>
  );
}

function AssistantRoomFixture() {
  const [hidden, setHidden] = useState(false);
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {(params.has("privacy") || params.has("multi")) && (
        <div>
          <Button onClick={() => setHidden((value) => !value)}>
            {hidden ? "Show fixture project" : "Hide fixture project"}
          </Button>
        </div>
      )}
      {params.has("desktop") && <DesktopControlStrip port={indicatorPort} />}
      <AssistantView
        projectPath="/fixture"
        visibleProjectPaths={
          params.has("privacy") && !hidden
            ? ["/fixture", "/secret"]
            : params.has("multi") && !hidden
              ? ["/fixture", "/backend"]
              : ["/fixture"]
        }
        projects={[{ id: "one", path: "/fixture", name: "MonoCode" }]}
        onOpenSession={() => {}}
        onOpenAutomation={(target) => {
          document.body.dataset.openedAutomation = target.id;
          document.body.dataset.automationEnvironment = target.environmentId;
        }}
        onReviewJobTasks={(target) => {
          document.body.dataset.reviewedJob = target.jobId;
          document.body.dataset.reviewedJobEnvironment = target.environmentId;
        }}
        onOpenGoal={(target) => {
          document.body.dataset.openedGoal = target.goalId;
        }}
      />
    </div>
  );
}

function ManagedSessionFilterFixture() {
  const [filters, setFilters] = useState(DEFAULT_SESSION_SIDEBAR_FILTERS);
  const [open, setOpen] = useState(false);
  const rows: SessionSummary[] = [
    {
      id: "managed",
      cwd: "/fixture",
      harness: "claude",
      model: "fixture",
      runtimeMode: "supervised",
      title: "Verify retained job output",
      createdAt: 1,
      updatedAt: 2,
      additions: 0,
      deletions: 0,
      managedBy: { assistant: true, jobId: "one", managedAt: 1 },
    },
    {
      id: "manual",
      cwd: "/fixture",
      harness: "claude",
      model: "fixture",
      runtimeMode: "supervised",
      title: "Owner's manual conversation",
      createdAt: 1,
      updatedAt: 2,
      additions: 0,
      deletions: 0,
    },
  ];
  return (
    <main className="p-4">
      <h1>Sessions</h1>
      <Button onClick={() => setOpen(true)}>Filter sessions</Button>
      <ul className="mt-4 flex flex-col gap-2">
        {filterAssistantManagedSessions(rows, filters.assistantManaged).map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <span>{row.title}</span>
            <AssistantManagedBadge management={row.managedBy} />
          </li>
        ))}
      </ul>
      {open && (
        <SessionFiltersMenu
          x={32}
          y={96}
          harnesses={["claude"]}
          filters={filters}
          onChange={setFilters}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

function SessionControlsFixture() {
  return (
    <main className="p-4 flex flex-col gap-4">
      <h1>Fixture · Assistant session follow-ups</h1>
      <section className="flex items-center gap-3">
        <h2>Verify cancellation recovery</h2>
        <AssistantSessionControl
          sessionId="fixture-session"
          cwd="/fixture"
          local
          management={{ assistant: true, jobId: "job-one", managedAt: 1 }}
        />
      </section>
      <section>
        <h2>Worker task</h2>
        <AssistantTaskBadge
          task={{ assistantFollowups: { delivered: 3, unconfirmed: 1 } } as any}
        />
      </section>
      <p>Isolated fixture. No Host write or running worker.</p>
    </main>
  );
}
