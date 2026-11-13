import { Text } from "../../../../shared/ui/Text";
import { getLocale, t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Folder, Laptop } from "../../../../shared/ui/icons";
import { SearchableSelect } from "../../../../shared/ui/SearchableSelect";
import { StatusDot } from "../../../../shared/ui/StatusDot";
import { isLocalSyncMachine } from "../../../connections/public/localSync";
import type { HostProject, RemoteMachine } from "../../../connections/public/protocol";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason, gateProps } from "../common/DisabledReason";
import { parseWorkspaceValue, workspaceValue, type WorkspaceChoice } from "./workspaceSelection";

export type SocialShellBarProps = {
  client: SocialClient | null;
  machines: RemoteMachine[];
  machineId: string;
  projects: HostProject[];
  projectId?: string;
  aiStopped: boolean;
  hostOnline?: boolean;
  loading?: boolean;
  onWorkspaceChange: (choice: WorkspaceChoice) => void;
  onAiStateChange: (stopped: boolean) => void;
};

function computerName(machine: RemoteMachine): string {
  return isLocalSyncMachine(machine) ? t("This computer") : machine.name;
}

/** The one workspace selector (computer and project) and the global AI stop or resume. */
export function SocialShellBar({
  client,
  machines,
  machineId,
  projects,
  projectId,
  aiStopped,
  hostOnline = true,
  loading = false,
  onWorkspaceChange,
  onAiStateChange,
}: SocialShellBarProps) {
  const { confirm, dialog } = useConfirm();
  const selected = machines.find((machine) => machine.id === machineId);
  const selectedName = selected ? computerName(selected) : machineId;
  const options = [
    ...machines.map((machine) => ({
      value: workspaceValue(machine.id),
      label: `${computerName(machine)} · ${t("All projects")}`,
      icon: <Laptop className="icon-sm" aria-hidden />,
    })),
    ...projects.map((project) => ({
      value: workspaceValue(machineId, project.id),
      label: `${selectedName} · ${project.name}`,
      icon: <Folder className="icon-sm" aria-hidden />,
    })),
  ];

  // Stop is one click to confirm; resume is confirmed too. The Host decides who may resume.
  const toggleAi = () => {
    if (!client || !hostOnline || loading) return;
    const request = aiStopped
      ? {
          title: t("Resume AI?"),
          message: t(
            "AI runs planned and automatic actions again. Each account still follows its autonomy level, limits and working hours.",
          ),
          confirmLabel: t("Resume AI"),
          tone: "neutral" as const,
          onConfirm: async () => {
            const result = await client.ai.resume();
            onAiStateChange(result.aiStopped);
          },
        }
      : {
          title: t("Stop all AI?"),
          message: t(
            "AI stops every planned and automatic action on all accounts until you resume it.",
          ),
          confirmLabel: t("Stop all AI"),
          tone: "danger" as const,
          onConfirm: async () => {
            const result = await client.ai.stop();
            onAiStateChange(result.aiStopped);
          },
        };
    void confirm(request).catch(() => undefined);
  };

  return (
    <div className="social-shell-bar">
      <div className="social-shell-workspace">
        <SearchableSelect
          hideLabel
          label={t("Computer and project")}
          value={workspaceValue(machineId, projectId)}
          options={options}
          searchable={options.length > 6}
          searchPlaceholder={t("Search computers and projects…")}
          searchLocale={getLocale()}
          onChange={(value) => onWorkspaceChange(parseWorkspaceValue(value))}
        />
      </div>
      <div className="social-shell-ai">
        {loading || !hostOnline ? (
          <Badge tone="neutral" size="sm">
            {loading ? t("Checking…") : t("Host offline")}
          </Badge>
        ) : aiStopped ? (
          <Badge tone="warning" size="sm">
            {t("AI stopped")}
          </Badge>
        ) : (
          <Text
            size="secondary"
            tone="secondary"
            leading="inherit"
            className="social-shell-ai-state"
          >
            <StatusDot tone="success" />
            {t("AI active")}
          </Text>
        )}
        <DisabledReason
          variant="secondary"
          size="sm"
          tone={aiStopped ? "success" : "danger"}
          onClick={toggleAi}
          {...gateProps(
            client && hostOnline && !loading
              ? { disabled: false }
              : {
                  disabled: true,
                  disabledReason: loading
                    ? t("Checking…")
                    : !hostOnline
                      ? t("Could not reach this computer.")
                      : t("Connect a bycoda Host first."),
                },
          )}
        >
          {aiStopped ? t("Resume AI") : t("Stop all AI")}
        </DisabledReason>
      </div>
      {dialog}
    </div>
  );
}
