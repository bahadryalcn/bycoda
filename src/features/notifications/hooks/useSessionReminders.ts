import { invoke } from "@tauri-apps/api/core";
import { listenWindowAsync } from "../../../platform/tauri/listenWindow";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/ui/ToastRegion";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { loadNotificationEvents, subscribeNotificationEvents } from "../model/notificationEvents";
import { loadNotificationsEnabled, subscribeNotificationsEnabled } from "../model/notifications";
import { loadSoundsEnabled, subscribeSoundsEnabled } from "../../settings/model/sounds";
import {
  getProjectNotificationRule,
  loadNotificationPreferences,
  subscribeNotificationPreferences,
} from "../model/notificationPreferences";
import { pathKey } from "../../../shared/lib/paths";
import { describeLocalError } from "../../connections/public/remoteFailure";
import { isProjectLocked } from "../../group-lock/public/projectLock";
import { logNotification } from "../model/notificationLog";
import {
  knownNotificationProject,
  loadNotificationProjects,
  subscribeNotificationProjects,
} from "../model/notificationProjects";
import {
  clearReminders,
  listReminders,
  REMINDER_OPEN,
  REMINDERS_CHANGED,
  setReminders,
  type ReminderTarget,
  type SessionReminder,
} from "../../sessions/model/sessionReminders";

/**
 * Native cannot resolve a Room banner's projects from session ids, so it gets
 * the rules of every project with an override, keyed by `pathKey` (a catalog
 * project wins over `local:<pathKey>`, as in `knownNotificationProject`).
 */
function assistantProjectRules() {
  const preferences = loadNotificationPreferences();
  const rulesFor = (projectId: string) => ({
    finished: getProjectNotificationRule(projectId, "agentFinished"),
    input: getProjectNotificationRule(projectId, "agentInput"),
  });
  const rules: Record<string, ReturnType<typeof rulesFor>> = {};
  const claimed = new Set<string>();
  for (const project of loadNotificationProjects()) {
    for (const path of project.paths) {
      const key = pathKey(path);
      if (claimed.has(key)) continue;
      claimed.add(key);
      if (preferences[project.id]) rules[key] = rulesFor(project.id);
    }
  }
  for (const id of Object.keys(preferences)) {
    const key = id.startsWith("local:") ? id.slice("local:".length) : "";
    if (key && !claimed.has(key)) rules[key] = rulesFor(id);
  }
  return rules;
}

export function useSessionReminders(
  onOpenSession: (sessionId: string) => Promise<void>,
  ensureSaved: (sessionIds: readonly string[]) => Promise<void>,
  openSessionIds: readonly string[],
) {
  const [reminders, setItems] = useState<SessionReminder[]>([]);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState<string | null>(null);
  const [policyRevision, refreshPolicy] = useReducer((revision: number) => revision + 1, 0);
  const revision = useRef(0);
  const configured = useRef(false);
  const configurationRevision = useRef(0);
  const configurationQueue = useRef<Promise<void>>(Promise.resolve());
  const remindersRef = useRef(reminders);
  remindersRef.current = reminders;
  const callbacks = useRef({ onOpenSession, ensureSaved });
  callbacks.current = { onOpenSession, ensureSaved };

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable callbacks
  const configure = useCallback(async () => {
    const request = ++configurationRevision.current;
    // Native preferences are global state. Keep writes ordered and skip queued
    // snapshots superseded by another window event or a newer project policy.
    const pending = configurationQueue.current
      .catch(() => {})
      .then(async () => {
        if (request !== configurationRevision.current) return;
        await invoke("reminder_configure", {
          preferences: {
            notificationsEnabled: loadNotificationsEnabled(),
            sound: loadSoundsEnabled(),
            events: loadNotificationEvents(),
            assistantProjectRules: assistantProjectRules(),
            projectRules: Object.fromEntries(
              remindersRef.current.flatMap((reminder) => {
                const project = knownNotificationProject(reminder.cwd);
                return project
                  ? [[reminder.sessionId, getProjectNotificationRule(project.id, "reminders")]]
                  : [];
              }),
            ),
          },
        });
      });
    configurationQueue.current = pending;
    try {
      await pending;
    } catch (error) {
      if (request === configurationRevision.current) throw error;
    }
  }, []);

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable callbacks
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const listed = await listReminders();
      if (request !== revision.current) return;
      // The 30 s safety refresh usually finds nothing new: keep the same array and
      // clock so the workspace does not re-render, and skip the native reconfigure.
      const changed = !sameReminders(remindersRef.current, listed);
      const items = changed ? listed : remindersRef.current;
      remindersRef.current = items;
      setItems(items);
      const current = Date.now();
      setNow((previous) =>
        items.some((item) => item.dueAt > previous && item.dueAt <= current) ? current : previous,
      );
      setError(null);
      if (changed || !configured.current) {
        configured.current = true;
        await configure();
      }
    } catch (error) {
      if (request === revision.current) setError(localError(error));
    }
  }, [configure]);

  const report = (error: unknown) => {
    toast.show({
      tone: "danger",
      title: t("Reminder"),
      message: describeLocalError(error, t("Could not update this reminder.")),
    });
  };

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable callbacks
  const schedule = useCallback(
    async (ids: readonly string[], dueAt: number) => {
      try {
        await callbacks.current.ensureSaved(ids);
        await setReminders(ids, dueAt);
        await refresh();
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable callbacks
  const cancel = useCallback(
    async (ids: readonly string[], expectedDueAt?: number) => {
      try {
        await clearReminders(ids, expectedDueAt);
        await refresh();
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable callbacks
  const dismissDue = useCallback(
    async (sessionId: string) => {
      const reminder = remindersRef.current.find(
        (item) => item.sessionId === sessionId && item.dueAt <= Date.now(),
      );
      if (!reminder) return;
      await cancel([sessionId], reminder.dueAt);
    },
    [cancel],
  );

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable callbacks
  const openHere = useCallback(
    async (reminder: ReminderTarget) => {
      try {
        await callbacks.current.onOpenSession(reminder.sessionId);
        // An old notification must never clear a newer reminder for this session.
        await clearReminders([reminder.sessionId], reminder.dueAt);
        await refresh();
      } catch (error) {
        report(error);
      }
    },
    [refresh],
  );

  useEffect(() => {
    let disposed = false;
    const subscriptions: Array<() => void> = [];
    const configureCurrent = () => {
      refreshPolicy();
      void configure().catch((error) => {
        if (!disposed) setError(localError(error));
      });
    };
    const takeOpen = async () => {
      if (disposed) return;
      try {
        const request = await invoke<ReminderTarget | null>("reminder_take_open");
        if (request && !disposed) await openHere(request);
      } catch (error) {
        if (!disposed) setError(localError(error));
      }
    };
    const subscribe = async (event: string, handler: () => void) => {
      const unlisten = await listenWindowAsync(event, () => {
        if (!disposed) handler();
      });
      if (disposed) unlisten();
      else subscriptions.push(unlisten);
    };
    void (async () => {
      try {
        await Promise.all([
          subscribe(REMINDERS_CHANGED, () => {
            void refresh();
          }),
          subscribe(REMINDER_OPEN, () => {
            void takeOpen();
          }),
        ]);
        if (disposed) return;
        await refresh();
        await takeOpen();
      } catch (error) {
        if (!disposed) setError(localError(error));
      }
    })();
    const onFocus = () => {
      void refresh();
      void takeOpen();
    };
    const onVisible = () => {
      if (!document.hidden) onFocus();
    };
    // The backend owns firing. This refresh catches renamed/deleted sessions,
    // missed events, and a machine waking after its scheduled time.
    // A hidden window skips it: becoming visible refreshes immediately.
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const unsubscribeNotifications = subscribeNotificationsEnabled(configureCurrent);
    const unsubscribeEvents = subscribeNotificationEvents(configureCurrent);
    const unsubscribeSounds = subscribeSoundsEnabled(configureCurrent);
    const unsubscribePreferences = subscribeNotificationPreferences(configureCurrent);
    // Catalog changes move which paths belong to a muted project.
    const unsubscribeProjects = subscribeNotificationProjects(configureCurrent);
    return () => {
      disposed = true;
      unsubscribePreferences();
      unsubscribeProjects();
      revision.current++;
      configurationRevision.current++;
      subscriptions.forEach((unlisten) => unlisten());
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribeNotifications();
      unsubscribeSounds();
      unsubscribeEvents();
    };
  }, [openHere, refresh, configure]);

  const sessionIdsKey = JSON.stringify(openSessionIds);
  useEffect(() => {
    void invoke("reminder_register_window", {
      sessionIds: JSON.parse(sessionIdsKey),
    }).catch((error) => setError(localError(error)));
  }, [sessionIdsKey]);

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable callbacks
  const open = useCallback(async (reminder: ReminderTarget) => {
    try {
      await invoke("reminder_open", {
        sessionId: reminder.sessionId,
        dueAt: reminder.dueAt,
      });
    } catch (error) {
      report(error);
    }
  }, []);

  // oxlint-disable-next-line bycoda/compiler-owns-memo -- this hook is uncompiled (it writes refs during render), so its effect dependencies need stable values
  const due = useMemo(
    () =>
      reminders.filter((reminder) => {
        const project = knownNotificationProject(reminder.cwd);
        if (!project || reminder.dueAt > now) return false;
        const rule = getProjectNotificationRule(project.id, "reminders");
        return rule.enabled && reminder.dueAt > rule.after;
      }),
    // policyRevision: notification rules live outside React state.
    [reminders, now, policyRevision],
  );

  // The log keeps every due reminder, also when the banner was suppressed. Windows record
  // the same key and time, which the log stores once.
  const logged = useRef(new Set<string>());
  useEffect(() => {
    for (const reminder of due) {
      const key = `reminder:${reminder.sessionId}:${reminder.dueAt}`;
      if (logged.current.has(key)) continue;
      logged.current.add(key);
      logNotification({
        kind: "reminder",
        key,
        title: reminder.title,
        label: "",
        session: { id: reminder.sessionId, cwd: reminder.cwd, harness: reminder.harness },
        occurredAt: reminder.dueAt,
        locked: isProjectLocked(reminder.cwd),
      });
    }
  }, [due]);

  return {
    reminders,
    due,
    error,
    refresh,
    schedule,
    cancel,
    dismissDue,
    open,
  };
}

/** A failed load or listener, as the inline reminder state shows it. */
const localError = (error: unknown) => describeLocalError(error, t("Couldn’t load reminders."));

function sameReminders(a: readonly SessionReminder[], b: readonly SessionReminder[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index];
      return (
        item.sessionId === other.sessionId &&
        item.dueAt === other.dueAt &&
        item.firedAt === other.firedAt &&
        item.title === other.title &&
        item.harness === other.harness &&
        item.cwd === other.cwd
      );
    })
  );
}
