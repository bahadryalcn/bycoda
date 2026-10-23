import { MenuRow } from "../../../shared/ui/MenuRow";
import { Alert } from "../../../shared/ui/Alert";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { t, useLocale } from "../../../shared/i18n";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
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
import { LAYER } from "../../../shared/lib/layers";
import { OrchestrationActions } from "./OrchestrationActions";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { Popover } from "../../../shared/ui/Popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  MessageMultiple,
  Play,
  Search,
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
  const [active, setActive] = useState(0);
  const [effortActive, setEffortActive] = useState(0);
  const [inEffort, setInEffort] = useState(false);
  const [activeRow, setActiveRow] = useState<HTMLButtonElement | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listOverscroll = useLockOverscroll<HTMLDivElement>();
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
  const activeChoice = matches[active];
  const activeModel = activeChoice ? findModel(activeChoice.model) : undefined;
  const effort = activeChoice ? effortForChoice(activeChoice) : undefined;
  const selectedEffortValue = effort
    ? activeChoice === selected
      ? (task.modelSettings?.[effort.id] ?? effort.value)
      : effort.value
    : undefined;
  const selectedModel = selected ? findModel(selected.model) : undefined;
  const selectedEffortLabel =
    selectedModel && selectedModel.harness === selected?.harness
      ? modelEffortLabel(selectedModel, task.modelSettings)
      : undefined;
  // Two things fought this field for focus. The composer takes focus back
  // unless a picker surface is in the DOM, which `data-model-picker` below
  // now declares; and the popover measures itself with `visibility: hidden`
  // on its first pass, where nothing can be focused. Placement flushes in a
  // layout effect ahead of this one, so focus now for the pass that is
  // already on screen and again next frame, once placement has landed.
  // Re-focusing a focused field is a no-op.
  useEffect(() => {
    if (!open) return;
    search.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    activeRow?.scrollIntoView({ block: "nearest" });
  }, [activeRow]);
  useEffect(() => {
    if (!effort) {
      setEffortActive(0);
      return;
    }
    const index = effort.options.findIndex((option) => option.value === selectedEffortValue);
    setEffortActive(index >= 0 ? index : 0);
  }, [effort, selectedEffortValue]);
  const pick = (choice: OrchestrationChoice, modelSettings: Record<string, string>) => {
    onChange(choice, modelSettings);
    setOpen(false);
    setInEffort(false);
    anchor.current?.focus();
  };
  const settingsFor = (choice: OrchestrationChoice, effortValue?: string) => {
    const model = findModel(choice.model);
    if (!model || model.harness !== choice.harness) return {};
    const setting = modelEffortSetting(model);
    return mergeModelSettings(model, {
      ...(choice === selected ? task.modelSettings : undefined),
      ...(setting && effortValue ? { [setting.id]: effortValue } : {}),
    });
  };
  const openEffortOrPick = (choice: OrchestrationChoice) => {
    const model = findModel(choice.model);
    if (model?.harness === choice.harness && modelEffortSetting(model)?.options.length) {
      setInEffort(true);
      return;
    }
    pick(choice, settingsFor(choice));
  };
  // Arrows walk the list from the search field, the way the app's other
  // pickers work. The keys stop here so the transcript underneath does not
  // scroll along with the highlight.
  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (inEffort && effort?.options.length) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setEffortActive(
          (index) => (index + direction + effort.options.length) % effort.options.length,
        );
        return;
      }
      if (!matches.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => Math.min(matches.length - 1, Math.max(0, index + step)));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      if (effort?.options.length) setInEffort(true);
      return;
    }
    if (event.key === "ArrowLeft" && inEffort) {
      event.preventDefault();
      event.stopPropagation();
      setInEffort(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (inEffort) {
        const option = effort?.options[effortActive];
        if (activeChoice && option) pick(activeChoice, settingsFor(activeChoice, option.value));
        return;
      }
      if (activeChoice) openEffortOrPick(activeChoice);
    }
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
        onClick={() => {
          setQuery("");
          setActive(selected ? choices.indexOf(selected) : 0);
          setInEffort(false);
          setOpen(!open);
        }}
        className="max-w-full"
      >
        <HarnessIcon harness={task.harness} className="icon-sm shrink-0" />
        <span className="truncate">
          {selected?.name ?? task.model}
          {selectedEffortLabel ? ` · ${selectedEffortLabel}` : ""} · {HARNESS_TITLE[task.harness]}
        </span>
        <ChevronDown className="icon-xs shrink-0" />
      </Button>
      {open && (
        <Popover
          anchor={anchor}
          side="bottom"
          align="start"
          width={260}
          maxHeight={320}
          ignore="[data-assignment-model-target]"
          onDismiss={() => {
            setOpen(false);
            setInEffort(false);
          }}
          data-model-picker
          data-assignment-model-target
          className="flex flex-col overflow-hidden"
        >
          <label className="flex shrink-0 items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2.5 text-(--ui-text-secondary)">
            <Search className="icon-sm shrink-0" strokeWidth={1.75} />
            <SearchInput
              ref={search}
              type="text"
              aria-label={t("Search assignment models")}
              placeholder={t("Search models or harnesses…")}
              spellCheck={false}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
                setInEffort(false);
              }}
              onKeyDown={onSearchKey}
              className="min-w-0 flex-1 bg-transparent text-ui-secondary text-(--ui-tone-neutral-fg) outline-none placeholder:text-(--ui-text-secondary)"
            />
          </label>
          <div
            ref={listOverscroll}
            role="listbox"
            aria-label={t("Assignment models")}
            className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
          >
            {matches.map((choice, index) => (
              <Button
                variant="item"
                key={`${choice.harness}:${choice.model}`}
                ref={index === active ? setActiveRow : undefined}
                type="button"
                fullWidth
                selected={index === active}
                role="option"
                aria-selected={choice === selected}
                aria-haspopup={effortForChoice(choice)?.options.length ? "menu" : undefined}
                aria-expanded={index === active && inEffort}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  setActive(index);
                  const model = findModel(choice.model);
                  setInEffort(
                    model?.harness === choice.harness &&
                      !!modelEffortSetting(model)?.options.length,
                  );
                }}
                onClick={() => {
                  setActive(index);
                  openEffortOrPick(choice);
                }}
              >
                <HarnessIcon harness={choice.harness} className="icon-md shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-secondary leading-tight text-(--ui-tone-neutral-fg)">
                    {choice.name}
                  </span>
                  <span className="mt-0.5 block truncate text-ui-micro leading-tight text-(--ui-text-secondary)">
                    {HARNESS_TITLE[choice.harness]}
                  </span>
                </span>
                {choice === selected && (
                  <Check className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={2} />
                )}
                {effortForChoice(choice)?.options.length ? (
                  <ChevronRight
                    className="icon-sm shrink-0 text-(--ui-text-secondary)"
                    strokeWidth={1.75}
                  />
                ) : null}
              </Button>
            ))}
            {!matches.length && (
              <p className="px-2 py-3 text-ui-caption text-(--ui-text-secondary)">
                {t("No matching models")}
              </p>
            )}
          </div>
        </Popover>
      )}
      {open &&
      inEffort &&
      activeRow &&
      activeChoice &&
      activeModel?.harness === activeChoice.harness &&
      effort ? (
        <Popover
          anchor={activeRow}
          side="right"
          gap={-4}
          width={200}
          layer={LAYER.submenu}
          role="menu"
          aria-label={t("{p0} effort", { p0: activeChoice.name })}
          ignore="[data-assignment-model-target]"
          onMouseEnter={() => setInEffort(true)}
          data-assignment-model-target
          className="p-1 font-sans"
        >
          {effort.options.map((option, index) => {
            const highlighted = index === effortActive;
            const selectedOption = option.value === selectedEffortValue;
            return (
              <MenuRow
                key={option.value}
                type="button"
                data-highlighted={highlighted}
                role="menuitemradio"
                aria-checked={selectedOption}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setEffortActive(index)}
                onClick={() => pick(activeChoice, settingsFor(activeChoice, option.value))}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {selectedOption ? (
                  <Check className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={2} />
                ) : null}
              </MenuRow>
            );
          })}
        </Popover>
      ) : null}
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
          <div className="text-ui-caption leading-4 text-(--ui-tone-neutral-fg)">
            {t("How many workers run at once")}
          </div>
          <div className="mt-1 text-ui-micro leading-4 text-(--ui-text-secondary)">
            {t(
              "Tasks wait for available workers and for their dependencies to finish. A lower number runs fewer agent sessions at the same time.",
            )}
          </div>
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
  const fieldLabel = "mb-1 block text-ui-micro leading-tight text-(--ui-text-secondary)";
  return (
    <div
      className="mb-2 overflow-hidden rounded-(--radius-panel) border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) font-sans"
      aria-label={t("Orchestration proposal")}
      data-orchestration-review
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-6 shrink-0 place-items-center text-(--ui-text-secondary)">
          {planning || proposal.status === "starting" ? (
            <CircleDashed className="icon-md animate-spin" />
          ) : (
            <MessageMultiple className="icon-md" strokeWidth={1.75} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-ui-secondary font-medium text-(--ui-tone-neutral-fg)">
            {planning ? t("Planning assignments…") : proposal.title}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-ui-micro leading-tight text-(--ui-text-secondary)">
            <HarnessIcon harness={proposal.author.harness} className="icon-xs shrink-0" />
            <span className="truncate" title={HARNESS_TITLE[proposal.author.harness]}>
              {t("Lead · ")}
              {proposal.author.name}
            </span>
            {!!proposal.tasks.length && (
              <span className="shrink-0">
                · {proposal.tasks.length} {proposal.tasks.length === 1 ? t("task") : t("tasks")}
              </span>
            )}
          </div>
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
              onClick={() => void perform(() => actions!.confirm(proposal.leadId, block.id))}
            >
              <Play className="icon-xs" strokeWidth={1.75} />
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
        <p className="px-3 pb-2.5 text-ui-caption leading-5 text-(--ui-text-secondary)">
          {proposal.settings.choices.length
            ? t(
                "Your lead is choosing tasks and worker models. Review the assignments here before starting.",
              )
            : t("Checking available harnesses and models…")}
        </p>
      )}
      {!!proposal.tasks.length && (
        <ul className="border-t border-(--ui-tone-neutral-border) py-1">
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
                <div className="flex min-h-9 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1 hover:bg-(--ui-surface-raised)">
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
                    <span className="truncate text-ui-caption" title={task.title}>
                      {task.title}
                    </span>
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
                      <span
                        className="flex min-w-0 items-center gap-1.5 text-ui-micro text-(--ui-text-secondary)"
                        title={HARNESS_TITLE[task.harness]}
                      >
                        <HarnessIcon harness={task.harness} className="icon-xs shrink-0" />
                        <span className="truncate">
                          {taskChoice?.name ?? task.model}
                          {taskEffort ? ` · ${taskEffort}` : ""}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                {open && (
                  <div className="space-y-2.5 px-3 pb-3 pl-8 text-ui-micro leading-4 text-(--ui-text-secondary)">
                    {editable ? (
                      <>
                        <label className="block">
                          <span className={fieldLabel}>{t("Task")}</span>
                          <TextField
                            hideLabel
                            label=""
                            aria-label={t("Title for task {p0}", { p0: index + 1 })}

                            value={task.title}
                            onChange={(event) => change(task.id, { title: event.target.value })}
                          />
                        </label>
                        <label className="block">
                          <span className={fieldLabel}>{t("Instructions")}</span>
                          <InstructionsField
                            label={t("Instructions for task {p0}", { p0: index + 1 })}
                            value={task.prompt}
                            onChange={(prompt) => change(task.id, { prompt })}
                          />
                        </label>
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap text-ui-caption leading-5 text-(--ui-text-secondary)">
                        {task.prompt}
                      </p>
                    )}
                    {!!task.dependsOn.length && (
                      <p>
                        {t("After ·")}{" "}
                        {task.dependsOn
                          .map((id) => proposal.tasks.find((entry) => entry.id === id)?.title ?? id)
                          .join(", ")}
                      </p>
                    )}
                  </div>
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
      {(error || proposal.error) && (
        <Alert tone="danger" role="alert">
          {error ?? proposal.error}
        </Alert>
      )}
      {!planning && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--ui-tone-neutral-border) px-3 py-2 text-ui-micro text-(--ui-text-secondary)">
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
        </div>
      )}
    </div>
  );
}
