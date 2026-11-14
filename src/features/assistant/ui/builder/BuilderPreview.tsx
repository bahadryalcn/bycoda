import { Text } from "../../../../shared/ui/Text";
import { useMemo, useState } from "react";
import { t } from "../../../../shared/i18n";
import type { AssistantProfilePatch } from "../../../../shared/model/host-contracts/assistant";
import { Button } from "../../../../shared/ui/Button";
import { ArrowLeft, Check } from "../../../../shared/ui/icons";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { ModalActions, ModalFooter } from "../../../../shared/ui/Modal";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Surface, surfaceAttributes } from "../../../../shared/ui/Surface";
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
    <Text as="div" size="inherit" tone="inherit" leading="normal" className={styles.stage}>
      {entries.length > 0 && (
        <Text as="p" size="body" tone="inherit" leading="normal" className={styles.summary}>
          {proposal.summary}
        </Text>
      )}
      {entries.length > 0 && <SectionLabel as="h3">{t("Proposed settings")}</SectionLabel>}
      {entries.length > 0 ? (
        <Surface as="ul" variant="transparent" padding="none" className={styles.fields}>
          {entries.map((entry) => (
            <li key={entry.key} {...surfaceAttributes({ separator: "block" }, styles.field)}>
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
                    <Text size="inherit" tone="secondary" className={styles.change}>
                      <span>{entry.before}</span>
                      <span aria-hidden="true">→</span>
                      <Text
                        as="strong"
                        size="inherit"
                        tone="inherit"
                        weight="medium"
                        leading="inherit"
                      >
                        {entry.after}
                      </Text>
                    </Text>
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
        <Text as="p" size="caption" tone="secondary" leading="normal" className={styles.muted}>
          {t("The proposal matches your current settings. Nothing to change.")}
        </Text>
      )}
      <Disclosure summary={t("Avatar (optional)")}>
        <section className={styles.avatarSection} aria-label={t("Avatar")}>
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
      </Disclosure>
      <ModalFooter>
        <ModalActions
          start={
            <InfoPopover label={t("Permissions")}>
              {t(
                "Permissions stay manual: jobs and autonomy, execution access, projects and computer use are not changed here.",
              )}
            </InfoPopover>
          }
        >
          <Button
            variant="ghost"
            type="button"
            startIcon={<ArrowLeft className="icon-sm" />}
            onClick={onBack}
          >
            {t("Back to questions")}
          </Button>
          <Button
            variant="primary"
            type="button"
            startIcon={<Check className="icon-sm" />}
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
    </Text>
  );
}
