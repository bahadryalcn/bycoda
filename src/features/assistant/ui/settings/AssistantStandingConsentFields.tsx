import { t } from "../../../../shared/i18n";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { Select } from "../../../../shared/ui/Select";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Row } from "../../../settings/public/settingsControls";
import styles from "./settings.module.css";

export const DEFAULT_CRITICAL_EXCLUSIONS = [
  "pushMain",
  "deleteProject",
  "deleteSession",
  "sendMessages",
  "computerUse",
  "spend",
] as const;
const exclusions = [
  ["pushMain", "Push to main"],
  ["deleteProject", "Delete projects"],
  ["deleteSession", "Delete conversations"],
  ["sendMessages", "Send messages"],
  ["computerUse", "Computer use"],
  ["spend", "Spend money"],
] as const;

/** Explicit owner policy. Profile is a mirror; native grants are saved before it. */
export function AssistantStandingConsentFields({
  value,
  onChange,
  projects,
  disabled,
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
  projects: readonly { id?: string; name: string; path: string }[];
  disabled: boolean;
}) {
  return (
    <>
      <Row
        label={t("Assistant authority")}
        description={t(
          "Native consent applies to this workspace and selected Host. Coding conversations keep their own permissions.",
        )}
        stacked
      >
        <Select
          label={t("Assistant authority")}
          value={value.permissionLevel ?? "legacy"}
          disabled={disabled}
          onValueChange={(permissionLevel) =>
            onChange({
              permissionLevel: permissionLevel as AssistantProfilePatch["permissionLevel"],
            })
          }
          options={[
            { value: "legacy", label: t("Ask for each operation"), disabled: true },
            { value: "watch", label: t("Watch") },
            { value: "projects", label: t("Selected projects") },
            { value: "everything", label: t("Everything") },
          ]}
        />
      </Row>
      {value.permissionLevel === "projects" && (
        <Row label={t("Selected projects")} stacked>
          <div className={styles.consentChoices}>
            {projects
              .filter((project) => project.id)
              .map((project) => (
                <Checkbox
                  key={project.id}
                  label={project.name}
                  disabled={disabled}
                  checked={(value.permissionProjectIds ?? []).includes(project.id!)}
                  onChange={(event) =>
                    onChange({
                      permissionProjectIds: event.target.checked
                        ? [...(value.permissionProjectIds ?? []), project.id!]
                        : (value.permissionProjectIds ?? []).filter((id) => id !== project.id),
                    })
                  }
                />
              ))}
          </div>
        </Row>
      )}
      {value.permissionLevel && (
        <Row label={t("Always ask for approval")} stacked>
          <div className={styles.consentChoices}>
            {exclusions.map(([key, label]) => (
              <Checkbox
                key={key}
                label={t(label)}
                description={t("Always ask for approval")}
                disabled={disabled}
                checked={(value.criticalExclusions ?? DEFAULT_CRITICAL_EXCLUSIONS).includes(key)}
                onChange={(event) =>
                  onChange({
                    criticalExclusions: event.target.checked
                      ? [...(value.criticalExclusions ?? DEFAULT_CRITICAL_EXCLUSIONS), key]
                      : (value.criticalExclusions ?? DEFAULT_CRITICAL_EXCLUSIONS).filter(
                          (item) => item !== key,
                        ),
                  })
                }
              />
            ))}
          </div>
        </Row>
      )}
    </>
  );
}
