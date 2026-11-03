import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { connectionOutcome } from "../model/remoteConnection";
import { isConnectionFailure, type RemoteFailure } from "../model/remoteFailure";
import { parseRemotePath } from "../model/remoteProjects";
import { useRemoteConnection } from "../model/useRemoteConnection";
import {
  loadRemoteAutoReconnect,
  subscribeRemoteAutoReconnect,
} from "../../settings/model/settings";
import { RemoteLoadError } from "./RemoteLoadError";

const TRANSIENT_NOTICE_DELAY_MS = 8_000;
type Registration = { environmentId: string; failure?: RemoteFailure };
type Feedback = {
  entries: ReadonlyMap<symbol, Registration>;
  register(key: symbol, value?: Registration): void;
  owners: ReadonlySet<symbol>;
  registerOwner(key: symbol, mounted: boolean): void;
};
const FeedbackContext = createContext<Feedback | null>(null);
const environmentOf = (value?: string) =>
  value
    ? (parseRemotePath(value)?.environmentId ?? (/^[\w-]+$/.test(value) ? value : undefined))
    : undefined;

/** Own presentation only. Native connection state, admission and recovery stay unchanged. */
export function RemoteConnectionFeedbackProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<symbol, Registration>>(() => new Map());
  const [owners, setOwners] = useState<ReadonlySet<symbol>>(() => new Set());
  const register = useCallback((key: symbol, value?: Registration) => {
    setEntries((previous) => {
      if (!value && !previous.has(key)) return previous;
      const next = new Map(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }, []);
  const registerOwner = useCallback((key: symbol, mounted: boolean) => {
    setOwners((previous) => {
      if (previous.has(key) === mounted) return previous;
      const next = new Set(previous);
      if (mounted) next.add(key);
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

/** A pane hands machine-wide failures to the mounted workspace owner, never operation errors. */
export function useRemoteConnectionFeedback(
  cwdOrEnvironmentId?: string,
  failure?: RemoteFailure,
): boolean {
  const feedback = useContext(FeedbackContext);
  const register = feedback?.register;
  const environmentId = environmentOf(cwdOrEnvironmentId);
  const key = useRef(Symbol("remote-connection-consumer")).current;
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
  return !!feedback?.owners.size && !!environmentId && (!failure || isConnectionFailure(failure));
}

/** Place once in the workspace shell; mounted consumers determine the relevant machines. */
export function RemoteConnectionNotices() {
  const feedback = useContext(FeedbackContext);
  const ownerKey = useRef(Symbol("remote-connection-notices")).current;
  const registerOwner = feedback?.registerOwner;
  useLayoutEffect(() => {
    if (!registerOwner) return;
    registerOwner(ownerKey, true);
    return () => registerOwner(ownerKey, false);
  }, [registerOwner, ownerKey]);
  // A provider without this mounted presentation owner must not hide pane errors.
  // If shell composition briefly mounts two outlets, only the first presents.
  if (feedback?.owners.values().next().value !== ownerKey) return null;
  const machines = new Map<string, RemoteFailure | undefined>();
  for (const { environmentId, failure } of feedback?.entries.values() ?? []) {
    const previous = machines.get(environmentId);
    if (
      !machines.has(environmentId) ||
      (failure &&
        (!previous || (previous.kind === "unreachable" && failure.kind !== "unreachable")))
    )
      machines.set(environmentId, failure ?? previous);
  }
  return [...machines].map(([environmentId, failure]) => (
    <MachineConnectionNotice key={environmentId} environmentId={environmentId} failure={failure} />
  ));
}

function MachineConnectionNotice({
  environmentId,
  failure,
}: {
  environmentId: string;
  failure?: RemoteFailure;
}) {
  const { status, error, reconnecting } = useRemoteConnection(environmentId);
  const autoReconnect = useSyncExternalStore(
    subscribeRemoteAutoReconnect,
    loadRemoteAutoReconnect,
    () => true,
  );
  const active = !!failure || (status !== "connected" && status !== "connecting");
  const statusFromFailure = failure ? connectionOutcome(failure.message).status : undefined;
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
  const [firstFailureAt, setFirstFailureAt] = useState<number | undefined>(() =>
    active ? Date.now() : undefined,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setFirstFailureAt((previous) => (active ? (previous ?? Date.now()) : undefined));
  }, [active]);
  useEffect(() => {
    if (!active || !transient || !autoReconnect || reconnecting || firstFailureAt === undefined)
      return;
    const remaining = firstFailureAt + TRANSIENT_NOTICE_DELAY_MS - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [active, transient, autoReconnect, reconnecting, firstFailureAt]);
  if (
    !active ||
    (transient &&
      autoReconnect &&
      !reconnecting &&
      (firstFailureAt === undefined || now < firstFailureAt + TRANSIENT_NOTICE_DELAY_MS))
  )
    return null;
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
  return (
    <div className="shrink-0 px-2 py-1" data-remote-connection-notice={environmentId}>
      <RemoteLoadError cwd={environmentId} failure={displayedFailure} compact coordinated={false} />
    </div>
  );
}
