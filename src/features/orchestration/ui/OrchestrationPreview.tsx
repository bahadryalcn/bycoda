import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { ActionHost } from "../../../shared/ui/ActionHost";
import { Spinner } from "../../../shared/ui/Spinner";
import { Surface } from "../../../shared/ui/Surface";
import { Alert } from "../../../shared/ui/Alert";
import { BadgeList } from "../../../shared/ui/BadgeList";
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
import { Popover } from "../../../shared/ui/Popover";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  MessageMultiple,
  Play,
} from "../../../shared/ui/icons";

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
            <Text as="p" size="caption" tone="secondary" className="px-2 py-3">
              {t("No matching models")}
            </Text>
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
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
        className="max-w-full"
      >
        <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
        <Text size="inherit" tone="inherit" truncate>
          {selected?.name ?? task.model}
          {selectedEffortLabel ? ` · ${selectedEffortLabel}` : ""} · {HARNESS_TITLE[task.harness]}
        </Text>
        <ChevronDown className="icon-xs shrink-0" />
      </Button>
      {open && (
        <DropdownMenu
          anchor={anchor}
          label={t("Assignment models")}
          side="bottom"
          align="start"
          width={260}
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
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        iconOnly
        label={t("What parallel workers means")}
        variant="ghost"
        type="button"
        ref={anchor}
        aria-label={t("What parallel workers means")}
        selected={open}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="shrink-0"
      >
        <CircleHelp className="icon-sm" strokeWidth={1.75} />
      </Button>
      {(hovered || open) && (
        <Popover
          anchor={anchor}
          side="top"
          align="start"
          width={250}
          onDismiss={() => setOpen(false)}
          className={`px-2.5 py-2 ${open ? "" : "pointer-events-none"}`}
        >
          <Text as="div" size="caption" tone="neutral">
            {t("How many workers run at once")}
          </Text>
          <Text as="div" size="micro" tone="secondary" className="mt-1">
            {t(
              "Tasks wait for available workers and for their dependencies to finish. A lower number runs fewer agent sessions at the same time.",
            )}
          </Text>
        </Popover>
      )}
    </>
  );
}

function InstructionsField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
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
      hideLabel
      label=""
      ref={(el) => {
        ref.current = el;
        lockOverscroll(el);
      }}
      fieldClassName="w-full"
      className="max-h-40 resize-none overscroll-none"
      style={{ resize: "none", overscrollBehavior: "none" }}
      rows={1}
      aria-label={label}

      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

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
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (actions)
      void orchestrator
        .hydrate(proposal.leadId)
        .catch((reason: unknown) => setError(String(reason)));
  }, [actions, proposal.leadId]);
  const editable = proposal.status === "ready" && !run && !pending && !busy && !!actions;
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
      setError(reason instanceof Error ? reason.message : String(reason));
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
      variant="quiet"
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
          <Text as="div" size="secondary" tone="neutral" weight="medium" truncate>
            {planning ? t("Planning assignments…") : proposal.title}
          </Text>
          <Text
            as="div"
            size="micro"
            tone="secondary"
            leading="tight"
            className="mt-1 flex items-center gap-1.5"
          >
            <HarnessIcon harness={proposal.author.harness} className="icon-xs shrink-0" />
            <Text
              size="inherit"
              tone="inherit"
              truncate
              title={HARNESS_TITLE[proposal.author.harness]}
            >
              {t("Lead · ")}
              {proposal.author.name}
            </Text>
            {!!proposal.tasks.length && (
              <span className="shrink-0">
                · {proposal.tasks.length} {proposal.tasks.length === 1 ? t("task") : t("tasks")}
              </span>
            )}
          </Text>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {!run && proposal.status === "invalid" && (
            <Button
              variant="ghost"
              type="button"

              disabled={busy || !actions}
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
              loading={starting}
              startIcon={<Play className="icon-xs" strokeWidth={1.75} />}
              onClick={() => void perform(() => actions!.confirm(proposal.leadId, block.id))}
            >
              {starting ? t("Starting…") : t("Confirm & start")}
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
      {planning && (
        <Text as="p" size="caption" tone="secondary" leading="relaxed" className="px-3 pb-2.5">
          {proposal.settings.choices.length
            ? t(
                "Your lead is choosing tasks and worker models. Review the assignments here before starting.",
              )
            : t("Checking available harnesses and models…")}
        </Text>
      )}
      {!!proposal.tasks.length && (
        <ul
          {...surfaceAttributes(
            { frame: "neutral", edge: "top" },
            "border-(--ui-tone-neutral-border) py-1",
          )}
        >
          {visible.map((task) => {
            const index = proposal.tasks.indexOf(task);
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
                <ActionHost className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1">
                  <Button
                    variant="item"
                    type="button"
                    aria-label={t("Details for {p0}", { p0: task.title })}
                    selected={open}
                    aria-expanded={open}
                    onClick={() =>
                      setExpanded((prev) =>
                        open ? prev.filter((id) => id !== task.id) : [...prev, task.id],
                      )
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    {open ? (
                      <ChevronDown className="icon-sm shrink-0" />
                    ) : (
                      <ChevronRight className="icon-sm shrink-0" />
                    )}
                    <OverflowTooltip label={task.title}>
                      <Text size="caption" tone="inherit" truncate>
                        {task.title}
                      </Text>
                    </OverflowTooltip>
                  </Button>
                  <div className="max-w-[60%] min-w-0">
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
                        className="flex min-w-0 items-center gap-1.5"
                        title={HARNESS_TITLE[task.harness]}
                      >
                        <HarnessIcon harness={task.harness} className="icon-xs shrink-0" />
                        <Text size="inherit" tone="inherit" truncate>
                          {taskChoice?.name ?? task.model}
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
                    className="space-y-2.5 px-3 pb-3 pl-8"
                  >
                    {editable ? (
                      <>
                        <div className="block">
                          <Text
                            size="micro"
                            tone="secondary"
                            leading="tight"
                            className="mb-1 block"
                          >
                            {t("Task")}
                          </Text>
                          <TextField
                            hideLabel
                            label=""
                            aria-label={t("Title for task {p0}", { p0: index + 1 })}

                            value={task.title}
                            onChange={(event) => change(task.id, { title: event.target.value })}
                          />
                        </div>
                        <div className="block">
                          <Text
                            size="micro"
                            tone="secondary"
                            leading="tight"
                            className="mb-1 block"
                          >
                            {t("Instructions")}
                          </Text>
                          <InstructionsField
                            label={t("Instructions for task {p0}", { p0: index + 1 })}
                            value={task.prompt}
                            onChange={(prompt) => change(task.id, { prompt })}
                          />
                        </div>
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
                        <span className="shrink-0">{t("After ·")}</span>
                        <BadgeList
                          label={t("After")}
                          size="xs"
                          max={2}
                          className="min-w-0"
                          items={task.dependsOn.map((id, index) => {
                            const title =
                              proposal.tasks.find((entry) => entry.id === id)?.title ?? id;
                            return { id: `${index}:${title}`, label: title };
                          })}
                        />
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
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
          className="w-full text-left"
        >
          {showAll ? <ChevronDown className="icon-sm" /> : <ChevronRight className="icon-sm" />}
          {showAll
            ? t("Show fewer tasks")
            : t(proposal.tasks.length === 4 ? "Show {p0} more task" : "Show {p0} more tasks", {
                p0: proposal.tasks.length - 3,
              })}
        </Button>
      )}
      {(error || proposal.error) && <Alert tone="danger">{error ?? proposal.error}</Alert>}
      {!planning && (
        <Text
          as="div"
          size="micro"
          tone="secondary"
          {...surfaceAttributes(
            { frame: "neutral", edge: "top" },
            "flex flex-wrap items-center justify-between gap-2 border-(--ui-tone-neutral-border) px-3 py-2",
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
                {proposal.settings.maxWorkers}
                {t(" parallel")}
              </span>
            )}
            <WorkerHelp />
          </div>
          <span>
            {[
              run?.status
                ? t(run.status.charAt(0).toUpperCase() + run.status.slice(1))
                : proposal.status === "approved"
                  ? t("Approved")
                  : proposal.status === "ready"
                    ? t("Awaiting confirmation")
                    : "",
              t("Shared project folder"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Text>
      )}
    </Surface>
  );
}
