import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { t } from "../../../shared/i18n";
import type { ConfirmRequest } from "../../../shared/ui/ConfirmDialog";
import type { RemoteMachine } from "../../connections/model/protocol";
import { automationKey } from "../model/automationKey";
import {
  createManualAutomationRun,
  deleteAutomation,
  draftFromAutomation,
  saveAutomation,
  setAutomationEnabled,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
} from "../model/automations";
import {
  deleteHostAutomation,
  runHostAutomationNow,
  saveHostAutomation,
} from "../model/hostAutomationClient";

type Params = {
  machines: readonly RemoteMachine[];
  /** The Host's confirmed-write hooks and refresh from `useHostAutomations`. */
  confirmSaved: (saved: Automation) => void;
  confirmDeleted: (deleted: Automation) => void;
  refreshHost: () => Promise<void>;
  selected: Automation | null;
  selectedId: string | null;
  /** Run history of the selected automation. */
  runs: readonly AutomationRun[];
  /**
   * Identity of the local list read. An action error is shown only while this
   * is unchanged, so a fresh list read dismisses it as before.
   */
  errorStamp: unknown;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setDraft: Dispatch<SetStateAction<AutomationDraft | null>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  onLaunch: (automation: Automation, run: AutomationRun) => void | Promise<void>;
};

/**
 * Save, run, delete and enable/disable handlers for the Automations view, with
 * the in-flight state and the last action error they own. `savingRef` guards
 * list/editor interaction while a save is in flight.
 */
/** One full sentence per count, so each language keeps its own grammar. */
export function unreachableNotice(names: string[]): string {
  return t(
    names.length === 1
      ? "{p0} isn’t reachable right now, so its automations may be out of date."
      : "{p0} aren’t reachable right now, so their automations may be out of date.",
    { p0: names.join(", ") },
  );
}

export function useAutomationActions({
  machines,
  confirmSaved,
  confirmDeleted,
  refreshHost,
  selected,
  selectedId,
  runs,
  errorStamp,
  confirm,
  setPickerOpen,
  setDraft,
  setSelectedId,
  onLaunch,
}: Params) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [running, setRunning] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const togglingRef = useRef(new Set<string>());
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  const [failure, setFailure] = useState<{ message: string; stamp: unknown } | null>(null);
  const stampRef = useRef(errorStamp);
  useEffect(() => {
    stampRef.current = errorStamp;
  }, [errorStamp]);
  const actionError = failure && Object.is(failure.stamp, errorStamp) ? failure.message : null;
  const setActionError = (message: string | null) =>
    setFailure(message === null ? null : { message, stamp: stampRef.current });
  const failWith = (reason: unknown) =>
    setActionError(reason instanceof Error ? reason.message : String(reason));

  const onSave = async (event: FormEvent, nextDraft: AutomationDraft) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (nextDraft.id && selected?.host && nextDraft.cwd !== selected.cwd) {
        throw new Error(t("Create a new automation to use another project."));
      }
      const saved = nextDraft.runInBackground
        ? await saveHostAutomation(machines, nextDraft)
        : await saveAutomation(nextDraft);
      if (saved.host) confirmSaved(saved);
      setPickerOpen(false);
      setDraft(null);
      setSelectedId(automationKey(saved));
      setActionError(null);
      if (saved.host) await refreshHost();
    } catch (reason: unknown) {
      failWith(reason);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onRun = async (automation: Automation) => {
    if (running) return;
    setRunning(automationKey(automation));
    try {
      if (automation.host) {
        await runHostAutomationNow(automation);
        await refreshHost();
        return;
      }
      const run = await createManualAutomationRun(automation.id);
      await onLaunch(automation, run);
    } catch (reason: unknown) {
      failWith(reason);
    } finally {
      setRunning(null);
    }
  };

  const confirmDiscard = () =>
    confirm({
      title: t("Discard changes"),
      message: t("Discard your unsaved changes to this automation?"),
      confirmLabel: t("Discard"),
    });

  const onDelete = async (automation: Automation) => {
    if (deleting || saving) return;
    if (
      running === automationKey(automation) ||
      automation.lastRunStatus === "running" ||
      (selectedId === automationKey(automation) && runs.some((run) => run.status === "running"))
    ) {
      setActionError(t("Wait for the current run to finish before deleting this automation."));
      return;
    }
    if (
      !(await confirm({
        title: t("Delete automation"),
        message: t("Delete “{p0}” and its run history?", { p0: automation.name }),
        confirmLabel: t("Delete"),
      }))
    )
      return;
    setDeleting(automationKey(automation));
    try {
      if (automation.host) {
        await deleteHostAutomation(automation);
        confirmDeleted(automation);
      } else await deleteAutomation(automation.id);
      setDraft((current) => (current?.id === automation.id ? null : current));
      setSelectedId((current) => (current === automationKey(automation) ? null : current));
    } catch (reason: unknown) {
      failWith(reason);
    } finally {
      setDeleting(null);
    }
  };

  const onToggle = async (automation: Automation, enabled: boolean) => {
    const key = automationKey(automation);
    if (savingRef.current || togglingRef.current.has(key)) return;
    togglingRef.current.add(key);
    setToggling(new Set(togglingRef.current));
    try {
      if (automation.host) {
        await saveHostAutomation(machines, {
          ...draftFromAutomation(automation),
          enabled,
        });
        await refreshHost();
        return;
      }
      await setAutomationEnabled(automation, enabled);
    } catch (reason: unknown) {
      failWith(reason);
    } finally {
      togglingRef.current.delete(key);
      setToggling(new Set(togglingRef.current));
    }
  };

  return {
    saving,
    savingRef,
    running,
    deleting,
    toggling,
    actionError,
    setActionError,
    onSave,
    onRun,
    onDelete,
    onToggle,
    confirmDiscard,
  };
}
