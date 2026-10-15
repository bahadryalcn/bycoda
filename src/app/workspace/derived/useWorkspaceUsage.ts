import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  sessionProviderAccountId,
} from "../../../features/providers/model/providerAccounts";
import { loadFreshRateLimits } from "../../../features/providers/model/rateLimitsCache";
import { exhaustedWindowResetAt } from "../../../features/providers/model/rateLimits";
import {
  USAGE_LIMIT_RESUME_GRACE_MS,
  usageLimitResumeDue,
} from "../../../features/sessions/model/usageLimit";
import { type Session, type UsageLimit } from "../../../features/sessions/model/session";
import { latestTurnNeedsHarnessLogin } from "../../../integrations/harness";
import { setSessions } from "../../../features/sessions/model/sessionsStore";
import { findProjectTerminal } from "../../../features/projects/model/projectTerminal";
import { listRunningTerminals } from "../../../features/terminal/model/terminalTab";
import {
  focusedFileTab,
  type FilePaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { USAGE_PROVIDERS } from "../helpers/appHelpers";

/** Usage footer inputs derived from the active session. */
export function useWorkspaceUsage(active: Session | undefined) {
  const usageProviders = USAGE_PROVIDERS;
  const usageSession = useMemo(() => {
    if (!active) return undefined;
    return {
      id: active.id,
      harness: active.harness,
      model: active.model,
      authRequired: latestTurnNeedsHarnessLogin(active.blocks),
      providerAccountId:
        active.providerAccountId ??
        (active.blocks.some((block) => block.role === "user")
          ? DEFAULT_PROVIDER_ACCOUNT_ID
          : undefined),
    };
  }, [active?.id, active?.harness, active?.model, active?.blocks, active?.providerAccountId]);
  return { usageProviders, usageSession };
}

export interface RunningTerminalsDeps {
  projectCwd: string;
  projectTerminals: Parameters<typeof findProjectTerminal>[0];
  tabs: WorkspaceTab[];
  activeTab: WorkspaceTab | undefined;
  currentProjectDock: ReturnType<typeof findProjectTerminal>;
}

/** Running terminal files across the project dock and tab terminal panes. */
export function useRunningTerminals({
  projectCwd,
  projectTerminals,
  tabs,
  activeTab,
  currentProjectDock,
}: RunningTerminalsDeps) {
  const runningTerminals = useMemo(() => {
    const files: FilePaneTab[] = [];
    const dock = findProjectTerminal(projectTerminals, projectCwd);
    if (dock) files.push(...dock.pane.files);
    for (const tab of tabs) {
      for (const pane of tab.terminalPanes ?? []) {
        files.push(...pane.files);
      }
    }
    return listRunningTerminals(files);
  }, [projectCwd, projectTerminals, tabs]);
  const runningTerminalOpen = useMemo(() => {
    const ids = new Set(runningTerminals.map((terminal) => terminal.id));
    if (
      currentProjectDock?.open &&
      currentProjectDock.pane.files.some((file) => ids.has(file.id))
    ) {
      return true;
    }
    const focused = activeTab ? focusedFileTab(activeTab) : undefined;
    return !!focused && ids.has(focused.id);
  }, [activeTab, currentProjectDock, runningTerminals]);
  return { runningTerminals, runningTerminalOpen };
}

export interface UsageLimitResumeDeps {
  sessions: Session[];
  sessionsRef: MutableRefObject<Session[]>;
  movingSessionIds: MutableRefObject<Set<string>>;
  windowTransferPending: boolean;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingWindows: Set<string>;
  onUsageLimitResume: (sessionId: string) => void;
}

/** Resumes sessions once their usage limit resets; asks the provider when the stream gave no reset time. */
export function useUsageLimitResume({
  sessions,
  sessionsRef,
  movingSessionIds,
  windowTransferPending,
  windowTransferPendingRef,
  movingWindows,
  onUsageLimitResume,
}: UsageLimitResumeDeps): void {
  // Streaming-only replacements reuse the exact subset consumed by these effects.
  const previousLimits = useRef<Session[]>([]);
  const limited = sessions.filter((session) => session.usageLimit);
  if (
    limited.length !== previousLimits.current.length ||
    limited.some((session, i) => {
      const old = previousLimits.current[i];
      return (
        old?.id !== session.id ||
        old.usageLimit !== session.usageLimit ||
        old.harness !== session.harness ||
        old.providerAccountId !== session.providerAccountId ||
        old.providerSessionId !== session.providerSessionId ||
        old.busy !== session.busy
      );
    })
  )
    previousLimits.current = limited;
  const usageSessions = previousLimits.current;
  const usageResumingRef = useRef(new Set<string>());
  const usageResetLookups = useRef(new WeakSet<UsageLimit>());
  const [usageLimitTick, setUsageLimitTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const timers: number[] = [];
    const scheduled = new Set<string>();
    let nextCheck = Number.POSITIVE_INFINITY;
    for (const session of usageSessions) {
      const limit = session.usageLimit;
      if (windowTransferPending || movingSessionIds.current.has(session.id)) continue;
      if (!limit?.resumeAtReset || limit.resetsAt == null) continue;
      if (!usageLimitResumeDue(session, now)) {
        nextCheck = Math.min(nextCheck, limit.resetsAt + USAGE_LIMIT_RESUME_GRACE_MS - now);
        continue;
      }
      if (usageResumingRef.current.has(session.id)) continue;
      usageResumingRef.current.add(session.id);
      scheduled.add(session.id);
      timers.push(
        window.setTimeout(() => {
          usageResumingRef.current.delete(session.id);
          const latest = sessionsRef.current.find((entry) => entry.id === session.id);
          if (
            latest &&
            !windowTransferPendingRef.current &&
            !movingSessionIds.current.has(session.id) &&
            usageLimitResumeDue(latest, Date.now())
          ) {
            onUsageLimitResume(session.id);
          }
        }, 0),
      );
    }
    if (Number.isFinite(nextCheck)) {
      // Re-check every minute at most: timers drift while the machine sleeps.
      timers.push(
        window.setTimeout(
          () => setUsageLimitTick((tick) => tick + 1),
          Math.max(1_000, Math.min(nextCheck, 60_000)),
        ),
      );
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const id of scheduled) usageResumingRef.current.delete(id);
    };
  }, [onUsageLimitResume, usageSessions, usageLimitTick, movingWindows, windowTransferPending]);

  // The stream does not always say when the limit resets; ask the provider.
  useEffect(() => {
    for (const session of usageSessions) {
      const limit = session.usageLimit;
      if (!limit || limit.resetsAt != null) continue;
      if (usageResetLookups.current.has(limit)) continue;
      const provider = session.harness;
      if (provider !== "claude" && provider !== "codex") continue;
      usageResetLookups.current.add(limit);
      // Through the shared cache: several sessions hitting the limit at once
      // must not each ask the provider, which rate-limits this request.
      void loadFreshRateLimits(provider, sessionProviderAccountId(provider, session), 60_000).then(
        (limits) => {
          const resetsAt = exhaustedWindowResetAt(limits);
          if (resetsAt == null) return;
          setSessions((prev) =>
            prev.map((entry) =>
              entry.id === session.id && entry.usageLimit === limit
                ? { ...entry, usageLimit: { ...limit, resetsAt } }
                : entry,
            ),
          );
        },
      );
    }
  }, [usageSessions]);
}
