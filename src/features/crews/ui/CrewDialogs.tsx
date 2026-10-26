import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import type { CrewDefinition, CrewRun } from "../model/crew";
import type { useProjectCrews } from "../model/crewClient";
import { saveCrewAppearance } from "../model/crewAppearance";
import { roleLabel } from "./CrewMemberForm";

export { CrewEditDialog } from "./CrewEditor";

// The delivery being written survives editing the crew and reopening this dialog.
type StartAttempt = { signature: string; id: string; run?: CrewRun };
const startDrafts = new Map<
  string,
  { definitionId: string; prompt: string; attempt?: StartAttempt }
>();

export function StartCrewDialog({
  cwd,
  state,
  definitionId: initialDefinition,
  onOpen,
  onEdit,
  onClose,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  definitionId?: string;
  onOpen?: (target: BackgroundSessionTarget) => void | Promise<void>;
  /** Opens the editor for the chosen crew; the written delivery is kept. */
  onEdit?: (definitionId: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const data = state.data;
  const draftKey = data ? JSON.stringify([data.machine.id, data.project.id]) : cwd;
  const stored = startDrafts.get(draftKey);
  const [definitionId, setDefinitionIdState] = useState(
    initialDefinition ?? stored?.definitionId ?? data?.definitions[0]?.id ?? "",
  );
  const [prompt, setPromptState] = useState(stored?.prompt ?? "");
  const [startedRun, setStartedRun] = useState<CrewRun | undefined>(() =>
    stored?.attempt?.signature === JSON.stringify([definitionId, stored?.prompt ?? ""])
      ? stored.attempt.run
      : undefined,
  );
  const remember = (next: { definitionId?: string; prompt?: string }) =>
    startDrafts.set(draftKey, {
      definitionId,
      prompt,
      attempt: startRequest.current ?? undefined,
      ...next,
    });
  const setDefinitionId = (value: string) => {
    setDefinitionIdState(value);
    setStartedRun(undefined);
    remember({ definitionId: value });
  };
  const setPrompt = (value: string) => {
    setPromptState(value);
    setStartedRun(undefined);
    remember({ prompt: value });
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingGate = useRef(false);
  const startRequest = useRef<StartAttempt | null>(stored?.attempt ?? null);
  const crew = data?.definitions.find((d) => d.id === definitionId);
  const start = async () => {
    if (pendingGate.current || (!startedRun && (!crew || !prompt.trim()))) return;
    pendingGate.current = true;
    setPending(true);
    setError("");
    try {
      const signature = JSON.stringify([definitionId, prompt]);
      if (startRequest.current?.signature !== signature)
        startRequest.current = { signature, id: crypto.randomUUID() };
      // Retain the receipt identity before dispatch, including when the owner
      // closes and reopens after an uncertain transport result.
      remember({});
      const existingRun = startRequest.current.run;
      const run =
        existingRun ??
        (await state.call<CrewRun>("crews.start", {
          definitionId,
          prompt,
          requestId: startRequest.current.id,
        }));
      startRequest.current.run = run;
      setStartedRun(run);
      remember({});
      if (run.error && !existingRun) throw new Error(run.error);
      if (run.coordinatorSessionId && onOpen && data)
        await onOpen({
          cwd,
          machineId: data.machine.id,
          projectId: data.project.id,
          sessionId: run.coordinatorSessionId,
        });
      else if (run.error) throw new Error(run.error);
      startDrafts.delete(draftKey);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingGate.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      title={t("Start crew work")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      footer={
        <>
          <span className="min-w-0 flex-1" />
          {onEdit && crew && !startedRun ? (
            <Button variant="ghost" onClick={() => onEdit(definitionId)} disabled={pending}>
              {t("Edit crew")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={pending || (!startedRun && (!crew || !prompt.trim()))}
            loading={pending}
            onClick={() => void start()}
          >
            {startedRun?.coordinatorSessionId && onOpen ? t("Open conversation") : t("Start work")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4 pt-2">
        {error && <Alert tone="danger">{error}</Alert>}
        {definitionId && !crew && !startedRun ? (
          <Alert tone="warning">{t("This crew is no longer available.")}</Alert>
        ) : null}
        <SearchableSelect
          label={t("Crew")}
          value={definitionId}
          options={
            data?.definitions.map((d) => ({
              value: d.id,
              label: d.name,
              description: d.projectId ? t("This project") : t("All projects on this host"),
            })) ?? []
          }
          onChange={setDefinitionId}
          disabled={pending}
        />
        {crew ? <CrewRosterSummary crew={crew} /> : null}
        <TextareaField
          label={t("What should the crew deliver?")}
          placeholder={t("e.g. Build the mobile sign-in screen with tests.")}
          value={prompt}
          rows={5}
          autoFocus
          disabled={pending}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className="text-ui-caption text-(--ui-text-secondary)">
          {t("The first line becomes the work title. The coordinator plans and assigns the rest.")}
        </p>
      </div>
    </Modal>
  );
}

/** Members grouped by responsibility; a member named like its responsibility is not repeated. */
function CrewRosterSummary({ crew }: { crew: CrewDefinition }) {
  const groups = (["coordinator", "specialist", "reviewer", "advisor"] as const).flatMap((role) => {
    const members = crew.agents.filter((agent) => agent.role === role);
    if (!members.length) return [];
    const label =
      role === "specialist"
        ? members.length > 1
          ? t("Specialists")
          : roleLabel(role)
        : role === "advisor" && members.length > 1
          ? t("Advisors")
          : roleLabel(role);
    const names = members
      .map((agent) => agent.name)
      .filter((name) => name.trim().toLocaleLowerCase() !== roleLabel(role).toLocaleLowerCase());
    return [{ role, label, names }];
  });
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-ui-caption">
      {groups.map((group) => (
        <div key={group.role} className="flex min-w-0 gap-1">
          <dt className="text-(--ui-text-secondary)">
            {group.label}
            {group.names.length ? ":" : ""}
          </dt>
          {group.names.length ? (
            <dd className="min-w-0 break-words font-medium text-content [overflow-wrap:anywhere]">
              {group.names.join(", ")}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

/** Deletes a saved crew after an explicit confirmation; finished work history stays. */
export function CrewDeleteDialog({
  state,
  crew,
  activeWork,
  onClose,
}: {
  state: ReturnType<typeof useProjectCrews>;
  crew: CrewDefinition;
  activeWork: number;
  onClose: () => void;
}) {
  useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={t("Delete {p0}?", { p0: crew.name })}
      size="sm"
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <span className="min-w-0 flex-1" />
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="danger"
            loading={pending}
            disabled={pending || activeWork > 0}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                await state.call("crews.delete", {
                  definitionId: crew.id,
                  expectedUpdatedAt: crew.updatedAt,
                });
                saveCrewAppearance(crew.id, {
                  icon: undefined,
                  color: undefined,
                });
                onClose();
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : String(reason));
              } finally {
                setPending(false);
              }
            }}
          >
            {t("Delete crew")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4 pt-2">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {activeWork > 0 ? (
          <Alert tone="warning">{t("Stop this crew's running work before deleting it.")}</Alert>
        ) : (
          <p className="text-ui-body">
            {t("The crew definition is removed. Library members are kept.")}
          </p>
        )}
      </div>
    </Modal>
  );
}
