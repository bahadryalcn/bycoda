import { errorText } from "../../../shared/lib/errors";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { modelDisplayName } from "../../sessions/public/modelDisplayName";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Spinner } from "../../../shared/ui/Spinner";
import { Surface } from "../../../shared/ui/Surface";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { t, useLocale } from "../../../shared/i18n";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { HARNESS_TITLE, type Block } from "../../sessions/model/session";
import type { OrchestrationChoice, ProposedTask } from "../model/orchestrationPlan";
import { orchestrator } from "../model/orchestration";
import { resizeComposer } from "../../sessions/model/composerResize";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  findModel,
  mergeModelSettings,
  modelEffortLabel,
  modelEffortSetting,
} from "../../sessions/model/models";
import { OrchestrationActions } from "./OrchestrationActions";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { MessageMultiple, Play } from "../../../shared/ui/icons";

function AssignmentModel({
  task,
  choices,
  onChange,
}: {
  task: ProposedTask;
  choices: OrchestrationChoice[];
  onChange(choice: OrchestrationChoice, modelSettings: Record<string, string>): void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const selected = choices.find(
    (choice) => choice.harness === task.harness && choice.model === task.model,
  );
  const matches = choices.filter((choice) =>
    `${choice.name} ${choice.model} ${HARNESS_TITLE[choice.harness]}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const effortForChoice = (choice: OrchestrationChoice) => {
    const model = findModel(choice.model);
    return model?.harness === choice.harness ? modelEffortSetting(model) : undefined;
  };
  const selectedModel = selected ? findModel(selected.model) : undefined;
  const selectedEffortLabel =
    selectedModel && selectedModel.harness === selected?.harness
      ? modelEffortLabel(selectedModel, task.modelSettings)
      : undefined;
  const settingsFor = (choice: OrchestrationChoice, effortValue?: string) => {
    const model = findModel(choice.model);
    if (!model || model.harness !== choice.harness) return {};
    const setting = modelEffortSetting(model);
    return mergeModelSettings(model, {
      ...(choice === selected ? task.modelSettings : undefined),
      ...(setting && effortValue ? { [setting.id]: effortValue } : {}),
    });
  };
  // A row id joins harness and model with a NUL; an effort option appends its value.
  const choiceId = (choice: OrchestrationChoice) => `${choice.harness}\u0000${choice.model}`;
  const items: DropdownMenuItem[] = matches.length
    ? matches.map((choice) => {
        const effort = effortForChoice(choice);
        const current = effort
          ? choice === selected
            ? (task.modelSettings?.[effort.id] ?? effort.value)
            : effort.value
          : undefined;
        return {
          kind: "item" as const,
          id: choiceId(choice),
          label: choice.name,
          description: HARNESS_TITLE[choice.harness],
          icon: <HarnessIcon harness={choice.harness} className="icon-md shrink-0" />,
          checked: choice === selected,
          selectionRole: "radio" as const,
          submenuLabel: t("{p0} effort", { p0: choice.name }),
          submenuWidth: 200,
          submenu: effort?.options.length
            ? effort.options.map((option) => ({
                kind: "item" as const,
                id: `${choiceId(choice)}\u0000${option.value}`,
                label: option.label,
                checked: option.value === current,
                selectionRole: "radio" as const,
              }))
            : undefined,
        };
      })
    : [
        {
          kind: "content",
          id: "empty",
          node: (
            <EmptyState
              size="inline"
              kind="filtered"
              inset="row"
              description={t("No matching models")}
            />
          ),
        },
      ];
  const pick = (id: string) => {
    const [harness, model, effortValue] = id.split("\u0000");
    const choice = choices.find((item) => item.harness === harness && item.model === model);
    if (choice) onChange(choice, settingsFor(choice, effortValue));
  };
  return (
    <div className="relative min-w-0">
      <Button
        variant="item"
        type="button"
        ref={anchor}
        aria-label={t("Model for {p0}", { p0: task.title })}
        selected={open}
        expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
        className="max-w-full"
      >
        <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
        <Text size="inherit" tone="inherit" truncate>
          {selected?.name ?? modelDisplayName(task.model, task.harness)}
          {selectedEffortLabel ? ` · ${selectedEffortLabel}` : ""} · {HARNESS_TITLE[task.harness]}
        </Text>
      </Button>
      {open && (
        <DropdownMenu
          anchor={anchor}
          label={t("Assignment models")}
          side="bottom"
          align="start"
          size="md"
          maxHeight={320}
          items={items}
          initialActiveId={selected ? choiceId(selected) : undefined}
          returnFocusRef={anchor}
          search={{
            value: query,
            onChange: setQuery,
            label: t("Search assignment models"),
            placeholder: t("Search models or harnesses…"),
          }}
          onPick={pick}
          onClose={() => setOpen(false)}
          data-model-picker
        />
      )}
    </div>
  );
}

function WorkerHelp() {
  useLocale();
  return (
    <InfoTooltip label={t("What parallel workers means")} className="shrink-0">
      {t(
        "Tasks wait for available workers and for their dependencies to finish. A lower number runs fewer agent sessions at the same time.",
      )}
    </InfoTooltip>
  );
}

function InstructionsField({ value, onChange }: { value: string; onChange(value: string): void }) {
  useLocale();
  const ref = useRef<HTMLTextAreaElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLTextAreaElement>();
  // The same growth the composer uses: fit the text, stop at `max-h-40` and
  // scroll from there. The value is controlled, so one layout effect covers
  // typing and edits that arrive from the lead alike.
  useLayoutEffect(() => {
    if (ref.current) resizeComposer(ref.current);
  }, [value]);
  return (
    <TextareaField
      label={t("Instructions")}
      ref={(el) => {
        ref.current = el;
        lockOverscroll(el);
      }}
      fieldClassName="w-full"
      resize="none"
      className="max-h-40 overscroll-none"
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Literal `t()` calls, so extraction and key checks see every run status. */
const RUN_STATUS_LABEL = {
  active: () => t("Active"),
  paused: () => t("Paused"),
  stopped: () => t("Stopped"),
  finished: () => t("Finished"),
} as const;

export function OrchestrationPreview({ block, busy }: { block: Block; busy?: boolean }) {
  useLocale();
  const actions = useContext(OrchestrationActions);
  const runs = useSyncExternalStore(
    orchestrator.subscribe,
    orchestrator.snapshot,
    orchestrator.snapshot,
  );
  const proposal = block.orchestration!;
  const run = runs.find(
    (entry) => entry.leadId === proposal.leadId && entry.proposalId === block.id,
  );
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<{ title: string; detail: string }>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (actions)
      void orchestrator
        .hydrate(proposal.leadId)
        .catch((reason: unknown) =>
          setError({ title: t("Could not load orchestration"), detail: errorText(reason) }),
        );
  }, [actions, proposal.leadId]);
  const editable = proposal.status === "ready" && !run && !pending && !busy && !!actions;
  const confirmReason = busy ? t("Wait for the current operation to finish") : undefined;
  const planning = proposal.status === "planning";
  const starting = pending || proposal.status === "starting";
  const visible = showAll ? proposal.tasks : proposal.tasks.slice(0, 3);
  const perform = async (fn: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      await fn();
    } catch (reason) {
      setError({ title: t("Could not start orchestration"), detail: errorText(reason) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const change = (id: string, patch: Partial<ProposedTask>) => {
    setError(undefined);
    actions?.update(proposal.leadId, block.id, {
      ...proposal,
      tasks: proposal.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    });
  };
  return (
    <Surface
      variant="card"
      padding="none"
      className="mb-2 overflow-hidden font-sans"
      aria-label={t("Orchestration proposal")}
      data-orchestration-review
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
        <Text size="inherit" tone="secondary" className="grid size-6 shrink-0 place-items-center">
          {planning ? (
            <Spinner size="md" />
          ) : (
            <MessageMultiple className="icon-md" strokeWidth={1.75} />
          )}
        </Text>
        <div className="min-w-0 flex-1">
          <Text as="div" size="secondary" tone="neutral" weight="medium" wrap="anywhere">
            {planning ? t("Planning assignments…") : proposal.title}
          </Text>
          {!!proposal.tasks.length && (
            <Text as="div" size="micro" tone="secondary" leading="tight" className="mt-1">
              {proposal.tasks.length === 1
                ? t("{p0} task", { p0: 1 })
                : t("{p0} tasks", { p0: proposal.tasks.length })}
            </Text>
          )}
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-0.5">
          {!run && proposal.status === "invalid" && actions && (
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => actions?.retry(proposal.leadId, block.id)}
            >
              {t("Try again")}
            </Button>
          )}
          {!run && ["ready", "starting"].includes(proposal.status) && (
            <Button
              variant="primary"
              type="button"
              disabled={!editable}
              disabledReason={confirmReason}
              loading={starting}
              loadingLabel={t("Starting…")}
              startIcon={<Play className="icon-xs" strokeWidth={1.75} />}
              onClick={() => void perform(() => actions!.confirm(proposal.leadId, block.id))}
            >
              {t("Confirm & start")}
            </Button>
          )}
          {run && (
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                actions?.openAgents?.(
                  run.tasks.map((task) => ({
                    sessionId: task.sessionId,
                    leadId: run.leadId,
                    title: task.title,
                    harness: task.harness,
                  })),
                )
              }
            >
              {t("View agents")}
            </Button>
          )}
        </div>
      </div>
      {!!proposal.tasks.length && (
        <ul {...surfaceAttributes({ frame: "pane", edge: "top" }, "py-1")}>
          {visible.map((task) => {
            const open = expanded.includes(task.id);
            const taskChoice = proposal.settings.choices.find(
              (choice) => choice.harness === task.harness && choice.model === task.model,
            );
            const taskModel = findModel(task.model);
            const taskEffort =
              taskModel?.harness === task.harness
                ? modelEffortLabel(taskModel, task.modelSettings)
                : undefined;
            return (
              <li key={task.id}>
                <ActionHost
                  controlMinHeight="control"
                  padding={{ inline: "xl", block: "xs" }}
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                >
                  <Button
                    variant="item"
                    type="button"
                    aria-label={t("Details for {p0}", { p0: task.title })}
                    selected={open}
                    expanded={open}
                    chevron="start"
                    onClick={() =>
                      setExpanded((prev) =>
                        open ? prev.filter((id) => id !== task.id) : [...prev, task.id],
                      )
                    }
                    className="min-w-0 flex-1 text-start"
                  >
                    <OverflowTooltip label={task.title}>
                      <Text
                        size="caption"
                        tone="inherit"
                        truncate={!open}
                        wrap={open ? "anywhere" : undefined}
                      >
                        {task.title}
                      </Text>
                    </OverflowTooltip>
                  </Button>
                  <div className={editable ? "max-w-3/5 min-w-0" : "min-w-0 w-full ps-6"}>
                    {editable ? (
                      <AssignmentModel
                        task={task}
                        choices={proposal.settings.choices}
                        onChange={(choice, modelSettings) =>
                          change(task.id, {
                            harness: choice.harness,
                            model: choice.model,
                            modelSettings,
                          })
                        }
                      />
                    ) : (
                      <Text
                        size="micro"
                        tone="secondary"
                        className="flex min-w-0 flex-wrap items-start gap-1.5"
                      >
                        <HarnessIcon harness={task.harness} className="icon-xs shrink-0" />
                        <Text size="inherit" tone="inherit" wrap="anywhere">
                          {taskChoice?.name ?? modelDisplayName(task.model, task.harness)}
                          {taskEffort ? ` · ${taskEffort}` : ""}
                        </Text>
                      </Text>
                    )}
                  </div>
                </ActionHost>
                {open && (
                  <Text
                    as="div"
                    size="micro"
                    tone="secondary"
                    className="space-y-2.5 px-3 pb-3 ps-8"
                  >
                    {editable ? (
                      <>
                        <TextField
                          label={t("Task")}
                          value={task.title}
                          onChange={(event) => change(task.id, { title: event.target.value })}
                        />
                        <InstructionsField
                          value={task.prompt}
                          onChange={(prompt) => change(task.id, { prompt })}
                        />
                      </>
                    ) : (
                      <Text
                        as="p"
                        size="caption"
                        tone="secondary"
                        leading="relaxed"
                        className="whitespace-pre-wrap"
                      >
                        {task.prompt}
                      </Text>
                    )}
                    {!!task.dependsOn.length && (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Text size="micro" tone="muted" truncate className="min-w-0">
                          {t("{p0}: {p1}", {
                            p0: t("After"),
                            p1: task.dependsOn
                              .map(
                                (id) =>
                                  proposal.tasks.find((entry) => entry.id === id)?.title ?? id,
                              )
                              .join(", "),
                          })}
                        </Text>
                      </div>
                    )}
                  </Text>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {proposal.tasks.length > 3 && (
        <Button
          variant="item"
          type="button"
          expanded={showAll}
          chevron="start"
          onClick={() => setShowAll(!showAll)}
          className="w-full text-start"
        >
          {showAll
            ? t("Show fewer tasks")
            : proposal.tasks.length === 4
              ? t("Show {p0} more task", { p0: 1 })
              : t("Show {p0} more tasks", { p0: proposal.tasks.length - 3 })}
        </Button>
      )}
      {error || proposal.error ? (
        <Alert
          tone="danger"
          title={error?.title ?? t("Orchestration failed")}
          extra={
            <ErrorDetails
              title={error?.title ?? t("Orchestration failed")}
              detail={error?.detail ?? proposal.error ?? ""}
            />
          }
        />
      ) : null}
      {!planning && (
        <Text
          as="div"
          size="micro"
          tone="secondary"
          {...surfaceAttributes(
            { frame: "pane", edge: "top" },
            "flex flex-wrap items-center justify-between gap-2 px-3 py-2",
          )}
        >
          <div className="flex items-center gap-1.5">
            {editable ? (
              <>
                <span>{t("Parallel workers")}</span>
                <SegmentedControl
                  label={t("Parallel workers")}
                  selectionRole="radio"
                  options={[1, 2, 3, 4].map((number) => ({
                    value: String(number),
                    label: String(number),
                  }))}
                  value={String(proposal.settings.maxWorkers)}
                  onValueChange={(value) =>
                    actions?.update(proposal.leadId, block.id, {
                      ...proposal,
                      settings: { ...proposal.settings, maxWorkers: Number(value) },
                    })
                  }
                />
              </>
            ) : (
              <span>
                {proposal.settings.maxWorkers === 1
                  ? t("{p0} parallel worker", { p0: 1 })
                  : t("{p0} parallel workers", { p0: proposal.settings.maxWorkers })}
              </span>
            )}
            <WorkerHelp />
          </div>
          <span>
            {run?.status
              ? RUN_STATUS_LABEL[run.status]()
              : proposal.status === "approved"
                ? t("Approved")
                : ""}
          </span>
        </Text>
      )}
    </Surface>
  );
}
