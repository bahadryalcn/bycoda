import { snapshot } from "./assistant-room-mocks";
import { JobRow } from "../../../src/features/assistant/ui/room/JobRow";
import { AssistantAvatarPicker } from "../../../src/features/assistant/ui/AssistantAvatar";
import { AssistantSessions } from "../../../src/features/assistant/ui/AssistantSessions";
import { ManualSessionSupervision } from "../../../src/features/assistant/ui/ManualSessionSupervision";
import { AssistantPresenceIndicator } from "../../../src/features/assistant/ui/AssistantPresenceIndicator";
import { NotesList } from "../../../src/features/assistant/ui/room/NotesList";
import { NotesReader } from "../../../src/features/assistant/ui/room/NotesReader";
import { JobReviewDialog } from "../../../src/features/assistant/ui/room/JobReviewDialog";
import {
  ConversationMessage,
  ConversationDayLabel,
} from "../../../src/features/assistant/ui/room/ConversationMessage";
import { BuilderPreview } from "../../../src/features/assistant/ui/builder/BuilderPreview";
import { NotesTab } from "../../../src/features/assistant/ui/room/NotesTab";
import { AssistantRoomContext } from "../../../src/features/assistant/ui/room/assistantRoomContext";
import { AssistantHistory } from "../../../src/features/assistant/ui/AssistantHistory";
import { AssistantMemoryPanel } from "../../../src/features/assistant/ui/AssistantMemoryPanel";

function NotesComponentFixture() {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const note = {
    ...snapshot.notes[0],
    title: "Assistant · 2026-11-13",
    tags: ["assistant"],
    body: "- 10:00 UTC · First item\n- 11:00 UTC · Second item",
  };
  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <NotesList
        notes={[note]}
        selectedId={undefined}
        onSelect={() => {}}
        checked={checked}
        onCheck={(id, value) => setChecked(value ? new Set([id]) : new Set())}
      />
      <NotesReader note={note} onEdit={() => {}} onDelete={() => {}} />
    </main>
  );
}

function AvatarPickerFixture() {
  const [avatar, setAvatar] = useState<string | undefined>();
  return (
    <AssistantAvatarPicker
      value={avatar}
      hideLabel={false}
      onChange={(patch) => setAvatar(patch.avatar)}
    />
  );
}

function JobRowFixture() {
  const [selected, setSelected] = useState(false);
  return (
    <JobRow
      job={snapshot.jobs[0]}
      projectName="Fixture project"
      selected={selected}
      selectionMode={selected}
      busy={false}
      disabled={false}
      error=""
      onSelect={setSelected}
      onDetails={() => {}}
      onControl={() => {}}
    />
  );
}

import { RecordsDatasetToggle } from "./records-redesign-data";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AssistantView } from "../../../src/features/assistant/ui/AssistantView";
import { AssistantSetup } from "../../../src/features/assistant/ui/AssistantSetup";
import {
  ModelSourceContext,
  LOCAL_MODEL_SOURCE,
} from "../../../src/features/sessions/ui/modelSource";
import { setupModelSource } from "./assistant-setup-controls-mocks";
import { setLanguagePreference } from "../../../src/shared/i18n";
import "../../../src/styles/index.css";
import { DesktopControlStrip } from "../../../src/features/host-tools/DesktopControlStrip";
import type {
  DesktopIndicatorPort,
  DesktopIndicatorView,
} from "../../../src/features/host-tools/desktopControlIndicator";
import { SessionFiltersMenu } from "../../../src/features/sessions/ui/SessionFiltersMenu";
import {
  DEFAULT_SESSION_SIDEBAR_FILTERS,
  filterAssistantManagedSessions,
} from "../../../src/features/sessions/model/sessionFilters";
import { AssistantManagedBadge } from "../../../src/features/sessions/ui/AssistantManagedBadge";
import { Button } from "../../../src/shared/ui/Button";
import { SessionMessageAuthor } from "../../../src/features/sessions/ui/SessionMessageAuthor";
import { Chatting } from "../../../src/shared/ui/icons";
import type { SessionSummary } from "../../../src/features/sessions/data/sessionStore";
import { KeybindingsPage } from "../../../src/features/settings/ui/ShortcutSettings";
import { VoiceJobReview } from "../../../src/features/voice/ui/VoiceJobReview";
import type { VoiceJobReviewState } from "../../../src/features/voice/model/voiceJobs";
import { VoiceChoiceCard } from "../../../src/features/voice/ui/VoiceChoiceCard";
import { parseVoiceChoice } from "../../../src/features/voice/model/voiceChoices";
import { voiceAssistantControlChoice } from "../../../src/features/voice/model/voiceAssistantControlChoice";
import voiceStyles from "../../../src/features/voice/ui/VoiceCompanion.module.css";
import { AssistantSessionControl } from "../../../src/features/sessions/ui/AssistantSessionControl";
import { AssistantTaskBadge } from "../../../src/features/tasks/ui/AssistantTaskBadge";
import { AccountPermissions } from "../../../src/features/social/ui/accounts/AccountPermissions";
import { AssistantNotificationRecovery } from "../../../src/features/assistant/ui/AssistantNotificationRecovery";
import { JobDetailActivity } from "../../../src/features/assistant/ui/room/JobDetailActivity";
import { JobDetailNotes } from "../../../src/features/assistant/ui/room/JobDetailNotes";
import { TrashPanel } from "../../../src/features/assistant/ui/room/TrashPanel";
import { ConversationDraftRecovery } from "../../../src/features/assistant/ui/room/ConversationDraftRecovery";
import { AssistantFoldersSettings } from "../../../src/features/assistant/ui/settings/folders/AssistantFoldersSettings";
import { AssistantOwnerQuestions } from "../../../src/features/assistant/ui/AssistantOwnerQuestions";
import { AssistantRemoteAccess } from "../../../src/features/assistant/ui/AssistantRemoteAccess";
import { AssistantRetentionField } from "../../../src/features/assistant/ui/settings/AssistantUsageSettings";
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
if (params.has("chat-launcher")) document.documentElement.dataset.canvasBackground = "pure";
await setLanguagePreference(params.get("lang") === "tr" ? "tr" : "en");
document.body.style.margin = "0";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ModelSourceContext.Provider
      value={params.has("real-controls") ? setupModelSource : LOCAL_MODEL_SOURCE}
    >
      {params.has("owner-state-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <AssistantOwnerQuestions
            environmentId="fixture"
            visibleProjectIds={["p"]}
            questions={[
              {
                id: "fixture-question",
                version: 1,
                jobId: "job",
                projectIds: ["p"],
                sourceToken: "a".repeat(64),
                sourceCurrent: true,
                origin: "chief",
                status: "open",
                createdAt: 1,
                updatedAt: 1,
                prompt: {
                  requestId: 7,
                  occurrenceId: "fixture-occurrence",
                  title: "Scope choice",
                  behavior: "nonBlocking",
                  questions: [
                    {
                      id: "choice",
                      prompt: "Choose the result",
                      multiSelect: false,
                      allowCustom: true,
                      options: [{ id: "focused", label: "Focused change" }],
                    },
                  ],
                },
              } as never,
            ]}
            request={() => Promise.reject(new Error("Fixture question unavailable"))}
          />
        </main>
      ) : params.has("remote-state-fixture") ? (
        <AssistantRemoteAccess
          threadId="fixture"
          environmentId="fixture"
          sourceStatus="unavailable"
          open
          onClose={() => {}}
        />
      ) : params.has("supervision-state-fixture") ? (
        <main style={{ padding: 24 }}>
          <ManualSessionSupervision
            projects={[]}
            controller={
              {
                data: null,
                pending: false,
                stopping: false,
                error: "Fixture supervision unavailable",
                chief: null,
              } as never
            }
          />
        </main>
      ) : params.has("usage-state-fixture") ? (
        <main style={{ padding: 24 }}>
          <AssistantRetentionField
            value={30}
            disabled={false}
            onChange={() => {}}
            usage={{ chiefTokens: 123, workerTokens: 456 } as never}
          />
        </main>
      ) : params.has("draft-state-fixture") ? (
        <ConversationDraftRecovery
          c={
            {
              draftRecovery: {
                threadId: "fixture",
                environmentId: "fixture",
                selected: "",
                backups: [],
                loading: false,
                error: "Fixture draft unavailable",
              },
              setDraftRecovery: () => {},
              setError: () => {},
              loadDraftBackups: async () => {},
              selectDraftBackup: async () => {},
              restoreDraftBackup: async () => {},
            } as never
          }
        />
      ) : params.has("trash-state-fixture") ? (
        <TrashPanel
          entries={[]}
          request={async () => ({}) as never}
          onRestored={() => {}}
          onClose={() => {}}
        />
      ) : params.has("folders-state-fixture") ? (
        <main style={{ padding: 24 }}>
          <AssistantFoldersSettings
            request={() => Promise.reject(new Error("Fixture folders unavailable"))}
          />
        </main>
      ) : params.has("job-review-fixture") ? (
        <AssistantRoomContext.Provider
          value={
            {
              projects: [],
              snapshot,
              pending: null,
              error: null,
              jobReview: [
                {
                  id: "one",
                  kind: "project",
                  request: "First request",
                  title: "First request",
                  projectIds: [],
                  projectId: "",
                },
                {
                  id: "two",
                  kind: "project",
                  request: "Second request",
                  title: "Second request",
                  projectIds: [],
                  projectId: "",
                },
              ],
              setJobReview: () => {},
              jobReviewFrozen: false,
              reviewedDraft: (draft: unknown) => draft,
              visibleDraft: () => true,
              updateJobDraft: () => {},
              submitJobs: async () => {},
              jobDraftVisible: true,
              reviewHasAutomation: false,
            } as never
          }
        >
          <JobReviewDialog />
        </AssistantRoomContext.Provider>
      ) : params.has("manual-notices-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <ManualSessionSupervision
            settings
            projects={[{ id: "one", path: "/fixture", name: "Fixture" }]}
            controller={
              {
                data: {
                  policy: { version: 1, enabled: false, projectIds: ["one"] },
                  grants: [],
                  candidates: [],
                },
                pending: null,
                stopping: false,
                error: "",
                chief: params.has("chief"),
              } as never
            }
          />
        </main>
      ) : params.has("job-sessions-fixture") ? (
        <main style={{ padding: 24 }}>
          <AssistantSessions
            jobs={snapshot.jobs}
            query=""
            filter=""
            projectName={() => "Fixture project"}
            onOpenSession={() => {}}
          />
        </main>
      ) : params.has("presence-marks-fixture") ? (
        <main style={{ padding: 24, display: "flex", gap: 16 }}>
          {(["present", "away", "dnd", "offline"] as const).map((state) => (
            <AssistantPresenceIndicator key={state} state={state} />
          ))}
        </main>
      ) : params.has("conversation-message-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <ConversationDayLabel at={Date.now()} />
          {(["assistant", "user"] as const).map((role) => (
            <ConversationMessage
              key={role}
              message={
                {
                  id: role,
                  role,
                  text: `${role} message`,
                  createdAt: Date.now(),
                  jobIds: [],
                } as never
              }
              authorName="Assistant"
              jobs={[]}
              clearing={false}
              onJob={() => {}}
              onDelete={() => {}}
            />
          ))}
        </main>
      ) : params.has("builder-preview-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <BuilderPreview
            proposal={
              {
                kind: "proposal",
                summary: "Suggested settings",
                profile: { name: "Arif", addressAs: "Alex" },
              } as never
            }
            current={{}}
            onBack={() => {}}
            onApply={() => {}}
          />
        </main>
      ) : params.has("notes-layout-fixture") ? (
        <main style={{ padding: 24 }}>
          <AssistantRoomContext.Provider
            value={
              {
                environmentId: "fixture",
                privacy: { key: "fixture" },
                canReadBriefing: () => true,
                view: "Notes",
                query: "",
                errorFor: () => null,
                empty: () => null,
              } as never
            }
          >
            <NotesTab snapshot={snapshot} />
          </AssistantRoomContext.Provider>
        </main>
      ) : params.has("notes-components-fixture") ? (
        <NotesComponentFixture />
      ) : params.has("avatar-picker-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <AvatarPickerFixture />
        </main>
      ) : params.has("trash-rows-fixture") ? (
        <TrashPanel
          entries={[
            snapshot.trash[0],
            { ...snapshot.trash[0], id: "second-trash", title: "Another deleted request" },
          ]}
          request={async () => ({}) as never}
          onRestored={() => {}}
          onClose={() => {}}
        />
      ) : params.has("job-notes-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <JobDetailNotes
            job={snapshot.jobs[0]}
            notes={
              [
                { id: "note-a", title: "First note", body: `About ${snapshot.jobs[0].title}` },
                { id: "note-b", title: "Second note", body: `More ${snapshot.jobs[0].title}` },
              ] as never
            }
            onOpenNote={() => {}}
          />
        </main>
      ) : params.has("collections-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720, display: "grid", gap: 24 }}>
          <AssistantHistory
            entries={[snapshot.activity[0], { ...snapshot.activity[0], id: "second-activity" }]}
            filtered={false}
            onJob={() => {}}
          />
          <AssistantMemoryPanel
            entries={[snapshot.memory[0], { ...snapshot.memory[0], id: "second-memory" }]}
            ruleCount={2}
            query=""
            searching={false}
            pending={false}
            searchError={null}
            errorFor={() => null}
            onQuery={() => {}}
            onAdd={() => {}}
            onEdit={() => {}}
            onToggle={() => {}}
            onDelete={() => {}}
          />
        </main>
      ) : params.has("job-row-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <JobRowFixture />
        </main>
      ) : params.has("job-state-fixture") ? (
        <main style={{ padding: 24, maxWidth: 720 }}>
          <h1>Job states</h1>
          <section aria-label="Loading activity">
            <JobDetailActivity jobId="loading" request={() => new Promise(() => {})} />
          </section>
          <section aria-label="Failed activity">
            <JobDetailActivity
              jobId="error"
              request={() => Promise.reject(new Error("Fixture activity unavailable"))}
            />
          </section>
          <section aria-label="Empty notes">
            <JobDetailNotes
              job={{ id: "job", title: "Fixture job" } as never}
              notes={[]}
              onOpenNote={() => {}}
            />
          </section>
        </main>
      ) : params.has("notification-recovery-fixture") ? (
        <NotificationRecoveryFixture />
      ) : params.has("room-author") ? (
        <RoomAuthorFixture />
      ) : params.has("account-grants") ? (
        <AccountGrantFixture />
      ) : params.has("setup") ? (
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
      <RecordsDatasetToggle />
    </ModelSourceContext.Provider>
  </QueryClientProvider>,
);
function NotificationRecoveryFixture() {
  return (
    <main style={{ padding: 24, maxWidth: 720, fontFamily: "var(--font-sans)" }}>
      <h1>History · fixture</h1>
      <AssistantNotificationRecovery
        environmentId="fixture-host"
        projects={[{ id: "fixture-project", name: "Fixture project" }]}
        request={async (input) => {
          if (params.has("slow-recovery") && input.op === "observation.delivery.list")
            await new Promise((resolve) => setTimeout(resolve, 1000));
          return input.op === "threads.open"
            ? { thread: { id: "fixture-room" } as never }
            : {
                observationDeliveries: [
                  {
                    notificationId: "observation:fixture-123",
                    projectId: "fixture-project",
                    state: input.op === "observation.delivery.refresh" ? "unknown" : "unknown",
                  },
                ],
              };
        }}
      />
    </main>
  );
}
function RoomAuthorFixture() {
  const author = {
    kind: "assistant-room" as const,
    name: "Assistant",
    threadId: "fixture-room",
    reason: "kickoff" as const,
    operationId: "fixture-operation",
  };
  return (
    <main style={{ padding: 24, fontFamily: "var(--font-sans)" }}>
      <div
        className="user-message-row"
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}
      >
        <SessionMessageAuthor author={author} onOpen={() => {}} />
        <p>Review this project and prepare the next steps.</p>
      </div>
    </main>
  );
}
function AccountGrantFixture() {
  const account = {
    id: "fixture-account",
    platform: "telegram" as const,
    platformId: "fixture",
    name: "Fixture account",
    accountType: "channel" as const,
    scopes: [],
    accessApproved: true,
    connected: true,
    paused: false,
    executorId: "fixture-host",
    grants: {},
    assistantGrant: { permissions: ["read"] as ("read" | "draft")[], version: "fixture-revision" },
    ...(params.has("account-pending")
      ? { assistantGrantPending: { permissions: [] as ("read" | "draft")[] } }
      : {}),
    createdAt: 1,
  };
  return (
    <main style={{ padding: 24, maxWidth: 720, fontFamily: "var(--font-sans)" }}>
      <h1>Fixture account</h1>
      <AccountPermissions
        account={account}
        client={
          {
            request: async () => {
              throw new Error("Fixture forbids writes");
            },
          } as never
        }
        projects={[]}
        disabled={false}
        onChanged={() => {}}
      />
    </main>
  );
}
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
        ["Upstream", "Backend"],
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
      { id: "one", path: "/fixture", name: "Upstream" },
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
        initialTab={
          params.has("settings")
            ? "settings"
            : params.has("chat-launcher") || params.has("global-room")
              ? "conversations"
              : undefined
        }
        projectPath={params.has("no-projects") ? undefined : "/fixture"}
        visibleProjectPaths={
          params.has("no-projects")
            ? []
            : params.has("privacy") && !hidden
              ? ["/fixture", "/secret"]
              : params.has("multi") && !hidden
                ? ["/fixture", "/backend"]
                : ["/fixture"]
        }
        projects={
          params.has("no-projects") ? [] : [{ id: "one", path: "/fixture", name: "Upstream" }]
        }
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
      {params.has("chat-launcher") && (
        <div className={voiceStyles.launcher}>
          <Button iconOnly label="Open voice companion">
            <Chatting className="icon-md" />
          </Button>
        </div>
      )}
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
