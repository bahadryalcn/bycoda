import { useEffect, useRef } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { t } from "../../../shared/i18n";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";
import type { SocialSnapshot, SocialWorkspaceQuery } from "../model/social";
import type { SocialProgram } from "../model/socialProgram";
import type { AttentionSources, AttentionSourceState } from "../model/socialAttention";

const UNSUPPORTED_WORKSPACE_READ = "Unsupported social operation";

async function readSection(
  client: SocialClient,
  section: NonNullable<SocialWorkspaceQuery["section"]>,
  projectId: string,
): Promise<SocialSnapshot> {
  try {
    const response = await client.sectionSnapshot({
      section,
      limit: 50,
      ...(projectId ? { projectId } : {}),
    });
    if (!response.snapshot) throw new Error(t("The Social Media refresh response is incomplete."));
    return response.snapshot;
  } catch (cause) {
    // A Host without section-scoped reads serves one full snapshot.
    if (String(cause).includes(UNSUPPORTED_WORKSPACE_READ)) return client.snapshot();
    throw cause;
  }
}

function state<T>(query: UseQueryResult<T>): AttentionSourceState<T> {
  if (query.data !== undefined) return { status: "ready", data: query.data };
  if (query.isError)
    return {
      status: "error",
      message: query.error instanceof Error ? query.error.message : String(query.error),
    };
  return { status: "loading" };
}

function useSection(
  client: SocialClient,
  name: NonNullable<SocialWorkspaceQuery["section"]>,
  projectId: string,
  live: boolean,
) {
  return useQuery({
    queryKey: [...socialQueryScope(client), "today", name, projectId],
    queryFn: () => readSection(client, name, projectId),
    enabled: live,
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
}

/**
 * Reads the few Host collections the Today view summarizes. Reads are independent, so one
 * failing source does not hide the others, and nothing is polled while the panel is inactive.
 */
export function useSocialToday({
  client,
  projectId,
  active,
  programsSupported,
  revision,
}: {
  client: SocialClient;
  projectId: string;
  active: boolean;
  programsSupported: boolean;
  /** Changes when the Host reports a new workspace revision (for example after a mutation). */
  revision: unknown;
}) {
  const queryClient = useQueryClient();
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    void queryClient.invalidateQueries({ queryKey: [...socialQueryScope(client), "today"] });
  }, [revision, client, queryClient]);
  const visible = useQueryVisible();
  const scope = socialQueryScope(client);
  const live = active && visible;
  const campaigns = useSection(client, "campaigns", projectId, live);
  const inbox = useSection(client, "inbox", projectId, live);
  const plans = useSection(client, "plans", projectId, live);
  const history = useSection(client, "history", projectId, live);
  const programs = useQuery({
    queryKey: [...scope, "today", "programs", projectId],
    queryFn: () => client.request<SocialProgram[]>("programs.list", projectId ? { projectId } : {}),
    enabled: live && programsSupported,
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
  const sources: AttentionSources = {
    campaigns: state(campaigns),
    inbox: state(inbox),
    plans: state(plans),
    history: state(history),
    programs: programsSupported ? state(programs) : { status: "unsupported" },
  };
  const all = [campaigns, inbox, plans, history, ...(programsSupported ? [programs] : [])];
  return {
    sources,
    fetching: all.some((query) => query.isFetching),
    refetch: () => Promise.all(all.map((query) => query.refetch())),
    /** Profiles of the campaigns read, used to give the assistant the saved voice and facts. */
    profiles: campaigns.data?.profiles ?? [],
  };
}
