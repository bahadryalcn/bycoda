import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  hostBufferRecovery,
  hostBufferReportKey,
  hostBufferContextKey,
  type HostBufferCursor,
  type HostBufferDetails,
  type HostBufferPage,
  type HostBufferReport,
  type HostRecoveryContext,
} from "../../../features/files/data/hostBufferRecovery";

type Api = Pick<typeof hostBufferRecovery, "available" | "list" | "read">;
type Options = {
  enabled: boolean;
  /** Host metadata has no trustworthy visible-project mapping. Deny globally
   * while any possible origin is concealed. */
  canInspect(): boolean;
  /** A synchronous identity changed for every privacy transition, including ABA. */
  getPrivacySnapshot(): unknown;
  api?: Api;
  limit?: number;
};
type Policy = { visible: boolean; available: boolean; privacy: unknown; api: Api; limit: number };
type Route = { after: HostBufferCursor | null; expectedContext?: HostRecoveryContext };
type View = {
  policy: Policy;
  page: HostBufferPage | null;
  route: Route;
  previous: readonly Route[];
  loading: boolean;
  loaded: boolean;
  error: boolean;
  pending: string | null;
  readError: string | null;
  details: HostBufferDetails | null;
  detailsGeneration: number;
};
const policyFor = (options: Options): Policy => {
  const api = options.api ?? hostBufferRecovery;
  return {
    visible: options.enabled && options.canInspect(),
    available: !!api.available(),
    privacy: options.getPrivacySnapshot(),
    api,
    limit: options.limit ?? 25,
  };
};
const samePolicy = (a: Policy, b: Policy) =>
  a.visible === b.visible &&
  a.available === b.available &&
  a.privacy === b.privacy &&
  a.api === b.api &&
  a.limit === b.limit;
const empty = (policy: Policy): View => ({
  policy,
  page: null,
  route: { after: null },
  previous: [],
  loading: false,
  loaded: false,
  error: false,
  pending: null,
  readError: null,
  details: null,
  detailsGeneration: -1,
});
type Job = {
  generation: number;
  controller: AbortController;
  key?: string;
  promise: Promise<void>;
};

export function useHostBufferRecovery(options: Options) {
  const policy = policyFor(options);
  const latest = useRef(options);
  const mounted = useRef(false);
  const generation = useRef(0);
  const listing = useRef<Job | null>(null);
  const reading = useRef<Job | null>(null);
  const [view, setView] = useState(() => empty(policy));
  const retained = useRef(view);
  const publish = useCallback((scope: Policy, update: (old: View) => View) => {
    const before = samePolicy(retained.current.policy, scope) ? retained.current : empty(scope);
    const after = update(before);
    retained.current = after;
    setView(after);
  }, []);
  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      listing.current?.controller.abort();
      reading.current?.controller.abort();
    };
  }, []);
  useLayoutEffect(() => {
    generation.current++;
    listing.current?.controller.abort();
    reading.current?.controller.abort();
    // Aborting a waiter never owns/releases the actual Native request. Its
    // adapter admission stays charged through Native+validation settlement.
  }, [policy.visible, policy.available, policy.privacy, policy.api, policy.limit]);
  const allowed = useCallback(
    (scope: Policy) =>
      mounted.current &&
      scope.visible &&
      scope.available &&
      samePolicy(scope, policyFor(latest.current)),
    [],
  );
  const discardObsoleteView = useCallback(() => {
    if (!mounted.current) return;
    const current = policyFor(latest.current);
    if (!samePolicy(retained.current.policy, current)) publish(current, () => empty(current));
  }, [publish]);
  const load = useCallback(
    (route: Route, direction: "refresh" | "next" | "previous"): Promise<void> => {
      const scope = policyFor(latest.current);
      if (!allowed(scope)) return Promise.resolve();
      if (direction !== "refresh" && !samePolicy(retained.current.policy, scope))
        return Promise.resolve();
      if (listing.current) return listing.current.promise;
      const currentView = samePolicy(retained.current.policy, scope)
        ? retained.current
        : empty(scope);
      if (
        !Number.isSafeInteger(scope.limit) ||
        scope.limit < 1 ||
        scope.limit > 100 ||
        (direction === "next" && currentView.previous.length >= 32)
      ) {
        publish(scope, (old) => ({ ...old, error: true }));
        return Promise.resolve();
      }
      const current = ++generation.current;
      reading.current?.controller.abort();
      const controller = new AbortController();
      publish(scope, (old) => ({
        ...old,
        loading: true,
        error: false,
        pending: null,
        readError: null,
        details: null,
      }));
      const job: Job = { generation: current, controller, promise: Promise.resolve() };
      listing.current = job;
      job.promise = (async () => {
        try {
          const page = await scope.api.list(
            { ...route, limit: scope.limit },
            { signal: controller.signal },
          );
          if (!allowed(scope) || current !== generation.current) return;
          if (
            route.expectedContext &&
            hostBufferContextKey(route.expectedContext) !== hostBufferContextKey(page.context)
          )
            throw new Error("stale");
          publish(scope, (old) => ({
            ...old,
            page,
            route: { after: route.after, expectedContext: page.context },
            previous:
              direction === "refresh"
                ? []
                : direction === "next"
                  ? [...currentView.previous, currentView.route]
                  : currentView.previous.slice(0, -1),
            loaded: true,
            loading: false,
            error: false,
          }));
        } catch {
          if (allowed(scope) && current === generation.current)
            publish(scope, (old) => ({ ...old, error: true }));
        } finally {
          if (listing.current === job) listing.current = null;
          discardObsoleteView();
          if (allowed(scope) && current === generation.current)
            publish(scope, (old) => ({ ...old, loading: false }));
        }
      })();
      return job.promise;
    },
    [allowed, discardObsoleteView, publish],
  );
  const inspect = useCallback(
    (record: HostBufferReport): Promise<void> => {
      const scope = policyFor(latest.current);
      const currentView = retained.current;
      if (
        !allowed(scope) ||
        !samePolicy(currentView.policy, scope) ||
        listing.current ||
        !record.inspectable ||
        !currentView.page?.records.includes(record)
      )
        return Promise.resolve();
      const key = hostBufferReportKey(record);
      if (reading.current)
        return reading.current.key === key ? reading.current.promise : Promise.resolve();
      const current = ++generation.current;
      const controller = new AbortController();
      const job: Job = { generation: current, controller, key, promise: Promise.resolve() };
      reading.current = job;
      publish(scope, (old) => ({ ...old, details: null, pending: key, readError: null }));
      job.promise = (async () => {
        try {
          const result = await scope.api.read(record, { signal: controller.signal });
          if (!allowed(scope) || current !== generation.current) return;
          if (
            hostBufferReportKey(result.record) !== key ||
            hostBufferContextKey(result.record.context) !== hostBufferContextKey(record.context)
          )
            throw new Error("stale");
          // Presentation belongs to the original selected row, never a different
          // returned owner/label. Data adapter already validates exact raw proof.
          publish(scope, (old) => ({
            ...old,
            details: Object.freeze({ ...result, record }),
            detailsGeneration: current,
          }));
        } catch {
          if (allowed(scope) && current === generation.current)
            publish(scope, (old) => ({ ...old, readError: key }));
        } finally {
          if (reading.current === job) reading.current = null;
          discardObsoleteView();
          if (allowed(scope) && current === generation.current)
            publish(scope, (old) => ({ ...old, pending: null }));
        }
      })();
      return job.promise;
    },
    [allowed, discardObsoleteView, publish],
  );
  const shown = samePolicy(view.policy, policy) && policy.visible && policy.available;
  return {
    visible: policy.visible,
    available: policy.available,
    records: shown ? (view.page?.records ?? []) : [],
    details: shown ? view.details : null,
    pending: shown ? view.pending : null,
    readError: shown ? view.readError : null,
    error: shown && view.error,
    loading: shown && view.loading,
    loaded: shown && view.loaded,
    hasNext: shown && !!view.page?.next,
    hasPrevious: shown && view.previous.length > 0,
    incomplete: shown && !!view.page?.incomplete,
    unavailable: shown && !!view.page?.unavailable,
    duplicatesPossible: shown && !!view.page?.duplicatesPossible,
    refresh: () => load({ after: null }, "refresh"),
    next: () => {
      const current = retained.current;
      return current.page?.next
        ? load({ after: current.page.next, expectedContext: current.page.context }, "next")
        : Promise.resolve();
    },
    previous: () => {
      const history = retained.current.previous;
      return history.length ? load(history[history.length - 1]!, "previous") : Promise.resolve();
    },
    inspect,
    /** UI/privacy freshness only. This never claims a current Native actor,
     * report resolution, filesystem content or authority proof. */
    detailsAreCurrent: () => {
      const current = retained.current;
      return (
        shown &&
        !!view.details &&
        current.details === view.details &&
        allowed(view.policy) &&
        current.detailsGeneration === view.detailsGeneration &&
        view.detailsGeneration === generation.current
      );
    },
    closeDetails: () => {
      if (reading.current?.generation === generation.current || retained.current.details)
        generation.current++;
      reading.current?.controller.abort();
      const scope = policyFor(latest.current);
      if (mounted.current)
        publish(scope, (old) => ({ ...old, pending: null, details: null, readError: null }));
    },
  };
}
