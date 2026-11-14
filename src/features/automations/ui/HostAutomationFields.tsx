import { useQuery } from "@tanstack/react-query";

import { t } from "../../../shared/i18n";

import { SearchableSelect } from "../../../shared/ui/SearchableSelect";

import { NumberField } from "../../../shared/ui/NumberField";

import { Alert } from "../../../shared/ui/Alert";

import { machineCapabilities } from "../model/machineSnapshot";

import { backgroundMachineFor } from "../model/hostAutomationClient";

import type { AutomationDraft } from "../model/automations";

import type { RemoteMachine } from "../../connections";

export function HostAutomationFields({
  draft,
  machines,
  onChange,
}: {
  draft: AutomationDraft;

  machines: readonly RemoteMachine[];

  onChange: (draft: AutomationDraft) => void;
}) {
  const machine =
    machines.find((entry) => entry.id === draft.hostMachineId) ??
    backgroundMachineFor(machines, draft.cwd);

  const query = useQuery({
    queryKey: ["automation-host-capabilities", machine?.id],

    queryFn: () => machineCapabilities(machine!),
    enabled: !!machine,
    staleTime: 30_000,
    retry: false,
  });

  const capabilities = query.data ?? [];

  const room = capabilities.includes("automations.room.v1");

  const triggers = capabilities.includes("automations.triggers.v1");

  const kind = draft.hostTrigger?.kind ?? "scheduled";

  return (
    <div className="grid min-w-0 gap-3">
      <SearchableSelect
        label={t("Machine")}
        value={machine?.id ?? ""}
        disabled={!!draft.id || !!draft.cwd}

        options={machines.map((entry) => ({ value: entry.id, label: entry.name }))}

        onChange={(hostMachineId) => onChange({ ...draft, hostMachineId })}
      />

      <SearchableSelect
        label={t("Scope")}
        value={draft.cwd ? "project" : "general"}
        disabled={!!draft.id || !!draft.hostTemplate}

        options={[
          { value: "project", label: t("Project") },
          { value: "general", label: t("General"), disabled: !room },
        ]}

        onChange={(value) =>
          onChange({ ...draft, cwd: value === "general" ? "" : "~", hostMachineId: machine?.id })
        }
      />

      <SearchableSelect
        label={t("Triggers")}
        value={kind}
        disabled={!!draft.hostTemplate}

        options={[
          { value: "scheduled", label: t("Schedule") },
          { value: "continuous", label: t("Continuous"), disabled: !triggers },
          { value: "event", label: t("Event"), disabled: !triggers },
        ]}

        onChange={(value) =>
          onChange({
            ...draft,
            hostTrigger:
              value === "continuous"
                ? { kind: "continuous", minimumGapMinutes: 30 }
                : value === "event"
                  ? { kind: "event", event: "task.finished" }
                  : undefined,
          })
        }
      />

      {draft.hostTrigger?.kind === "continuous" ? (
        <NumberField
          label={t("Minimum gap (minutes)")}
          min={1}
          max={10080}

          value={draft.hostTrigger.minimumGapMinutes}
          onChange={(event) =>
            onChange({
              ...draft,
              hostTrigger: { kind: "continuous", minimumGapMinutes: Number(event.target.value) },
            })
          }
        />
      ) : null}

      {draft.hostTrigger?.kind === "event" ? (
        <SearchableSelect
          label={t("Event")}
          value={draft.hostTrigger.event}

          options={["task.finished", "task.blocked", "session.waiting", "automation.failed"].map(
            (value) => ({ value, label: value }),
          )}

          onChange={(event) =>
            onChange({
              ...draft,
              hostTrigger: {
                kind: "event",
                event: event as
                  | "task.finished"
                  | "task.blocked"
                  | "session.waiting"
                  | "automation.failed",
              },
            })
          }
        />
      ) : null}

      {query.error ? <Alert tone="warning">{String(query.error)}</Alert> : null}
    </div>
  );
}
