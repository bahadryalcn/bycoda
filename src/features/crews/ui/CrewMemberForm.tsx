import { truncateCodeUnits } from "../../../shared/lib/text/truncate";
import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Disclosure } from "../../../shared/ui/Disclosure";
import type { CrewAgent, CrewRole } from "../model/crew";
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
 * One member: name, role, model and instructions up front. Handle, groups, tools, look and
 * reviews are rare and sit under one More options. The avatar is drawn from the member's seed;
 * the owner only changes it there.
 */
export function CrewMemberForm({
  cwd,
  agent,
  onChange,
  groups,
  identity,
  tools,
  handleError,
  traits,
  nameError,
  modelError,
  reviews,
  onMoreOpen,
  autoFocus,
  machineId,
  projectId,
  modelPoolsSupported = false,
}: {
  cwd: string;
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
  nameError?: string;
  /** Shown under the model choice when no model is selected (save was attempted). */
  modelError?: string;
  /** The member's reviews section, for a member of a stored crew. */
  reviews?: ReactNode;
  /** Called when More options open, so the reviews load only for a member the owner looks into. */
  onMoreOpen?: () => void;
  autoFocus?: boolean;
  /** The machine whose Host keeps model pools (`data.machine.id`); without it automatic members list their own models. */
  machineId?: string;
  /** The Host's project (`data.project.id`); with `machineId` it lists the Host tools a member can be limited to. */
  projectId?: string;
  /** `data.modelPoolsSupported`. */
  modelPoolsSupported?: boolean;
}) {
  useLocale();
  const [more, setMore] = useState(false);
  const suggestions = agent.name.trim()
    ? []
    : roleSuggestions(agent.role).filter((name) => name !== agent.name);
  const look = traits ?? memberTraits(agent);
  const hasMore = !!identity || !!groups || !!tools || !!reviews;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <TextField
          label={t("Member name")}
          placeholder={t("e.g. Frontend developer")}
          value={agent.name}
          autoFocus={autoFocus}
          error={nameError}
          maxLength={200}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {suggestions.length ? (
          <div role="group" aria-label={t("Suggested roles")} className="flex flex-wrap gap-1">
            {suggestions.map((name) => (
              <Button key={name} size="sm" variant="ghost" onClick={() => onChange({ name })}>
                {name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <RadioGroup
        variant="inline"
        label={t("Role")}
        value={agent.role}
        options={(["coordinator", "specialist", "reviewer", "advisor"] as const).map((role) => ({
          value: role,
          label: roleLabel(role),
        }))}
        onValueChange={(role) => onChange({ role: role as CrewRole })}
      />
      <MemberModelSection
        cwd={cwd}
        agent={agent}
        onChange={onChange}
        machineId={machineId}
        modelPoolsSupported={modelPoolsSupported}
        modelError={modelError}
      />
      <TextareaField
        label={t("Instructions")}
        placeholder={t("e.g. Build accessible screens and follow the design system.")}
        value={agent.instructions}
        rows={3}
        onChange={(event) => onChange({ instructions: event.target.value })}
      />
      {hasMore ? (
        <Disclosure
          variant="compact"
          summary={t("More options")}
          open={more}
          onOpenChange={(open) => {
            setMore(open);
            if (open) onMoreOpen?.();
          }}
        >
          <div className="flex min-w-0 flex-col gap-4 pt-1">
            {identity ? (
              <MemberHandleField
                value={agent.handle}
                hostError={handleError}
                onChange={(handle) => onChange({ handle })}
              />
            ) : null}
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
            {tools ? (
              <MemberToolsPicker
                value={agent.tools}
                onChange={(next) => onChange({ tools: next })}
                cwd={cwd}
                machineId={machineId}
                projectId={projectId}
              />
            ) : null}
            {identity ? (
              <section
                aria-label={t("Appearance")}
                className="flex min-w-0 flex-wrap items-start gap-3"
              >
                <MemberAvatar traits={look} size={56} label={t("Member appearance preview")} />
                <div className="min-w-0 flex-1 basis-64">
                  <MemberAppearancePicker
                    traits={look}
                    chosen={!!agent.avatar}
                    onChange={(avatar) => onChange({ avatar })}
                  />
                </div>
              </section>
            ) : null}
            {reviews}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}
