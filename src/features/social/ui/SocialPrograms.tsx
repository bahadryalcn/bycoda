import { useContext, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import { t } from "../../../shared/i18n";
import { socialQueryScope } from "../model/socialQuery";
import type { ProgramDetail, SocialProgram } from "../model/socialProgram";
import { ProgramDetailPanel, ProgramDetailPending } from "./ProgramDetailPanel";
import { ProgramList } from "./ProgramList";
import { ProgramSetupForm, type ProgramEditRequest } from "./ProgramSetupForm";
import { SocialPanelActiveContext } from "./socialContext";
import { Notice, type Props } from "./socialShared";
import "./social-programs.css";

export function SocialPrograms({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  collectionManaged = false,
  selectionIntent,
  onSelectionChange,
}: Props & {
  collectionManaged?: boolean;
  selectionIntent?: { id: string; token: number };
  onSelectionChange?: (id: string) => void;
}) {
  const active = useContext(SocialPanelActiveContext);
  const [error, setError] = useState("");
  const [bulkLink, setBulkLink] = useState("");
  const [editRequest, setEditRequest] = useState<ProgramEditRequest>();
  const queryClient = useQueryClient();
  const visible = useQueryVisible();
  const scope = socialQueryScope(client);
  const projectId = snapshot.programProjectId;
  // The owner's explicit choice; without one the first listed program is shown.
  const [selection, setSelection] = useState<string>();
  const [confirmedKey, setConfirmedKey] = useState<string>();
  const [seenIntent, setSeenIntent] = useState<number>();
  // A selection intent is a one-shot request identified by its token.
  if (selectionIntent && selectionIntent.token !== seenIntent) {
    setSeenIntent(selectionIntent.token);
    setSelection(selectionIntent.id);
    setConfirmedKey(undefined);
  }
  const listKey = [...scope, "programs", projectId ?? ""];
  const enabled = !!snapshot.programsSupported && active && visible;
  const listQuery = useQuery({
    queryKey: listKey,
    queryFn: () => client.request<SocialProgram[]>("programs.list", projectId ? { projectId } : {}),
    enabled,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const programs = listQuery.data ?? [];
  const selectedProgram = selection ?? programs[0]?.id;
  const detailKey = [...scope, "program", selectedProgram ?? ""];
  const detailQuery = useQuery({
    queryKey: detailKey,
    queryFn: () => client.request<ProgramDetail>("programs.status", { id: selectedProgram }),
    enabled: enabled && !!selectedProgram,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
  const detail = detailQuery.data;
  // A chosen program from another project filter falls back to the first listed program.
  if (selection && detail && projectId && detail.program.projectId !== projectId)
    setSelection(undefined);
  // The review confirmation belongs to one exact program revision and state.
  const detailIdentity = detail
    ? JSON.stringify([
        detail.program.id,
        detail.program.revision,
        detail.program.enabled,
        detail.program.reason,
      ])
    : undefined;
  if (confirmedKey !== undefined && confirmedKey !== detailIdentity) setConfirmedKey(undefined);
  const confirmed = detailIdentity !== undefined && confirmedKey === detailIdentity;
  function setDetail(
    value: ProgramDetail | undefined | ((previous: ProgramDetail | undefined) => ProgramDetail),
  ) {
    const next = typeof value === "function" ? value(detail) : value;
    setSelection(next?.program.id);
    if (next?.program.id) onSelectionChange?.(next.program.id);
    if (next) queryClient.setQueryData([...scope, "program", next.program.id], next);
  }
  const setPrograms = (list: SocialProgram[]) => queryClient.setQueryData(listKey, list);
  // List refresh errors stay with the page; a failed read of the selected record is
  // owned by the detail region below (with its own retry), not by setup/mutation errors.
  const refreshError = listQuery.error;
  const detailError = detailQuery.isError ? detailQuery.error : null;
  const selectedSummary = selectedProgram
    ? programs.find((program) => program.id === selectedProgram)
    : undefined;
  const perform = async (action: string, input: Record<string, unknown>) => {
    return run(async () => {
      const result = await client.request<ProgramDetail | SocialProgram>(action, input);
      if (result && "program" in result) setDetail(result);
      else if (result && "id" in result) {
        const fresh = await client.request<ProgramDetail>("programs.status", { id: result.id });
        setDetail(fresh);
      }
      const list = await client.request<SocialProgram[]>(
        "programs.list",
        snapshot.programProjectId ? { projectId: snapshot.programProjectId } : {},
      );
      setPrograms(list);
    });
  };
  if (!snapshot.programsSupported) return null;
  return (
    <section className="social-programs" aria-label={t("AI campaign programs")}>
      {error || refreshError ? <Notice kind="error">{error || String(refreshError)}</Notice> : null}
      <ProgramSetupForm
        {...{ client, snapshot, projects, initialProject, run, perform, editRequest }}
        hasPrograms={programs.length > 0}
        onError={setError}
      />
      <div
        className={!collectionManaged && programs.length ? "social-program-workspace" : undefined}
      >
        {!collectionManaged ? (
          <ProgramList
            programs={programs}
            activeId={detail?.program.id}
            client={client}
            run={run}
            onOpen={(opened) => {
              setDetail(opened);
              setConfirmedKey(undefined);
            }}
          />
        ) : null}
        {!detail && selectedProgram ? (
          <ProgramDetailPending
            hideHeading={collectionManaged}
            summary={selectedSummary}
            error={detailError}
            refreshing={detailQuery.isFetching}
            onRetry={() => void detailQuery.refetch()}
          />
        ) : null}
        {detail ? (
          <ProgramDetailPanel
            hideHeading={collectionManaged}
            detail={detail}
            error={detailError}
            refreshing={detailQuery.isFetching}
            onRetry={() => void detailQuery.refetch()}
            snapshot={snapshot}
            client={client}
            run={run}
            perform={perform}
            confirmed={confirmed}
            onConfirmedChange={(checked) => setConfirmedKey(checked ? detailIdentity : undefined)}
            bulkLink={bulkLink}
            onBulkLinkChange={setBulkLink}
            onEdit={(program) =>
              setEditRequest((current) => ({ program, version: (current?.version ?? 0) + 1 }))
            }
            onDetailChange={setDetail}
          />
        ) : null}
      </div>
    </section>
  );
}
