import { Text } from "../../../shared/ui/Text";
import { truncateCodeUnits } from "../../../shared/lib/text/truncate";
import { useState, type ReactNode } from "react";
import { Heading } from "../../../shared/ui/Heading";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { ChevronDown, ChevronRight } from "../../../shared/ui/icons";
import type { HostModelCatalog } from "../../connections/model/protocol";
import type { CrewAgent, CrewPolicy, CrewRole } from "../model/crew";
import type { MemberAvatarTraits } from "../model/memberAvatarTraits";
import { memberTraits } from "../model/memberAvatars";
import { MemberAppearancePicker } from "./MemberAppearancePicker";
import { MemberAvatar } from "./MemberAvatar";
import { MemberHandleField } from "./MemberHandleField";
import { MemberModelSection } from "./MemberModelSection";
import { MemberToolsPicker } from "./MemberToolsPicker";

export function roleLabel(role: CrewRole) {
  return role === "coordinator"
    ? t("Coordinator")
    : role === "reviewer"
      ? t("Reviewer")
      : role === "advisor"
        ? t("Advisor")
        : t("Specialist");
}

/** Common role names; the owner can type any other. */
export function roleSuggestions(role: CrewRole): string[] {
  return role === "coordinator"
    ? [t("Project lead"), t("Tech lead"), t("Product manager")]
    : role === "reviewer"
      ? [t("Code reviewer"), t("QA reviewer"), t("Security reviewer")]
      : role === "advisor"
        ? [t("Architect"), t("Domain expert"), t("Security advisor")]
        : [
            t("Frontend developer"),
            t("Backend developer"),
            t("Mobile developer"),
            t("UI designer"),
            t("Test engineer"),
            t("Technical writer"),
          ];
}

/**
 * One member: identity (avatar, name, handle), work (responsibility, instructions, groups),
 * tools and model. The avatar is drawn from the member's seed; "Edit look" opens the picker.
 */
export function CrewMemberForm({
  cwd,
  catalog,
  agent,
  onChange,
  groups,
  identity,
  tools,
  handleError,
  traits,
  nameError,
  modelError,
  advancedExtra,
  autoFocus,
  policy,
  compact = false,
  machineId,
  projectId,
  modelPoolsSupported = false,
}: {
  cwd: string;
  catalog: HostModelCatalog;
  agent: CrewAgent;
  onChange: (patch: Partial<CrewAgent>) => void;
  /** Shown when the host keeps specialty groups. */
  groups?: boolean;
  /** Shown when the host keeps member handles and avatar choices. */
  identity?: boolean;
  /** Shown when the host enforces member tool profiles. */
  tools?: boolean;
  /** A Host refusal about the handle, shown under its field. */
  handleError?: string;
  /** The look to preview when it depends on the roster (see `teamTraits`); defaults to the member alone. */
  traits?: MemberAvatarTraits;
  /** Accepted for callers; the group field has no suggestion list. */
  groupSuggestions?: string[];
  nameError?: string;
  /** Shown under the model choice when no model is selected (save was attempted). */
  modelError?: string;
  advancedExtra?: ReactNode;
  autoFocus?: boolean;
  /** The crew's working limits, when the member belongs to a crew; used to say what applies. */
  policy?: CrewPolicy;
  /** Inside a roster row: the row already edits the role and the pinned model. */
  compact?: boolean;
  /** The machine whose Host keeps model pools (`data.machine.id`); without it automatic members list their own models. */
  machineId?: string;
  /** The Host's project (`data.project.id`); with `machineId` it lists the Host tools a member can be limited to. */
  projectId?: string;
  /** `data.modelPoolsSupported`. */
  modelPoolsSupported?: boolean;
}) {
  useLocale();
  const [advanced, setAdvanced] = useState(false);
  const [editLook, setEditLook] = useState(false);
  const suggestions = agent.name.trim()
    ? []
    : roleSuggestions(agent.role).filter((name) => name !== agent.name);
  const look = traits ?? memberTraits(agent);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-label={t("Identity")} className="flex min-w-0 flex-col gap-2">
        <Heading size="section" level={3}>
          {t("Identity")}
        </Heading>
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          {identity ? (
            <div className="flex shrink-0 flex-col items-center gap-1">
              <MemberAvatar traits={look} size={56} label={t("Member appearance preview")} />
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={editLook}
                onClick={() => setEditLook((value) => !value)}
              >
                {t("Edit look")}
              </Button>
            </div>
          ) : null}
          <div className="min-w-48 flex-1">
            <TextField
              label={t("Member name")}
              placeholder={t("e.g. Frontend developer")}
              value={agent.name}
              autoFocus={autoFocus}
              error={nameError}
              maxLength={200}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </div>
          {identity ? (
            <div className="min-w-36 flex-1">
              <MemberHandleField
                value={agent.handle}
                hostError={handleError}
                onChange={(handle) => onChange({ handle })}
              />
            </div>
          ) : null}
        </div>
        {suggestions.length ? (
          <div role="group" aria-label={t("Suggested roles")} className="flex flex-wrap gap-1">
            {suggestions.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="secondary"
                shape="pill"
                onClick={() => onChange({ name })}
              >
                {name}
              </Button>
            ))}
          </div>
        ) : null}
        {identity && editLook ? (
          <MemberAppearancePicker
            traits={look}
            chosen={!!agent.avatar}
            onChange={(avatar) => onChange({ avatar })}
          />
        ) : null}
      </section>
      <section aria-label={t("Work")} className="flex min-w-0 flex-col gap-3">
        <Heading size="section" level={3}>
          {t("Work")}
        </Heading>
        {compact ? null : (
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <Text size="body" tone="inherit" weight="medium">
              {t("Responsibility in the crew")}
            </Text>
            <RadioGroup
              variant="inline"
              label={t("Responsibility in the crew")}
              value={agent.role}
              options={(["coordinator", "specialist", "reviewer", "advisor"] as const).map(
                (role) => ({ value: role, label: roleLabel(role) }),
              )}
              onValueChange={(role) => onChange({ role: role as CrewRole })}
            />
          </div>
        )}
        <TextareaField
          label={t("Instructions")}
          placeholder={t("e.g. Build accessible screens and follow the design system.")}
          value={agent.instructions}
          rows={3}
          onChange={(event) => onChange({ instructions: event.target.value })}
        />
        {groups ? (
          <TagInput
            label={t("Groups")}
            placeholder={t("UI, Mobile, Backend…")}
            value={agent.groups ?? []}
            normalize={(values) => [
              ...new Set(
                values.map((value) => truncateCodeUnits(value.trim(), 40)).filter(Boolean),
              ),
            ]}
            maxTags={12}
            onValueChange={(next) => onChange({ groups: next.length ? next : undefined })}
          />
        ) : null}
      </section>
      {tools ? (
        <MemberToolsPicker
          value={agent.tools}
          onChange={(next) => onChange({ tools: next })}
          cwd={cwd}
          machineId={machineId}
          projectId={projectId}
        />
      ) : null}
      <MemberModelSection
        cwd={cwd}
        catalog={catalog}
        agent={agent}
        onChange={onChange}
        machineId={machineId}
        modelPoolsSupported={modelPoolsSupported}
        policy={policy}
        compact={compact}
        modelError={modelError}
      />
      {advancedExtra ? (
        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="ghost"
            motion="none"
            aria-expanded={advanced}
            startIcon={advanced ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            onClick={() => setAdvanced((value) => !value)}
            className="self-start"
          >
            {t("More options")}
          </Button>
          {advanced ? advancedExtra : null}
        </div>
      ) : null}
    </div>
  );
}
