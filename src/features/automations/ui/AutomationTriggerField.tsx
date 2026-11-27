import { t, useLocale } from "../../../shared/i18n";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Alert } from "../../../shared/ui/Alert";
import { FieldGroup } from "../../../shared/ui/FieldGroup";
import { NumberField } from "../../../shared/ui/NumberField";
import { SearchableSelect, type SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import { Text } from "../../../shared/ui/Text";
import { X } from "../../../shared/ui/icons";
import type { RemoteMachine } from "../../connections/public/protocol";
import { describeRemoteError } from "../../connections/public/remoteFailure";
import { useProviderConnections } from "../../inbox/public/providerConnections";
import {
  MAX_LOCAL_TRIGGERS,
  withAddedTrigger,
  withHostTrigger,
  withoutTriggers,
  type HostTrigger,
} from "../model/automationDraftRules";
import { TRIGGER_CATEGORIES, TRIGGER_EVENTS } from "../model/automationTriggerCatalog";
import {
  applyTriggers,
  createAutomationTrigger,
  type AutomationDraft,
  type AutomationTrigger,
  type AutomationTriggerKind,
} from "../model/automations";
import { TriggerMark, TriggerRow } from "./TriggerEditor";
import { useHostCapabilities } from "./useHostCapabilities";

const HOST_TRIGGERS_CAPABILITY = "automations.triggers.v1";
const HOST_EVENT_PREFIX = "host:event:";
const HOST_CONTINUOUS = "host:continuous";

type HostEvent = Extract<HostTrigger, { kind: "event" }>["event"];

const HOST_EVENTS: readonly { value: HostEvent; label: () => string }[] = [
  { value: "task.finished", label: () => t("Task finished") },
  { value: "task.blocked", label: () => t("Task blocked") },
  { value: "session.waiting", label: () => t("Session waiting") },
  { value: "automation.failed", label: () => t("Automation failed") },
];

/**
 * The automation's one trigger control: its triggers as sentences, and one searchable list to add
 * the next. A background draft holds exactly one time trigger or Host event, so the list only
 * offers those and disappears once one is set.
 */
export function AutomationTriggerField({
  draft,
  machine,
  onChange,
}: {
  draft: AutomationDraft;
  /** The machine whose Host would run this draft. */
  machine?: RemoteMachine;
  onChange: (draft: AutomationDraft) => void;
}) {
  useLocale();
  const { connections: providerConnected } = useProviderConnections();
  const capabilities = useHostCapabilities(machine);
  const hostTriggers = capabilities.data?.includes(HOST_TRIGGERS_CAPABILITY) === true;
  const background = draft.runInBackground;
  const providerReady = (kind: AutomationTriggerKind) => {
    if (kind === "time" || kind === "tasks" || kind === "social") return true;
    // Never-read status stays disabled; a rejected read keeps the last-known value
    // instead of inferring revocation. Host validation still gates the trigger.
    return providerConnected[kind] === true;
  };
  const options: SearchableSelectOption[] = [
    ...TRIGGER_CATEGORIES.filter((category) => !background || category.value === "time").flatMap(
      (category) =>
        TRIGGER_EVENTS[category.value].map((event) => ({
          value: `${category.value}:${event.value}`,
          label: event.label,
          keywords: category.label,
          description: providerReady(category.value)
            ? category.label
            : t("Connect {p0} in Settings", { p0: category.label }),
          disabled: !providerReady(category.value),
        })),
    ),
    ...(machine && hostTriggers && (!draft.id || background)
      ? [
          {
            value: HOST_CONTINUOUS,
            label: t("Continuous"),
            description: t("Scheduled"),
          },
          ...HOST_EVENTS.map((event) => ({
            value: HOST_EVENT_PREFIX + event.value,
            label: event.label(),
            description: t("Tasks"),
          })),
        ]
      : []),
  ];
  const add = (value: string) => {
    if (value === HOST_CONTINUOUS) {
      onChange(withHostTrigger(draft, { kind: "continuous", minimumGapMinutes: 30 }));
    } else if (value.startsWith(HOST_EVENT_PREFIX)) {
      onChange(
        withHostTrigger(draft, {
          kind: "event",
          event: value.slice(HOST_EVENT_PREFIX.length) as HostEvent,
        }),
      );
    } else {
      const option = options.find((entry) => entry.value === value);
      if (!option || option.disabled) return;
      const [kind, event] = value.split(":") as [AutomationTriggerKind, string];
      onChange(withAddedTrigger(draft, createAutomationTrigger(kind, event)));
    }
  };
  const update = (next: AutomationTrigger) =>
    onChange(
      applyTriggers(
        draft,
        draft.triggers.map((trigger) => (trigger.id === next.id ? next : trigger)),
      ),
    );
  const remove = (id: string) =>
    onChange(
      applyTriggers(
        draft,
        draft.triggers.filter((trigger) => trigger.id !== id),
      ),
    );
  const full = background
    ? draft.hostTrigger !== undefined || draft.triggers.length > 0
    : draft.triggers.length >= MAX_LOCAL_TRIGGERS;
  const eventsInApp = draft.triggers.some(
    (trigger) => trigger.kind === "tasks" || trigger.kind === "social",
  );
  return (
    <FieldGroup
      legend={t("Trigger")}
      gap="sm"
      description={
        eventsInApp
          ? t(
              "Task and social events run while this app is open. Connect the source machine; social accounts must be linked to this project.",
            )
          : undefined
      }
    >
      {draft.hostTrigger ? (
        <HostTriggerRow
          trigger={draft.hostTrigger}
          onChange={(hostTrigger) => onChange({ ...draft, hostTrigger })}
          onRemove={() => onChange(withoutTriggers(draft))}
        />
      ) : draft.triggers.length > 0 ? (
        <ul className="min-w-0">
          {draft.triggers.map((trigger) => (
            <li key={trigger.id}>
              <TriggerRow
                trigger={trigger}
                cwd={draft.cwd}
                background={background}
                machineId={machine?.id}
                onChange={update}
                onRemove={() => remove(trigger.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {full ? null : (
        <SearchableSelect
          hideLabel
          label={t("Add trigger")}
          value=""
          options={options}
          onChange={add}
          placeholder={t("Add a trigger")}
          searchPlaceholder={t("Search triggers")}
        />
      )}
      {background && capabilities.error ? (
        <Alert tone="warning">{describeRemoteError(capabilities.error).message}</Alert>
      ) : null}
    </FieldGroup>
  );
}

function HostTriggerRow({
  trigger,
  onChange,
  onRemove,
}: {
  trigger: HostTrigger;
  onChange: (trigger: HostTrigger) => void;
  onRemove: () => void;
}) {
  useLocale();
  return (
    <ActionHost
      controlMinHeight="large"
      padding={{ inline: "md", block: "xs" }}
      className="-mx-2 min-w-0 items-start gap-2.5"
    >
      <TriggerMark
        kind={trigger.kind === "event" ? "tasks" : "time"}
        className="icon-sm shrink-0"
        tone="muted"
      />
      <Text
        as="div"
        size="secondary"
        tone="neutral"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1"
      >
        {trigger.kind === "continuous" ? (
          <NumberField
            label={t("Minimum gap (minutes)")}
            min={1}
            max={10080}
            value={trigger.minimumGapMinutes}
            onChange={(event) =>
              onChange({ kind: "continuous", minimumGapMinutes: Number(event.target.value) })
            }
          />
        ) : (
          <SearchableSelect
            hideLabel
            variant="pill"
            searchable={false}
            label={t("Event")}
            value={trigger.event}
            options={HOST_EVENTS.map((event) => ({ value: event.value, label: event.label() }))}
            onChange={(event) => onChange({ kind: "event", event: event as HostEvent })}
          />
        )}
      </Text>
      <InlineAction label={t("Remove trigger")} onClick={onRemove}>
        <X />
      </InlineAction>
    </ActionHost>
  );
}
