import { useRef, useState } from "react";
import { useIdleSessionDetach } from "../../../src/app/hooks/useIdleSessionDetach";
import { getSessions, setSessions } from "../../../src/features/sessions/model/sessionsStore";
import type { Session } from "../../../src/features/sessions/model/session";
import type { WorkspaceTab } from "../../../src/features/workspace/model/layout";
import { Button } from "../../../src/shared/ui/Button";
import { SessionDiscussionPanel } from "../../../src/features/sessions/public/SessionDiscussionPanel";
import type { PanelSessionPortal } from "../../../src/features/sessions/model/scopedPanelSession";
import { SessionSurface } from "../../../src/features/sessions/ui/SessionSurface";
import { SessionPane, type SessionPaneProps } from "../../../src/features/sessions/ui/SessionPane";

/** Real discussion, portal and composer. Only native/provider callbacks are simulated. */
export function SessionDiscussionFixture(props: SessionPaneProps) {
  const [open, setOpen] = useState(false);
  const [portal, setPortal] = useState<PanelSessionPortal | null>(null);
  const [retainedSessionIds, setRetainedSessionIds] = useState<string[]>([]);
  const sessionsRef = useRef<Session[]>([]);
  sessionsRef.current = retainedSessionIds.length ? getSessions() : [];
  const tabsRef = useRef<WorkspaceTab[]>([]);
  const openingSessionIds = useRef(new Set<string>());
  const loadedSessionCache = useRef(new Map<string, Session>());
  const skipForgetSessionIds = useRef(new Set<string>());
  useIdleSessionDetach({
    sessions: sessionsRef.current,
    sessionsRef,
    tabs: tabsRef.current,
    tabsRef,
    retainedSessionIds,
    orchestrationRuns: [],
    liveAgentsEnabled: false,
    unseenFinishedIds: new Set(),
    openingSessionIds,
    loadedSessionCache,
    skipForgetSessionIds,
    persistSession: () => {},
    setSessions,
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Button onClick={() => setOpen(true)}>AI chat</Button>
      <div className="flex min-h-0 flex-1">
        {open ? (
          <SessionDiscussionPanel
            scopeKey="social-fixture"
            title="Social Media"
            label="AI chat"
            onOpen={async () => {
              setRetainedSessionIds((ids) =>
                ids.includes(props.session.id) ? ids : [...ids, props.session.id],
              );
              return props.session.id;
            }}
            onMount={setPortal}
            onClose={() => setOpen(false)}
          />
        ) : null}
        {portal ? (
          <SessionSurface host={portal.host}>
            <SessionPane {...props} embedded visible focused />
          </SessionSurface>
        ) : null}
      </div>
    </div>
  );
}
