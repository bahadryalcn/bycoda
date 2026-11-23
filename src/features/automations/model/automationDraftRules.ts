import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import { parseRemotePath } from "../../connections/public/remoteProjects";
import { resolveTaskTitle } from "../../tasks/public/taskTitle";
import {
  applyTriggers,
  createAutomationTrigger,
  type AutomationDraft,
  type AutomationTrigger,
} from "./automations";
import type { AutomationTemplate } from "./automationTemplates";
import type { HostAutomationInput } from "./hostAutomations";

/** Where an unset missed-run grace starts: twelve hours. */
export const DEFAULT_MISSED_RUN_GRACE_MINUTES = 720;
export const MAX_LOCAL_TRIGGERS = 20;
/** Native names are capped in bytes, so a derived name stays well below that for any script. */
const DERIVED_NAME_LIMIT = 60;

export type HostTrigger = NonNullable<HostAutomationInput["trigger"]>;

type RunModeFields = Pick<AutomationDraft, "cwd" | "hostTrigger" | "hostTemplate">;

/**
 * Whether only a Host can run this draft: a project on another machine, no project at all, or a
 * trigger or template that exists only on the Host. Everything else runs in the app unless the
 * owner turns background runs on.
 */
export function backgroundRequired(draft: RunModeFields): boolean {
  return (
    Boolean(parseRemotePath(draft.cwd)) ||
    !draft.cwd ||
    draft.hostTrigger !== undefined ||
    draft.hostTemplate !== undefined
  );
}

/**
 * The draft after an edit, with its run mode and triggers made consistent. A saved automation
 * keeps the mode it was stored with. A new draft follows its project, trigger and template when
 * only a Host can run them, and keeps the owner's own background choice otherwise. A Host runs
 * exactly one time trigger or one Host event, so a background draft never keeps more than that
 * and cannot become unsavable.
 */
export function resolveRunMode(
  previous: Pick<AutomationDraft, "id" | "runInBackground">,
  next: AutomationDraft,
): AutomationDraft {
  const runInBackground = next.id
    ? previous.runInBackground
    : backgroundRequired(next) || next.backgroundChosen === true;
  return limitedToHostTriggers(
    runInBackground === next.runInBackground ? next : { ...next, runInBackground },
  );
}

/** The owner's own choice to keep running when the app is closed. */
export function withBackgroundChoice(
  draft: AutomationDraft,
  runInBackground: boolean,
): AutomationDraft {
  return limitedToHostTriggers({ ...draft, runInBackground, backgroundChosen: runInBackground });
}

function limitedToHostTriggers(draft: AutomationDraft): AutomationDraft {
  if (!draft.runInBackground || draft.hostTrigger) return draft;
  const time = draft.triggers.find((trigger) => trigger.kind === "time");
  const kept = time ? [time] : [];
  return draft.triggers.length === kept.length ? draft : applyTriggers(draft, kept);
}

/** A background draft holds exactly one time trigger or one Host event. */
export function backgroundTriggerReady(
  draft: Pick<AutomationDraft, "hostTrigger" | "triggers">,
): boolean {
  return (
    draft.hostTrigger !== undefined ||
    (draft.triggers.length === 1 && draft.triggers[0].kind === "time")
  );
}

/** Replaces every trigger with one Host trigger. */
export function withHostTrigger(draft: AutomationDraft, hostTrigger: HostTrigger): AutomationDraft {
  return resolveRunMode(draft, applyTriggers({ ...draft, hostTrigger }, []));
}

/** Drops the Host trigger and all other triggers; the owner adds the next one. */
export function withoutTriggers(draft: AutomationDraft): AutomationDraft {
  return resolveRunMode(draft, applyTriggers({ ...draft, hostTrigger: undefined }, []));
}

/** Adds a time or event trigger; a background draft swaps its single trigger instead. */
export function withAddedTrigger(
  draft: AutomationDraft,
  trigger: AutomationTrigger,
): AutomationDraft {
  const triggers = draft.runInBackground ? [trigger] : [...draft.triggers, trigger];
  return resolveRunMode(
    draft,
    applyTriggers({ ...draft, hostTrigger: undefined }, triggers.slice(0, MAX_LOCAL_TRIGGERS)),
  );
}

/**
 * The template's instructions and trigger on top of the draft. The project, model and limits the
 * owner already chose stay; the Host-only Project scan template switches a new draft to background.
 */
export function withTemplate(
  draft: AutomationDraft,
  template: Pick<AutomationTemplate, "id" | "name" | "prompt" | "trigger">,
): AutomationDraft {
  const { kind, event, ...schedule } = template.trigger;
  return resolveRunMode(
    draft,
    applyTriggers(
      {
        ...draft,
        name: template.name,
        prompt: template.prompt,
        hostTrigger: undefined,
        hostTemplate:
          template.id === "project-scan"
            ? { kind: "project-scan", sourceStewardId: "new" }
            : undefined,
      },
      [createAutomationTrigger(kind, event, schedule)],
    ),
  );
}

/** The stored name: the owner's, else the first meaningful instruction line. */
export function automationName(draft: Pick<AutomationDraft, "name" | "prompt">): string {
  const explicit = draft.name.trim();
  if (explicit) return explicit;
  return truncateGraphemes(resolveTaskTitle("", draft.prompt), DERIVED_NAME_LIMIT, "").trim();
}
