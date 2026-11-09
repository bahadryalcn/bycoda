import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionModelsClient } from "../model/decisionModelsClient";
import type {
  DecisionCatalogEntry,
  DecisionRouting,
  DecisionSource,
  DecisionSourceInput,
  DiscoveryCandidate,
} from "../model/decisionTypes";
import { cleanRouting } from "../model/decisionView";

/**
 * Loads and changes decision-model state through the typed client. Each slice keeps its own error,
 * so one failing read does not hide the others. API keys are passed straight to the RPC and never stored.
 */
export function useDecisionModels(client: DecisionModelsClient) {
  const [sources, setSources] = useState<DecisionSource[] | null>(null);
  const [sourcesError, setSourcesError] = useState<unknown>(null);
  const [routing, setRouting] = useState<DecisionRouting>({});
  const [localOnly, setLocalOnly] = useState(false);
  const [routingError, setRoutingError] = useState<unknown>(null);
  const [found, setFound] = useState<DiscoveryCandidate[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<unknown>(null);
  const [catalog, setCatalog] = useState<DecisionCatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const [pending, setPending] = useState<Record<string, true>>({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const track = useCallback(async <T>(key: string, action: () => Promise<T>): Promise<T> => {
    setPending((current) => ({ ...current, [key]: true }));
    try {
      return await action();
    } finally {
      if (alive.current) {
        setPending((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    }
  }, []);

  const reloadSources = useCallback(async () => {
    try {
      const result = await client.sources.list({});
      if (alive.current) {
        setSources(result.sources);
        setSourcesError(null);
      }
    } catch (error: unknown) {
      if (alive.current) setSourcesError(error);
    }
  }, [client]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const result = await client.discovery.scan({});
      if (alive.current) setFound(result.found);
    } catch (error: unknown) {
      if (alive.current) setScanError(error);
    } finally {
      if (alive.current) setScanning(false);
    }
  }, [client]);

  useEffect(() => {
    void reloadSources().catch(() => undefined);
    void client.routing.get({}).then(
      (result) => {
        if (!alive.current) return;
        setRouting(result.routing);
        setLocalOnly(result.localOnlyPersonalData);
      },
      (error: unknown) => {
        if (alive.current) setRoutingError(error);
      },
    );
    void client.discovery.results({}).then(
      (result) => {
        if (!alive.current) return;
        setFound(result.found);
        // First open with nothing cached: look once, in the background.
        if (result.found.length === 0) void scan().catch(() => undefined);
      },
      (error: unknown) => {
        if (alive.current) setScanError(error);
      },
    );
    void client.catalog.get({}).then(
      (result) => {
        if (alive.current) setCatalog(result.entries);
      },
      (error: unknown) => {
        if (alive.current) setCatalogError(error);
      },
    );
  }, [client, reloadSources, scan]);

  const addSource = useCallback(
    async (source: DecisionSourceInput, apiKey?: string) => {
      const created = await track("add", () =>
        client.sources.add({ source, ...(apiKey ? { apiKey } : {}) }),
      );
      await reloadSources();
      return created;
    },
    [client, reloadSources, track],
  );

  const updateSource = useCallback(
    async (id: string, patch: Partial<DecisionSourceInput>, apiKey?: string) => {
      const updated = await track(`update:${id}`, () =>
        client.sources.update({ id, patch, ...(apiKey ? { apiKey } : {}) }),
      );
      await reloadSources();
      return updated;
    },
    [client, reloadSources, track],
  );

  const removeSource = useCallback(
    async (id: string) => {
      const result = await track(`remove:${id}`, () => client.sources.remove({ id }));
      await reloadSources();
      return result;
    },
    [client, reloadSources, track],
  );

  const testSource = useCallback(
    async (id: string) => {
      const result = await track(`test:${id}`, () => client.sources.test({ id }));
      await reloadSources();
      return result;
    },
    [client, reloadSources, track],
  );

  const evaluateSource = useCallback(
    async (id: string) => {
      const result = await track(`evaluate:${id}`, () => client.sources.evaluate({ id }));
      await reloadSources();
      return result;
    },
    [client, reloadSources, track],
  );

  const saveRouting = useCallback(
    async (next: DecisionRouting) => {
      const result = await track("routing", () =>
        client.routing.set({ routing: cleanRouting(next) }),
      );
      setRouting(result.routing);
      setLocalOnly(result.localOnlyPersonalData);
      return result;
    },
    [client, track],
  );

  const changeLocalOnly = useCallback(
    async (value: boolean) => {
      const result = await track("routing-local-only", () =>
        client.routing.set({ localOnlyPersonalData: value }),
      );
      setRouting(result.routing);
      setLocalOnly(result.localOnlyPersonalData);
      return result;
    },
    [client, track],
  );

  const localAction = useCallback(
    async (kind: "start" | "stop" | "uninstall", id: string) => {
      const call = () =>
        kind === "start"
          ? client.local.start({ id })
          : kind === "stop"
            ? client.local.stop({ id })
            : client.local.uninstall({ id });
      const result = await track(`local:${id}`, call);
      await reloadSources();
      return result;
    },
    [client, reloadSources, track],
  );

  const isPending = (key: string) => pending[key] === true;

  return {
    sources,
    sourcesError,
    routing,
    localOnly,
    routingError,
    found,
    scanning,
    scanError,
    catalog,
    catalogError,
    isPending,
    actions: {
      reloadSources,
      scan,
      addSource,
      updateSource,
      removeSource,
      testSource,
      evaluateSource,
      saveRouting,
      changeLocalOnly,
      localAction,
    },
  };
}

export type DecisionModelsState = ReturnType<typeof useDecisionModels>;
