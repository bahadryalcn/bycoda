import { useId } from "react";
import { t } from "../../../../shared/i18n";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { Select } from "../../../../shared/ui/Select";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { Row } from "../../../../shared/ui/settings";
import styles from "./settings.module.css";
import { DEFAULT_CRITICAL_EXCLUSIONS } from "./assistantAccess";

const exclusions = () =>
  [
    ["pushMain", t("Push to main")],
    ["deleteProject", t("Delete projects")],
    ["deleteSession", t("Delete conversations")],
    ["sendMessages", t("Send messages")],
    ["computerUse", t("Computer use")],
    ["spend", t("Spend money")],
  ] as const;

/** Explicit owner policy. Profile is a mirror; native grants are saved before it. */
export function AssistantStandingConsentFields({
  value,
  onChange,
  projects,
  pending,
}: {
  value: AssistantProfilePatch;
  onChange: (patch: AssistantProfilePatch) => void;
  projects: readonly { id?: string; name: string; path: string }[];
  /** The owner's save is running; the choices wait for it. */
  pending: boolean;
}) {
  const authorityId = useId();
  return (
    <>
      <Row
        label={t("Assistant authority")}
        controlId={authorityId}
        info={
          <InfoPopover label={`${t("Assistant authority")}: ${t("Help")}`}>
            {t(
              "Applies to this workspace and the selected Host. Coding conversations keep their own permissions.",
            )}
          </InfoPopover>
        }
      >
        <Select
          id={authorityId}
          label={t("Assistant authority")}
          hideLabel
          value={value.permissionLevel ?? "legacy"}
          disabled={pending}
          onValueChange={(permissionLevel) =>
            onChange({
              permissionLevel: permissionLevel as AssistantProfilePatch["permissionLevel"],
            })
          }
          options={[
            // "Not set" is only listed while it is the current value.
            ...(value.permissionLevel
              ? []
              : [{ value: "legacy", label: t("Not set"), disabled: true }]),
            { value: "ask", label: t("Ask for each operation") },
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
                  disabled={pending}
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
            {exclusions().map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                disabled={pending}
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
