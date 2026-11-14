import { useEffect, useRef } from "react";
import { useIdleSessionDetach } from "../../../src/app/hooks/useIdleSessionDetach";
import { newTab } from "../../../src/features/workspace/model/layout";
import { newSession, type Session } from "../../../src/features/sessions/model/session";
import {
  getSessions,
  setSessions,
  useSessionsSelector,
} from "../../../src/features/sessions/model/sessionsStore";
import { useDelegatedCardBlocks } from "../../../src/features/sessions/model/reactiveReads";
import { DelegatedRunOwner, SubagentStack } from "../../../src/features/sessions/ui/SubagentCards";
import {
  SessionSubagentSheet,
  useDelegatedSheet,
} from "../../../src/features/sessions/ui/SessionSubagentSheet";
import { SessionSubagentsMenu } from "../../../src/features/sessions/ui/SessionSubagentsMenu";
import { Button } from "../../../src/shared/ui/Button";

const parentId = "retention-parent";
const noop = () => {};

export function seedDelegatedRetention() {
  const startedAt = Date.now() - 5_000;
  const parent = {
    ...newSession("codex", "/fixture"),
    id: parentId,
    busy: true,
    blocks: [{ id: "ask", role: "user" as const, text: "Discuss physics", startedAt }],
  };
  setSessions([
    parent,
    ...Array.from({ length: 10 }, (_, index) => ({
      ...newSession("claude", "/fixture"),
      id: `retention-child-${index + 1}`,
      title: `Physics table ${index + 1}`,
      model: "claude:haiku",
      busy: true,
      modelSettings: {
        delegationParent: JSON.stringify({
          parentSessionId: parentId,
          runId: `retention-run-${index + 1}`,
          kind: "subagent",
          model: "claude:haiku",
          startedAt: startedAt + 1,
        }),
      },
      blocks: [
        {
          id: `brief-${index}`,
          role: "user" as const,
          text: "Discuss entropy and the arrow of time.",
          startedAt: startedAt + 1,
        },
        {
          id: `reply-${index}`,
          role: "assistant" as const,
          text: "Low initial entropy explains the thermodynamic arrow of time.",
        },
      ],
    })),
  ]);
}

/** Actual detach hook, store selectors, cards, history menu and sheet; no Host RPC. */
export function DelegatedRetentionFixture() {
  const sessions = useSessionsSelector((entries) => entries);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const tabsRef = useRef([newTab(parentId)]);
  const openingSessionIds = useRef(new Set<string>());
  const loadedSessionCache = useRef(new Map<string, Session>());
  const skipForgetSessionIds = useRef(new Set<string>());
  const parent = sessions.find((session) => session.id === parentId)!;
  // Match the fixture theme without touching persisted app preferences.
  useEffect(() => {
    document.documentElement.classList.toggle(
      "theme-light",
      new URLSearchParams(location.search).get("theme") === "light",
    );
  }, []);
  useIdleSessionDetach({
    sessions,
    sessionsRef,
    tabs: tabsRef.current,
    tabsRef,
    orchestrationRuns: [],
    liveAgentsEnabled: false,
    unseenFinishedIds: new Set(),
    openingSessionIds,
    loadedSessionCache,
    skipForgetSessionIds,
    persistSession: noop,
    setSessions,
  });
  const delegated = useDelegatedSheet({
    sessionId: parentId,
    blocks: parent.blocks,
    onStopSession: noop,
    closeNative: noop,
  });
  const cards = useDelegatedCardBlocks(parentId, parent.blocks, true).filter(
    (block) => block.role === "tool",
  );
  return (
    <main
      className="relative flex h-dvh min-w-0 flex-col gap-4 bg-background-base p-4 text-content"
      data-session-drop
    >
      <p>Delegated session retention fixture</p>
      <Button
        onClick={() => setSessions(getSessions().map((session) => ({ ...session, busy: false })))}
      >
        Finish discussion
      </Button>
      <div data-testid="retained-cards">
        <DelegatedRunOwner.Provider value={parentId}>
          <SubagentStack blocks={cards} live />
        </DelegatedRunOwner.Provider>
      </div>
      <div data-composer>
        <SessionSubagentsMenu
          agents={delegated.agents}
          onOpen={(agent) => delegated.open(agent.sessionId!)}
        />
      </div>
      <SessionSubagentSheet
        visible
        busy={!!parent.busy}
        native={{
          close: noop,
          open: noop,
          showInTranscript: () => false,
          onOpenMain: noop,
          relay: { draft: "", setDraft: noop, send: noop },
        }}
        delegated={delegated}
        onSubmitToSession={() => false}
        onStopSession={noop}
      />
    </main>
  );
}
