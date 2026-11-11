import { useMemo, useState } from "react";
import { t } from "../../../../shared/i18n";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { ModalActions, ModalFooter } from "../../../../shared/ui/Modal";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Surface } from "../../../../shared/ui/Surface";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { builderEntries, builderPatch, type BuilderFieldKey } from "../../model/assistantBuilder";
import { AssistantAvatarMark } from "../AssistantAvatar";
import { AvatarGenerator } from "./AvatarGenerator";
import type { InterviewProposal } from "./useAssistantInterview";
import styles from "./AssistantBuilder.module.css";

/**
 * The designed assistant, ready to review: a summary, every proposed setting with its current and
 * proposed value (each can be unchecked, the persona edited) and an optional generated avatar.
 * Apply only hands the chosen patch to the caller's draft; saving stays with the normal form.
 */
export function BuilderPreview({
  proposal,
  current,
  onBack,
  onApply,
}: {
  proposal: InterviewProposal;
  current: AssistantProfilePatch;
  onBack: () => void;
  onApply: (patch: AssistantProfilePatch) => void;
}) {
  const entries = useMemo(
    () => builderEntries(current, proposal.profile),
    [current, proposal.profile],
  );
  const [checked, setChecked] = useState<ReadonlySet<BuilderFieldKey>>(
    () => new Set(entries.map((entry) => entry.key)),
  );
  const [persona, setPersona] = useState(proposal.profile.persona ?? "");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [useAvatar, setUseAvatar] = useState(true);
  const toggle = (key: BuilderFieldKey, on: boolean) =>
    setChecked((set) => {
      const next = new Set(set);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const nothing = checked.size === 0 && !(avatar && useAvatar);

  return (
    <div className={styles.stage}>
      <p className={styles.summary}>{proposal.summary}</p>
      <SectionLabel as="h3">{t("Proposed settings")}</SectionLabel>
      {entries.length > 0 ? (
        <Surface as="ul" variant="card" padding="none" className={styles.fields}>
          {entries.map((entry) => (
            <li key={entry.key} className={styles.field}>
              <Checkbox
                label={entry.label}
                checked={checked.has(entry.key)}
                onChange={(event) => toggle(entry.key, event.currentTarget.checked)}
                description={
                  entry.key === "persona" ? (
                    entry.before === "—" ? undefined : (
                      t("Currently: {p0}", { p0: entry.before })
                    )
                  ) : (
                    <span className={styles.change}>
                      <span>{entry.before}</span>
                      <span aria-hidden="true">→</span>
                      <strong>{entry.after}</strong>
                    </span>
                  )
                }
              />
              {entry.key === "persona" ? (
                <TextareaField
                  label={t("Persona")}
                  hideLabel
                  value={persona}
                  maxLength={2000}
                  minRows={3}
                  disabled={!checked.has("persona")}
                  onChange={(event) => setPersona(event.currentTarget.value)}
                />
              ) : null}
            </li>
          ))}
        </Surface>
      ) : (
        <p className={styles.muted}>
          {t("The proposal matches your current settings. Nothing to change.")}
        </p>
      )}
      <section className={styles.avatarSection} aria-label={t("Avatar")}>
        <SectionLabel as="h3">{t("Avatar (optional)")}</SectionLabel>
        {avatar ? (
          <div className={styles.avatarResult}>
            <AssistantAvatarMark
              className={styles.avatarPreview}
              value={avatar}
              name={proposal.profile.name ?? current.name ?? ""}
            />
            <Checkbox
              label={t("Use this avatar")}
              checked={useAvatar}
              onChange={(event) => setUseAvatar(event.currentTarget.checked)}
            />
          </div>
        ) : null}
        <AvatarGenerator
          initialPrompt={proposal.avatarPrompt ?? ""}
          onGenerated={(next) => {
            setAvatar(next);
            setUseAvatar(true);
          }}
        />
      </section>
      <ModalFooter>
        <ModalActions
          start={
            <p className={styles.note}>
              {t(
                "Permissions stay manual: jobs and autonomy, execution access, projects and computer use are not changed here.",
              )}
            </p>
          }
        >
          <Button variant="ghost" type="button" onClick={onBack}>
            {t("Back to questions")}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={nothing}
            onClick={() =>
              onApply(
                builderPatch(entries, checked, {
                  persona,
                  avatar: avatar && useAvatar ? avatar : undefined,
                }),
              )
            }
          >
            {t("Apply to settings")}
          </Button>
        </ModalActions>
      </ModalFooter>
    </div>
  );
}
