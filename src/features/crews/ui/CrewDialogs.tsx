import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { Surface } from "../../../shared/ui/Surface";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Alert } from "../../../shared/ui/Alert";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { MessageSquare, Pencil, Play, Trash2 } from "../../../shared/ui/icons";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { AccessPicker } from "../../sessions/public/AccessPicker";
import type { RuntimeMode } from "../../sessions/public/session";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import type { CrewDefinition, CrewRun } from "../model/crew";
import type { useProjectCrews } from "../model/crewClient";
import { saveCrewAppearance } from "../model/crewAppearance";
import { roleLabel } from "./CrewMemberForm";
import { useCrewMachineScope } from "./CrewMachineScope";
import { teamTraits } from "../model/memberAvatars";
import { CrewRoleIcon } from "./CrewRoleIcon";
import { MemberAvatar } from "./MemberAvatar";

export { CrewEditDialog } from "./CrewEditor";

// The delivery being written survives editing the crew and reopening this dialog.
type StartAttempt = { signature: string; id: string; run?: CrewRun };
const startDrafts = new Map<
  string,
  { definitionId: string; prompt: string; attempt?: StartAttempt }
>();

export function StartCrewDialog({
  cwd: homeCwd,
  state: homeState,
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
  // New work can go to another project, or a new one, on any machine that runs crews.
  const scope = useCrewMachineScope(homeCwd, homeState);
  const { cwd, state } = scope;
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
  // The last attempt ended without a receipt; retrying reuses its request ID.
  const [sameRequestRetry, setSameRequestRetry] = useState(false);
  const setDefinitionId = (value: string) => {
    setDefinitionIdState(value);
    setAccessChoice(undefined);
    setStartedRun(undefined);
    setSameRequestRetry(false);
    remember({ definitionId: value });
  };
  const setPrompt = (value: string) => {
    setPromptState(value);
    setStartedRun(undefined);
    setSameRequestRetry(false);
    remember({ prompt: value });
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingGate = useRef(false);
  const startRequest = useRef<StartAttempt | null>(stored?.attempt ?? null);
  const crew = data?.definitions.find((d) => d.id === definitionId);
  // Access applies to every member; it is saved to the crew only when the owner changed it.
  const [accessChoice, setAccessChoice] = useState<RuntimeMode>();
  const savedAccess = crew?.policy.runtimeMode ?? "supervised";
  const access = accessChoice ?? savedAccess;
  const start = async () => {
    if (pendingGate.current || (!startedRun && (!crew || !prompt.trim()))) return;
    pendingGate.current = true;
    setPending(true);
    setError("");
    let dispatched = false;
    try {
      const signature = JSON.stringify([definitionId, prompt]);
      if (startRequest.current?.signature !== signature) {
        // A first attempt: an earlier attempt already saved the access it started with.
        if (crew && data?.accessSupported && access !== savedAccess)
          await state.call("crews.save", {
            definition: { ...crew, policy: { ...crew.policy, runtimeMode: access } },
            expectedUpdatedAt: crew.updatedAt,
          });
        startRequest.current = { signature, id: crypto.randomUUID() };
      }
      // Retain the receipt identity before dispatch, including when the owner
      // closes and reopens after an uncertain transport result.
      remember({});
      const existingRun = startRequest.current.run;
      dispatched = !existingRun;
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
      setSameRequestRetry(dispatched && !startRequest.current?.run);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingGate.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      title={t("New work")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
      footer={
        <>
          <span className="min-w-0 flex-1" />
          {onEdit && crew && !startedRun ? (
            <Button
              variant="ghost"
              startIcon={<Pencil className="icon-sm" />}
              onClick={() => onEdit(definitionId)}
              disabled={pending}
            >
              {t("Edit crew")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            startIcon={
              startedRun?.coordinatorSessionId && onOpen ? (
                <MessageSquare className="icon-sm" />
              ) : (
                <Play className="icon-sm" />
              )
            }
            disabled={pending || (!startedRun && (!crew || !prompt.trim()))}
            loading={pending}
            onClick={() => void start()}
          >
            {startedRun?.coordinatorSessionId && onOpen ? t("Open conversation") : t("Start")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {scope.picker(pending || !!startedRun)}
          {scope.projectPicker(pending || !!startedRun, true)}
        </div>
        {definitionId && !crew && !startedRun ? (
          <Alert tone="warning">
            {cwd !== homeCwd && data
              ? t("This crew is not available in this project. Choose another crew.")
              : t("This crew is no longer available.")}
          </Alert>
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
        {crew && data?.accessSupported ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Text tone="primary" weight="medium">
              {t("Access for every member")}
            </Text>
            <Surface variant="outline" padding="none" className="min-w-0">
              <AccessPicker
                value={access}
                onChange={(mode) => {
                  // After a dispatched attempt the access is fixed, so a retry cannot save again.
                  if (!pending && !sameRequestRetry && !startedRun) setAccessChoice(mode);
                }}
              />
            </Surface>
          </div>
        ) : null}
        <TextareaField
          label={t("What should the crew deliver?")}
          placeholder={t("e.g. Build the mobile sign-in screen with tests.")}
          value={prompt}
          rows={5}
          autoFocus
          disabled={pending}
          onChange={(e) => setPrompt(e.target.value)}
        />
        {error ? (
          // Beside the footer action that failed. A receipt or request ID is kept, so retrying is safe.
          <Alert tone="danger">
            <p className="break-words [overflow-wrap:anywhere]">{error}</p>
            {startedRun?.coordinatorSessionId ? (
              <Text as="p" tone="inherit" className="mt-1">
                {t("The work was started. Retry opens its conversation.")}
              </Text>
            ) : sameRequestRetry ? (
              <Text as="p" tone="inherit" className="mt-1">
                {t("Retry sends the same request, so the work is not started twice.")}
              </Text>
            ) : null}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

/** Chips shown per role before the "+N" trigger. */
const ROSTER_CHIP_LIMIT = 6;

/** Members grouped by responsibility; a member named like its responsibility is not repeated. */
function CrewRosterSummary({ crew }: { crew: CrewDefinition }) {
  const looks = teamTraits(crew.agents);
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
    const names = members.map((agent) => ({
      id: agent.id,
      name: agent.name.trim() || roleLabel(role),
      traits: looks.get(agent.id)!,
    }));
    return [{ role, label, names }];
  });
  return (
    <DescriptionList size="sm">
      {groups.map((group) => (
        <DescriptionItem
          key={group.role}
          term={
            <span className="flex items-center gap-1">
              <CrewRoleIcon role={group.role} />
              {group.label}
              {group.names.length ? ":" : ""}
            </span>
          }
        >
          {group.names.length ? (
            // A fixed cap, not measured packing: chips wrap onto as many lines as they need and
            // the "+N" trigger always shows, instead of measuring widths in a narrow dialog.
            <BadgeList
              label={group.label}
              size="xs"
              max={ROSTER_CHIP_LIMIT}
              className="min-w-0 [--badge-list-item-max:16rem]"
              items={group.names.map((member) => ({
                id: member.id,
                label: member.name,
                icon: <MemberAvatar traits={member.traits} size={16} />,
              }))}
            />
          ) : null}
        </DescriptionItem>
      ))}
    </DescriptionList>
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
            startIcon={<Trash2 className="icon-sm" />}
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
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {activeWork > 0 ? (
          <Alert tone="warning">{t("Stop this crew's running work before deleting it.")}</Alert>
        ) : (
          <Text as="p" size="body" tone="inherit">
            {t("The crew definition is removed. Library members are kept.")}
          </Text>
        )}
      </div>
    </Modal>
  );
}
