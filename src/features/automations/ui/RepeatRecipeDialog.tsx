import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { toast } from "../../../shared/ui/ToastRegion";
import { TextField } from "../../../shared/ui/TextField";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import type { HostTask } from "../../tasks/public/hostTasks";
import { useAutomationRoutingHost } from "../hooks/useAutomationRoutingHost";
import { recipeFromTask } from "../model/automationRecipe";
import { createAutomationTrigger, newAutomationDraft } from "../model/automations";
import {
  backgroundMachines,
  runHostAutomationNow,
  saveHostAutomation,
} from "../model/hostAutomationClient";
import { RecipeStepsEditor, recipeStepsValid } from "./RecipeStepsEditor";

/** The task a recipe is made from, on the machine and project the board showed it in. */
export type RepeatSource = HostTask & { machineId: string; cwd: string };

/**
 * "Repeat this": a finished task becomes a recipe prefilled with its request, project, who ran it,
 * model and helpers. The recipe is saved paused under Automations; "Save and run" also starts one
 * occurrence. Its schedule is set where every automation's schedule is set.
 */
export function RepeatRecipeDialog({ task, onClose }: { task: RepeatSource; onClose: () => void }) {
  useLocale();
  const [prefill] = useState(() => recipeFromTask(task));
  const [name, setName] = useState(prefill.name);
  const [steps, setSteps] = useState(prefill.recipe.steps);
  const [saving, setSaving] = useState<"save" | "run" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const routing = useAutomationRoutingHost(task.machineId);
  const machines = useQuery({
    queryKey: ["recipe-machines"],
    queryFn: () => backgroundMachines(),
    staleTime: 30_000,
    retry: false,
  });
  const valid = name.trim().length > 0 && recipeStepsValid(steps);
  const blocked = saving
    ? undefined
    : !machines.data
      ? t("Loading…")
      : !name.trim()
        ? t("Add a name to continue.")
        : !valid
          ? t("Fill in every step first.")
          : undefined;

  const save = async (run: boolean) => {
    if (!valid || saving) return;
    setSaving(run ? "run" : "save");
    setError(null);
    try {
      const draft = {
        ...newAutomationDraft(task.cwd, task.harness, task.model),
        hostCreateId: crypto.randomUUID(),
        hostMachineId: task.machineId,
        name: name.trim(),
        runInBackground: true,
        // Paused: the schedule is chosen in Automations, and a manual run needs no schedule.
        enabled: false,
        triggers: [createAutomationTrigger("time", "weekdays")],
        providerAccountId: task.providerAccountId,
        modelChoice: task.modelChoice,
        modelSettings: task.modelSettings,
        runtimeMode: task.runtimeMode,
        workExecutor: prefill.config.executor,
        workHelpers: task.helpers,
        ...(task.isolate === undefined
          ? {}
          : { workspaceMode: task.isolate ? ("worktree" as const) : ("current" as const) }),
        workRecipe: { version: 1, steps },
      };
      const saved = await saveHostAutomation(machines.data ?? [], draft);
      if (run) await runHostAutomationNow(saved);
      toast.show({
        tone: "success",
        message: run ? t("Recipe saved and started") : t("Recipe saved under Automations"),
      });
      onClose();
    } catch (cause) {
      setError(presentRemoteError(cause, { explicit: true }) ?? t("Could not save the recipe."));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal
      title={t("Repeat this")}
      size="lg"
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <ModalActions>
          <Button variant="ghost" type="button" disabled={!!saving} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={!valid || !!saving || !machines.data}
            disabledReason={blocked}
            loading={saving === "save"}
            onClick={() => void save(false)}
          >
            {t("Save recipe")}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!valid || !!saving || !machines.data}
            disabledReason={blocked}
            loading={saving === "run"}
            onClick={() => void save(true)}
          >
            {t("Save and run")}
          </Button>
        </ModalActions>
      }
    >
      <div className="grid min-w-0 gap-3">
        <TextField
          label={t("Recipe name")}
          value={name}
          disabled={!!saving}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
        <RecipeStepsEditor
          steps={steps}
          disabled={!!saving}
          defaults={{
            machine: routing.machineId ? { id: routing.machineId } : undefined,
            routingSupported: routing.supported,
            cwd: task.cwd,
            harness: task.harness,
            modelSettings: task.modelSettings,
            modelChoice: task.modelChoice,
          }}
          onChange={setSteps}
        />
        {error ? <InlineError details={error} /> : null}
      </div>
    </Modal>
  );
}
