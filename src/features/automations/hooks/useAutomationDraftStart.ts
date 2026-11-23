import { useAutomationRoutingHost } from "./useAutomationRoutingHost";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/model/models";
import { newAutomationDraft, type Automation, type AutomationDraft } from "../model/automations";

type Params = {
  cwd?: string;
  recents: readonly RecentProject[];
  selected: Automation | null;
  /** Set while a save is in flight; starting a draft is ignored then. */
  savingRef: MutableRefObject<boolean>;
  setDraft: Dispatch<SetStateAction<AutomationDraft | null>>;
};

/** Starts a new blank automation draft. */
export function useAutomationDraftStart({ cwd, recents, selected, savingRef, setDraft }: Params) {
  const routingHost = useAutomationRoutingHost();
  const defaultDraftTarget = () => {
    const project = cwd && looksLikeProject(cwd) ? cwd : (recents[0]?.path ?? "~");
    const preferred = defaultSessionChoice(project);
    const harness = firstEnabledHarness(project, selected?.harness ?? preferred.harness);
    const model =
      (selected?.harness === harness ? selected.model : undefined) ??
      (preferred.harness === harness ? preferred.model : undefined) ??
      modelsFor(harness)[0]?.id ??
      preferredModelId(harness);
    return { project, harness, model };
  };

  const beginBlank = () => {
    if (savingRef.current) return;
    const { project, harness, model } = defaultDraftTarget();
    setDraft({
      ...newAutomationDraft(project, harness, model),
      hostCreateId: crypto.randomUUID(),
      ...(routingHost.supported ? { modelChoice: { kind: "default" as const } } : {}),
    });
  };

  return { beginBlank };
}
