import { t, useLocale } from "../../../shared/i18n";
import type { ModelRoutingItemChoice } from "../../../shared/model/host-contracts/model-routing";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "../../../shared/ui/icons";
import { Surface } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { WorkExecutorFields } from "../../tasks/public/workExecutor";
import { newRecipeStepId, type RecipeStep } from "../model/automationRecipe";

const MAX_STEPS = 20;

/** The recipe's own choices, which a task step follows until it sets its own. */
export type RecipeStepDefaults = {
  machine?: { id: string };
  routingSupported: boolean;
  cwd: string;
  harness: Parameters<typeof WorkExecutorFields>[0]["harness"];
  modelSettings: Record<string, string>;
  modelChoice: ModelRoutingItemChoice | undefined;
};

/** Whether every step has the text it needs; a recipe with an empty step cannot be saved. */
/** Why no step can be added, once the recipe holds the most it may. */
function fullReason(count: number, disabled: boolean | undefined): string | undefined {
  return !disabled && count >= MAX_STEPS
    ? t("You can add up to {p0} steps.", { p0: MAX_STEPS })
    : undefined;
}

export function recipeStepsValid(steps: readonly RecipeStep[]): boolean {
  return (
    steps.length > 0 &&
    steps.every(
      (step) =>
        step.title.trim().length > 0 &&
        (step.kind === "task" ? step.request.trim() : step.question.trim()).length > 0,
    )
  );
}

function TaskStepOverrides({
  step,
  defaults,
  disabled,
  onChange,
}: {
  step: Extract<RecipeStep, { kind: "task" }>;
  defaults: RecipeStepDefaults;
  disabled: boolean;
  onChange: (step: RecipeStep) => void;
}) {
  return (
    <Disclosure summary={t("Run with")}>
      <WorkExecutorFields
        routingRole="automation"
        machine={defaults.machine}
        routingSupported={defaults.routingSupported}
        cwd={defaults.cwd}
        harness={defaults.harness}
        modelSettings={defaults.modelSettings}
        executor={step.executor}
        onExecutorChange={(executor) => onChange({ ...step, executor })}
        modelChoice={step.modelChoice ?? defaults.modelChoice}
        onModelChoiceChange={(modelChoice) => onChange({ ...step, modelChoice })}
        fixedModel={
          <Text size="caption" tone="secondary">
            {t("The recipe's model")}
          </Text>
        }
        helpers={step.helpers}
        onHelpersChange={(helpers) => onChange({ ...step, helpers })}
        disabled={disabled}
      />
    </Disclosure>
  );
}

function RecipeStepRow({
  step,
  index,
  count,
  defaults,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  step: RecipeStep;
  index: number;
  count: number;
  defaults: RecipeStepDefaults;
  disabled: boolean;
  onChange: (step: RecipeStep) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const decision = step.kind === "decision";
  return (
    <Surface variant="card" padding="sm" className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Text size="micro" tone="muted" className="w-5 shrink-0 text-center tabular-nums">
          {index + 1}
        </Text>
        <TextField
          label={decision ? t("Decision title") : t("Step title")}
          hideLabel
          aria-label={decision ? t("Decision title") : t("Step title")}
          value={step.title}
          disabled={disabled}
          maxLength={200}
          placeholder={decision ? t("Ask the owner") : t("Step title")}
          fieldClassName="min-w-0 flex-1"
          onChange={(event) => onChange({ ...step, title: event.target.value })}
        />
        <Button
          iconOnly
          variant="ghost"
          type="button"
          label={t("Move earlier")}
          disabled={disabled || index === 0}
          disabledReason={!disabled && index === 0 ? t("Already first.") : undefined}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="icon-xs" />
        </Button>
        <Button
          iconOnly
          variant="ghost"
          type="button"
          label={t("Move later")}
          disabled={disabled || index === count - 1}
          disabledReason={!disabled && index === count - 1 ? t("Already last.") : undefined}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="icon-xs" />
        </Button>
        <Button
          iconOnly
          variant="ghost"
          tone="danger"
          type="button"
          label={t("Remove step")}
          disabled={disabled || count === 1}
          disabledReason={
            !disabled && count === 1 ? t("A recipe needs at least one step.") : undefined
          }
          onClick={onRemove}
        >
          <Trash2 className="icon-xs" />
        </Button>
      </div>
      <TextareaField
        label={decision ? t("Question for the owner") : t("Instructions")}
        hideLabel
        aria-label={decision ? t("Question for the owner") : t("Instructions")}
        value={step.kind === "task" ? step.request : step.question}
        disabled={disabled}
        minRows={2}
        maxRows={8}
        autosize
        maxLength={step.kind === "task" ? 32_000 : 2_000}
        placeholder={decision ? t("What should the owner decide?") : t("What should this step do?")}
        onChange={(event) =>
          onChange(
            step.kind === "task"
              ? { ...step, request: event.target.value }
              : { ...step, question: event.target.value },
          )
        }
      />
      {step.kind === "task" ? (
        <TaskStepOverrides
          step={step}
          defaults={defaults}
          disabled={disabled}
          onChange={onChange}
        />
      ) : null}
    </Surface>
  );
}

/** Ordered steps of a recipe: tasks that follow the recipe's run choices unless a step sets its own, and owner decisions. */
export function RecipeStepsEditor({
  steps,
  defaults,
  disabled = false,
  onChange,
}: {
  steps: readonly RecipeStep[];
  defaults: RecipeStepDefaults;
  disabled?: boolean;
  onChange: (steps: RecipeStep[]) => void;
}) {
  useLocale();
  const full = fullReason(steps.length, disabled);
  const replace = (index: number, step: RecipeStep) =>
    onChange(steps.map((entry, at) => (at === index ? step : entry)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    next.splice(index + by, 0, step!);
    onChange(next);
  };
  const add = (kind: RecipeStep["kind"]) =>
    onChange([
      ...steps,
      kind === "task"
        ? { id: newRecipeStepId(), kind, title: "", request: "" }
        : { id: newRecipeStepId(), kind, title: "", question: "" },
    ]);
  return (
    <div className="grid min-w-0 gap-2">
      <ol className="grid min-w-0 gap-2">
        {steps.map((step, index) => (
          <li key={step.id} className="min-w-0">
            <RecipeStepRow
              step={step}
              index={index}
              count={steps.length}
              defaults={defaults}
              disabled={disabled}
              onChange={(next) => replace(index, next)}
              onMove={(by) => move(index, by)}
              onRemove={() => onChange(steps.filter((_, at) => at !== index))}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          type="button"
          disabled={disabled || steps.length >= MAX_STEPS}
          disabledReason={full}
          onClick={() => add("task")}
        >
          <Plus className="icon-xs" />
          {t("Add step")}
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={disabled || steps.length >= MAX_STEPS}
          disabledReason={full}
          onClick={() => add("decision")}
        >
          <Plus className="icon-xs" />
          {t("Add decision")}
        </Button>
      </div>
    </div>
  );
}
