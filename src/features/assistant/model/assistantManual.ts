import { useEffect, useRef, useState } from "react";
import { pathKey } from "../../../shared/lib/paths";
import type {
  ManualSessionCandidate,
  ManualSupervisionGrant,
  ManualSupervisionPolicy,
} from "../../../shared/model/assistantManual";
import type {
  AssistantRequest,
  AssistantResponse,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import { isProjectLocked } from "../../group-lock/model/groupLock";
import { assistantRequest } from "./assistantClient";

export type ManualProject = { id?: string; path: string; name: string };
export type ManualState = NonNullable<AssistantResponse["manual"]>;

/** Host project discovery is not permission to reveal another rail group's names. */
export function visibleAssistantProjects<T extends ManualProject>(
  projects: readonly T[],
  visiblePaths: readonly string[],
  locked: (path: string) => boolean = isProjectLocked,
): T[] {
  const allowed = new Set(visiblePaths.map(pathKey));
  return projects.filter((project) => allowed.has(pathKey(project.path)) && !locked(project.path));
}

/** Preserve policy outside this visible editor; selecting here never enrolls it. */
export function mergeManualProjectScope(
  previous: readonly string[],
  visible: readonly string[],
  selected: readonly string[],
): string[] {
  const editable = new Set(visible),
    selection = new Set(selected);
  return [
    ...new Set([
      ...previous.filter((id) => !editable.has(id)),
      ...visible.filter((id) => selection.has(id)),
    ]),
  ];
}

export function manualEnrollmentVersion(
  grants: readonly ManualSupervisionGrant[],
  sessionId: string,
): number {
  return grants.find((grant) => grant.sessionId === sessionId)?.version ?? 0;
}

const reason = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message === "The assistant already has 100 active manual supervision grants."
    ? "No more conversations can be enrolled. Revoke supervision before adding another."
    : message;
};

export function useManualSupervision(
  snapshot: AssistantSnapshot | null,
  projects: readonly ManualProject[],
  active: boolean,
  expectedEnvironmentId?: string,
) {
  const sourceEnvironmentId = expectedEnvironmentId ?? null;
  const [stored, setStored] = useState<{ environmentId: string | null; data: ManualState | null }>(
    () => ({
      environmentId: sourceEnvironmentId,
      data:
        sourceEnvironmentId && snapshot?.manualPolicy
          ? { policy: snapshot.manualPolicy, grants: snapshot.manualGrants ?? [], candidates: [] }
          : null,
    }),
  );
  const data = stored.environmentId === sourceEnvironmentId ? stored.data : null;
  const dataRef = useRef(data);
  dataRef.current = data;
  const [pending, setPending] = useState("");
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0),
    busy = useRef(false),
    offPending = useRef(false),
    mounted = useRef(true);
  const current = useRef({
    projects,
    chief:
      snapshot?.profile.autonomy === "chief" &&
      snapshot.profile.enabled &&
      snapshot.profile.setupComplete,
    environmentId: sourceEnvironmentId,
  });
  current.current = {
    projects,
    chief:
      snapshot?.profile.autonomy === "chief" &&
      snapshot.profile.enabled &&
      snapshot.profile.setupComplete,
    environmentId: sourceEnvironmentId,
  };
  function adopt(next: ManualState) {
    if (current.current.environmentId !== sourceEnvironmentId) return;
    if (dataRef.current && next.policy.version < dataRef.current.policy.version) return;
    dataRef.current = next;
    setStored({ environmentId: sourceEnvironmentId, data: next });
  }
  function sourceRequest(input: AssistantRequest) {
    if (!sourceEnvironmentId || current.current.environmentId !== sourceEnvironmentId)
      throw new Error("The assistant Host identity is unavailable. Refresh before retrying.");
    return assistantRequest(input, sourceEnvironmentId);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      busy.current = false;
      offPending.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    epoch.current++;
    busy.current = false;
    offPending.current = false;
    dataRef.current = null;
    setStored({ environmentId: sourceEnvironmentId, data: null });
    setPending("");
    setStopping(false);
    setError("");
  }, [sourceEnvironmentId]);
  useEffect(() => {
    if (!sourceEnvironmentId || !snapshot?.manualPolicy || offPending.current) return;
    const before = dataRef.current;
    if (!before || snapshot.manualPolicy.version > before.policy.version)
      adopt({
        policy: snapshot.manualPolicy,
        grants: snapshot.manualGrants ?? before?.grants ?? [],
        candidates: before?.candidates ?? [],
      });
  }, [sourceEnvironmentId, snapshot?.manualPolicy, snapshot?.manualGrants]);

  async function run(key: string, request: () => Promise<AssistantResponse>) {
    if (
      busy.current ||
      offPending.current ||
      !sourceEnvironmentId ||
      current.current.environmentId !== sourceEnvironmentId
    )
      return;
    const generation = ++epoch.current;
    busy.current = true;
    setPending(key);
    setError("");
    try {
      const response = await request();
      if (
        !mounted.current ||
        generation !== epoch.current ||
        current.current.environmentId !== sourceEnvironmentId
      )
        return;
      if (!response.manual)
        throw new Error("Manual supervision was not confirmed. Refresh before retrying.");
      adopt(response.manual);
      return true;
    } catch (cause) {
      if (mounted.current && generation === epoch.current) setError(reason(cause));
    } finally {
      if (mounted.current && generation === epoch.current) {
        busy.current = false;
        setPending("");
      }
    }
  }
  const refresh = () => run("list", () => sourceRequest({ op: "manual.list" }));
  useEffect(() => {
    if (active) void refresh();
  }, [active, sourceEnvironmentId]);

  function visible(projectId: string) {
    return current.current.projects.some(
      (project) => project.id === projectId && !isProjectLocked(project.path),
    );
  }
  function enroll(candidate: ManualSessionCandidate) {
    const state = dataRef.current;
    if (
      !state ||
      !current.current.chief ||
      !state.policy.enabled ||
      !state.policy.projectIds.includes(candidate.projectId) ||
      !visible(candidate.projectId) ||
      !candidate.eligible
    )
      return;
    return run(`enroll:${candidate.sessionId}`, () =>
      sourceRequest({
        op: "manual.enroll",
        sessionId: candidate.sessionId,
        sourceToken: candidate.sourceToken,
        expectedVersion: manualEnrollmentVersion(state.grants, candidate.sessionId),
      }),
    );
  }
  function revoke(grant: ManualSupervisionGrant) {
    if (!visible(grant.source.projectId)) return;
    return run(`revoke:${grant.id}`, () =>
      sourceRequest({ op: "manual.revoke", id: grant.id, expectedVersion: grant.version }),
    );
  }
  function save(
    enabled: boolean,
    selected: readonly string[],
    expectedVersion = dataRef.current?.policy.version,
  ) {
    const state = dataRef.current;
    if (!state || expectedVersion === undefined || !current.current.chief) return;
    const visibleIds = current.current.projects
      .filter((project) => project.id && !isProjectLocked(project.path))
      .map((project) => project.id!);
    return run("policy", () =>
      sourceRequest({
        op: "manual.policy",
        expectedVersion,
        enabled,
        projectIds: mergeManualProjectScope(state.policy.projectIds, visibleIds, selected),
      }),
    );
  }
  async function off() {
    const policy: ManualSupervisionPolicy | undefined =
      dataRef.current?.policy ?? snapshot?.manualPolicy;
    if (
      !policy ||
      offPending.current ||
      !sourceEnvironmentId ||
      current.current.environmentId !== sourceEnvironmentId
    )
      return;
    const generation = ++epoch.current;
    busy.current = false;
    offPending.current = true;
    setPending("");
    setStopping(true);
    setError("");
    try {
      const result = await sourceRequest({
        op: "manual.policy",
        expectedVersion: policy.version,
        enabled: false,
        projectIds: policy.projectIds,
      });
      if (
        !mounted.current ||
        generation !== epoch.current ||
        current.current.environmentId !== sourceEnvironmentId
      )
        return;
      if (!result.manual || result.manual.policy.enabled)
        throw new Error("Manual supervision could not be turned off. Refresh and retry.");
      adopt(result.manual);
    } catch (cause) {
      if (mounted.current && generation === epoch.current) setError(reason(cause));
    } finally {
      if (mounted.current && generation === epoch.current) {
        offPending.current = false;
        setStopping(false);
      }
    }
  }
  const sameSource = stored.environmentId === sourceEnvironmentId;
  return {
    data,
    pending: sameSource ? pending : "",
    stopping: sameSource && stopping,
    error: sameSource ? error : "",
    refresh,
    enroll,
    revoke,
    save,
    off,
    chief: current.current.chief,
  };
}
export type ManualSupervisionController = ReturnType<typeof useManualSupervision>;
