import { useAutomationRoutingHost } from "./useAutomationRoutingHost";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { t } from "../../../shared/i18n";
import { looksLikeProject, type RecentProject } from "../../projects/model/recents";
import {
  defaultSessionChoice,
  firstEnabledHarness,
  modelsFor,
  preferredModelId,
} from "../../sessions/model/models";
import {
  draftFromTemplate,
  newAutomationDraft,
  type Automation,
  type AutomationDraft,
} from "../model/automations";
import type { AutomationTemplate } from "../model/automationTemplates";

type Params = {
  cwd?: string;
  recents: readonly RecentProject[];
  selected: Automation | null;
  /** Set while a save is in flight; starting a draft is ignored then. */
  savingRef: MutableRefObject<boolean>;
  setPickerOpen: Dispatch<SetStateAction<boolean>>;
  setCompactListOpen: Dispatch<SetStateAction<boolean>>;
  setDraft: Dispatch<SetStateAction<AutomationDraft | null>>;
};

/** Starts a new automation: back to the template picker, a blank draft or one from a template. */
export function useAutomationDraftStart({
  cwd,
  recents,
  selected,
  savingRef,
  setPickerOpen,
  setCompactListOpen,
  setDraft,
}: Params) {
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

  const beginCreate = () => {
    if (savingRef.current) return;
    setCompactListOpen(false);
    setPickerOpen(true);
    setDraft(null);
  };

  const beginBlank = () => {
    if (savingRef.current) return;
    const { project, harness, model } = defaultDraftTarget();
    setPickerOpen(false);
    setDraft({
      ...newAutomationDraft(project, harness, model),
      ...(routingHost.supported ? { modelChoice: { kind: "default" as const } } : {}),
    });
  };

  const beginFromTemplate = (template: AutomationTemplate) => {
    if (savingRef.current) return;
    const { project, harness, model } = defaultDraftTarget();
    setPickerOpen(false);
    setDraft({
      ...draftFromTemplate(project, harness, model, {
        ...template,
        name: t(template.name),
        prompt: t(template.prompt),
      }),
      ...(routingHost.supported ? { modelChoice: { kind: "default" as const } } : {}),
    });
  };

  return { beginCreate, beginBlank, beginFromTemplate };
}
