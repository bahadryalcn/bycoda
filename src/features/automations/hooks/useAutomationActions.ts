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
import { presentRemoteError } from "../../connections/public/remoteFailure";

import { automationKey } from "../model/automationKey";
import {
  createManualAutomationRun,
  deleteAutomation,
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
  setHostAutomationEnabled,
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
  const p0 = names.join(", ");
  return names.length === 1
    ? t("{p0} isn’t reachable right now, so its automations may be out of date.", { p0 })
    : t("{p0} aren’t reachable right now, so their automations may be out of date.", { p0 });
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
  setDraft,
  setSelectedId,
  onLaunch,
}: Params) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [running, setRunning] = useState<string | null>(null);
  const runningRef = useRef(new Set<string>());
  const [deleting, setDeleting] = useState<string | null>(null);
  const togglingRef = useRef(new Set<string>());
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  const [failure, setFailure] = useState<{
    message: string;
    title: string | null;
    stamp: unknown;
  } | null>(null);
  const stampRef = useRef(errorStamp);
  useEffect(() => {
    stampRef.current = errorStamp;
  }, [errorStamp]);
  const actionError = failure && Object.is(failure.stamp, errorStamp) ? failure.message : null;
  const actionErrorTitle = actionError ? (failure?.title ?? null) : null;
  /** `title` names the failed operation; without it the view shows its generic headline. */
  const setActionError = (message: string | null, title?: string) =>
    setFailure(
      message === null ? null : { message, title: title ?? null, stamp: stampRef.current },
    );
  const failWith = (reason: unknown, title: string) =>
    setActionError(presentRemoteError(reason, { explicit: true }), title);
  const refreshAccepted = () => refreshHost().catch(() => undefined);

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
      setDraft(null);
      setSelectedId(automationKey(saved));
      setActionError(null);
      if (saved.host) await refreshAccepted();
    } catch (reason: unknown) {
      failWith(reason, t("Could not save the automation."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const onRun = async (automation: Automation) => {
    const key = automationKey(automation);
    if (runningRef.current.has(key)) return;
    runningRef.current.add(key);
    setRunning(key);
    try {
      if (automation.host) {
        await runHostAutomationNow(automation);
        await refreshAccepted();
        return;
      }
      const run = await createManualAutomationRun(automation.id);
      await onLaunch(automation, run);
    } catch (reason: unknown) {
      failWith(reason, t("Could not run the automation."));
    } finally {
      runningRef.current.delete(key);
      const remaining = [...runningRef.current].pop() ?? null;
      setRunning((current) => (current === key ? remaining : current));
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
      runningRef.current.has(automationKey(automation)) ||
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
      failWith(reason, t("Could not delete the automation."));
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
        try {
          await setHostAutomationEnabled(automation, enabled);
        } catch (reason: unknown) {
          // A refused guard means the list is stale; show the Host's current copy.
          await refreshHost().catch(() => undefined);
          throw reason;
        }
        await refreshHost();
        return;
      }
      await setAutomationEnabled(automation, enabled);
    } catch (reason: unknown) {
      failWith(reason, t("Could not update the automation."));
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
    actionErrorTitle,
    setActionError,
    onSave,
    onRun,
    onDelete,
    onToggle,
    confirmDiscard,
  };
}
