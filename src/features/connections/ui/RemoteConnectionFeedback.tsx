import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { connectionOutcome, RECONNECT_GRACE_MS } from "../model/remoteConnection";
import {
  classifyRemoteError,
  isConnectionFailure,
  remoteErrorText,
  type RemoteFailure,
} from "../model/remoteFailure";
import { setConnectionErrorGate } from "../../../shared/ui/connectionErrorGate";
import { parseRemotePath } from "../model/remoteProjects";
import { readRemoteDownSince } from "../model/remoteHealth";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { useRemoteConnection } from "../model/useRemoteConnection";
import { useMachineFocus } from "../model/machineFocus";
import {
  loadRemoteAutoReconnect,
  subscribeRemoteAutoReconnect,
} from "../../settings/public/settings";
import { RemoteLoadError } from "./RemoteLoadError";

/** A blip shorter than this shows nothing at all. */
const TRANSIENT_NOTICE_DELAY_MS = 2_000;
/** Until then a short outage reads "Reconnecting…"; after it, the full notice. */
const TRANSIENT_ESCALATE_MS = RECONNECT_GRACE_MS;
type Registration = { environmentId: string; failure?: RemoteFailure };
type Feedback = {
  entries: ReadonlyMap<symbol, Registration>;
  register(key: symbol, value?: Registration): void;
  /** Mounted notice outlets, each for one machine, in mount order. */
  owners: ReadonlyMap<symbol, string>;
  registerOwner(key: symbol, environmentId?: string): void;
};
const FeedbackContext = createContext<Feedback | null>(null);
const environmentOf = (value?: string) =>
  value
    ? (parseRemotePath(value)?.environmentId ?? (/^[\w-]+$/.test(value) ? value : undefined))
    : undefined;

/** Own presentation only. Native connection state, admission and recovery stay unchanged. */
export function RemoteConnectionFeedbackProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<symbol, Registration>>(() => new Map());
  const [owners, setOwners] = useState<ReadonlyMap<symbol, string>>(() => new Map());
  const register = useCallback((key: symbol, value?: Registration) => {
    setEntries((previous) => {
      if (!value && !previous.has(key)) return previous;
      const next = new Map(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, []);
  const registerOwner = useCallback((key: symbol, environmentId?: string) => {
    setOwners((previous) => {
      if (previous.get(key) === environmentId) return previous;
      const next = new Map(previous);
      if (environmentId) next.set(key, environmentId);
      else next.delete(key);
      return next;
    });
  }, []);
  const feedback = useMemo(
    () => ({ entries, register, owners, registerOwner }),
    [entries, register, owners, registerOwner],
  );
  return <FeedbackContext.Provider value={feedback}>{children}</FeedbackContext.Provider>;
}

const hasOwner = (feedback: Feedback | null, environmentId?: string) =>
  !!feedback && !!environmentId && [...feedback.owners.values()].includes(environmentId);

/** A pane hands machine-wide failures to its machine's mounted session notice, never operation errors. */
export function useRemoteConnectionFeedback(
  cwdOrEnvironmentId?: string,
  failure?: RemoteFailure,
): boolean {
  const feedback = useContext(FeedbackContext);
  const register = feedback?.register;
  const environmentId = environmentOf(cwdOrEnvironmentId);
  const [key] = useState(() => Symbol("remote-connection-consumer"));
  const kind = failure && isConnectionFailure(failure) ? failure.kind : undefined;
  const message = kind ? failure?.message : undefined;
  useEffect(() => {
    if (!register || !environmentId) return;
    register(key, {
      environmentId,
      ...(kind && message !== undefined ? { failure: { kind, message } } : {}),
    });
    return () => register(key);
  }, [register, key, environmentId, kind, message]);
  return hasOwner(feedback, environmentId) && (!failure || isConnectionFailure(failure));
}

/**
 * Place once in a remote session, above its composer: the machine's one connection notice, shown
 * only there. A machine with no open session raises nothing anywhere else; other panes of the same
 * machine leave their connection failures to this notice while it is mounted.
 */
export function RemoteConnectionNotice({
  cwdOrEnvironmentId,
  stale = false,
}: {
  cwdOrEnvironmentId: string;
  stale?: boolean;
}) {
  const feedback = useContext(FeedbackContext);
  const environmentId = environmentOf(cwdOrEnvironmentId);
  const [ownerKey] = useState(() => Symbol("remote-connection-notice"));
  const registerOwner = feedback?.registerOwner;
  // An open session is work in this machine: check and redial it at the full pace.
  useMachineFocus(environmentId);
  useLayoutEffect(() => {
    if (!registerOwner || !environmentId) return;
    registerOwner(ownerKey, environmentId);
    return () => registerOwner(ownerKey);
  }, [registerOwner, ownerKey, environmentId]);
  if (!environmentId) return null;
  // Two sessions of one machine side by side: only the first mounted presents.
  if (feedback) {
    const first = [...feedback.owners].find(([, id]) => id === environmentId)?.[0];
    if (first !== ownerKey) return null;
  }
  let failure: RemoteFailure | undefined;
  for (const entry of feedback?.entries.values() ?? []) {
    if (entry.environmentId !== environmentId || !entry.failure) continue;
    if (!failure || (failure.kind === "unreachable" && entry.failure.kind !== "unreachable"))
      failure = entry.failure;
  }
  return <MachineConnectionNotice environmentId={environmentId} failure={failure} stale={stale} />;
}

/** An unreachable failure must name the remote link, not a bare socket error of a local command. */
const REMOTE_LINK =
  /RPC_|Host|Machine|machine|SSH|OpenSSH|Connect this project|Connection changed|os error 10(053|054|060)/;
const isCentralConnectionError = (error: unknown) => {
  const failure = classifyRemoteError(error);
  if (!isConnectionFailure(failure)) return false;
  return failure.kind !== "unreachable" || REMOTE_LINK.test(remoteErrorText(error));
};
let visibleNotices = 0;

/**
 * While at least one machine notice is on screen or in its quiet window, shared failure components
 * leave its connection errors to it: a blip while loading or reconnecting flashes nothing, and an
 * outage that lasts gets the notice. A dismissed notice installs nothing, so panes explain again.
 */
function useConnectionGateWhileVisible(visible: boolean) {
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- counts visible notices into the module-level shared UI error gate, released on hide or unmount
  useLayoutEffect(() => {
    if (!visible) return;
    visibleNotices += 1;
    if (visibleNotices === 1) setConnectionErrorGate(isCentralConnectionError);
    return () => {
      visibleNotices -= 1;
      if (visibleNotices === 0) setConnectionErrorGate(null);
    };
  }, [visible]);
}

function MachineConnectionNotice({
  environmentId,
  failure,
  stale,
}: {
  environmentId: string;
  failure?: RemoteFailure;
  stale: boolean;
}) {
  useLocale();
  const { status, error, reconnecting, lastSeen } = useRemoteConnection(environmentId);
  const autoReconnect = useSyncExternalStore(
    subscribeRemoteAutoReconnect,
    loadRemoteAutoReconnect,
    () => true,
  );
  const statusFromFailure = failure ? connectionOutcome(failure.message).status : undefined;
  // The machine's own status decides whether there is an outage; a pane's registered failure
  // only chooses the wording, and a stale `unreachable` one is ignored once the machine answers.
  const hardFromFailure =
    !!statusFromFailure &&
    !["unreachable", "host-not-running", "connected"].includes(statusFromFailure);
  const staleFailure =
    !!failure && failure.kind === "unreachable" && status === "connected" && !hardFromFailure;
  const active =
    (!!failure && !staleFailure) || (status !== "connected" && status !== "connecting");
  const transient =
    (!failure || failure.kind === "unreachable") &&
    (status === "unreachable" ||
      status === "host-not-running" ||
      status === "connected" ||
      status === "connecting") &&
    (!statusFromFailure ||
      statusFromFailure === "unreachable" ||
      statusFromFailure === "host-not-running" ||
      statusFromFailure === "connected");
  const downSince = readRemoteDownSince(environmentId);
  const [seenFailureAt, setFirstFailureAt] = useState<number | undefined>(() =>
    active ? Date.now() : undefined,
  );
  // The outage began when the machine first stopped answering, not when this notice mounted.
  const firstFailureAt = downSince ?? seenFailureAt;
  const [now, setNow] = useState(Date.now);
  const [dismissed, setDismissed] = useState(false);
  // Start one outage clock per mounted machine, retaining it across pane failures.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFirstFailureAt((previous) => (active ? (previous ?? Date.now()) : undefined));
      if (!active) setDismissed(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [active]);
  // Re-render when a short outage becomes visible and again when it escalates.
  useEffect(() => {
    if (!active || !transient || !autoReconnect || reconnecting || firstFailureAt === undefined)
      return;
    const elapsed = Date.now() - firstFailureAt;
    const next =
      elapsed < TRANSIENT_NOTICE_DELAY_MS
        ? TRANSIENT_NOTICE_DELAY_MS - elapsed
        : TRANSIENT_ESCALATE_MS - elapsed;
    if (next <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), next);
    return () => clearTimeout(timer);
  }, [active, transient, autoReconnect, reconnecting, firstFailureAt, now]);
  const quiet =
    transient &&
    autoReconnect &&
    !reconnecting &&
    (firstFailureAt === undefined || now < firstFailureAt + TRANSIENT_NOTICE_DELAY_MS);
  const visible = active && !(dismissed && transient) && !quiet;
  useConnectionGateWhileVisible(active && !(dismissed && transient));
  if (!visible) return null;
  const recovering =
    transient &&
    autoReconnect &&
    (reconnecting || firstFailureAt === undefined || now < firstFailureAt + TRANSIENT_ESCALATE_MS);
  const hardState =
    status !== "connected" &&
    status !== "connecting" &&
    status !== "unreachable" &&
    status !== "host-not-running";
  const currentFailure: RemoteFailure = {
    kind:
      status === "outdated-host"
        ? "outdated"
        : status === "identity-mismatch"
          ? "identity"
          : "unreachable",
    message: error ?? failure?.message ?? "",
  };
  const displayedFailure = hardState ? currentFailure : (failure ?? currentFailure);
  const since =
    lastSeen && displayedFailure.kind === "unreachable"
      ? t(" Last connected at {p0}.", {
          p0: formatDate(lastSeen, { hour: "2-digit", minute: "2-digit" }),
        })
      : "";
  return (
    <div className="shrink-0 px-2 py-1">
      <RemoteLoadError
        cwd={environmentId}
        failure={{ ...displayedFailure, message: `${displayedFailure.message}${since}` }}
        compact
        stale={stale}
        coordinated={false}
        recovering={recovering}
        onDismiss={transient && !recovering ? () => setDismissed(true) : undefined}
      />
    </div>
  );
}
