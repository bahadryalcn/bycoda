import { useQuery } from "@tanstack/react-query";
import type { SocialClient } from "../../model/socialClient";
import { socialQueryScope } from "../../model/socialQuery";
import type { SocialSnapshot } from "../../model/social";
import type { SocialProgram } from "../../model/socialProgram";

/**
 * Campaigns, jobs and accounts for the content screen, plus the project's repeating programs.
 * Polling stops while the screen is hidden (`active` false).
 */
export function useContentData(
  client: SocialClient,
  projectId: string | undefined,
  active: boolean,
) {
  const scope = [...socialQueryScope(client), "content"] as const;
  const snapshot = useQuery({
    queryKey: [...scope, "snapshot", projectId ?? ""],
    queryFn: async (): Promise<SocialSnapshot | undefined> =>
      (await client.sectionSnapshot({ section: "campaigns", projectId, limit: 100 })).snapshot,
    enabled: active,
    staleTime: 10_000,
    refetchInterval: active ? 30_000 : false,
  });
  const programs = useQuery({
    queryKey: [...scope, "programs", projectId ?? ""],
    queryFn: () => client.request<SocialProgram[]>("programs.list", projectId ? { projectId } : {}),
    enabled: active,
    staleTime: 10_000,
    refetchInterval: active ? 30_000 : false,
  });
  return {
    snapshot: snapshot.data,
    programs: programs.data ?? [],
    loading: snapshot.isPending,
    error: snapshot.error ?? programs.error ?? undefined,
    refetch: () => {
      // Refetch failures are reported through `error` above, never as a rejection here.
      void snapshot.refetch().catch(() => undefined);
      void programs.refetch().catch(() => undefined);
    },
  };
}
