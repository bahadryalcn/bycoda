import { useSyncExternalStore } from "react";
import type { Session } from "../../sessions";
import {
  hostSessionBindingRevision,
  hostSessionBindingSnapshot,
  subscribeHostSessionBindings,
  type HostSessionBinding,
} from "./sessionExecutionBinding";

/**
 * Reactive `hostSessionBinding`: re-renders the caller when a stored owner is published,
 * hydrated, reloaded or changed by another window. Throws exactly where the plain read throws;
 * no session reads as no binding.
 */
export function useHostSessionBinding(
  session: Pick<Session, "id" | "hostBinding"> | undefined,
): HostSessionBinding | undefined {
  const read = () => (session ? hostSessionBindingSnapshot(session) : undefined);
  return useSyncExternalStore(subscribeHostSessionBindings, read, read);
}

type HostSessionBindingReader = (
  session: Pick<Session, "id" | "hostBinding">,
) => HostSessionBinding | undefined;
let bindingReader: { revision: number; read: HostSessionBindingReader } | undefined;

function bindingReaderFor(revision: number): HostSessionBindingReader {
  if (bindingReader?.revision !== revision)
    bindingReader = { revision, read: (session) => hostSessionBindingSnapshot(session) };
  return bindingReader.read;
}

/**
 * For a caller that reads the binding of several sessions in one render: the returned
 * reader behaves like `hostSessionBinding` and changes identity whenever a stored owner
 * changes, so the caller re-renders and anything derived from it is recomputed.
 */
export function useHostSessionBindingReader(): HostSessionBindingReader {
  const revision = useSyncExternalStore(
    subscribeHostSessionBindings,
    hostSessionBindingRevision,
    hostSessionBindingRevision,
  );
  return bindingReaderFor(revision);
}
