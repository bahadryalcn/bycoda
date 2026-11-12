import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../shared/ui/Popover";
import { TAB_GROUP_COLORS } from "../../workspace/model/tabGroups";
import { ProjectIconPicker } from "../../projects/ui/ProjectIconPicker";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { projectMascot } from "../../projects/model/projectMascots";
import { crewColor, type CrewAppearance } from "../model/crewAppearance";
import { CrewAvatar } from "./CrewAvatar";

const QUICK_ICONS = [
  "weave",
  "bridge",
  "terminal",
  "api",
  "shield",
  "lab",
  "launch",
  "tools",
  "chart",
  "docs",
] as const;

/** The crew's avatar as a button; icon and color are optional and live in a popover. */
export function CrewAppearancePicker({
  crewId,
  look,
  onChange,
  disabled,
}: {
  crewId: string;
  look: CrewAppearance;
  onChange: (patch: CrewAppearance) => void;
  disabled?: boolean;
}) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [moreIcons, setMoreIcons] = useState(false);
  const color = crewColor(look);
  return (
    <>
      <Button
        ref={trigger}
        variant="secondary"
        iconOnly
        label={t("Crew icon and color")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="shrink-0"
      >
        <CrewAvatar crew={{ id: crewId }} look={look} className="icon-lg" />
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          side="bottom"
          align="start"
          width={288}
          constrainHeight
          onDismiss={() => setOpen(false)}
          role="dialog"
          aria-label={t("Crew icon and color")}
          className="bycoda-arc overflow-y-auto overscroll-contain"
        >
          <div className="flex flex-col gap-2 p-2">
            <div className="flex flex-wrap gap-[calc(var(--space-1)/2)]">
              <RadioGroup
                variant="tiles"
                label={t("Crew icon")}
                value={look.icon ?? ""}
                onValueChange={(icon) => onChange({ icon })}
                tile={{ motion: "none" }}
                className="flex flex-wrap gap-[calc(var(--space-1)/2)]"
                options={QUICK_ICONS.map((icon) => ({
                  value: icon,
                  iconOnly: true,
                  ariaLabel: projectMascot(crewId, icon).label,
                  content: (
                    <ProjectMascot project={crewId} name={icon} color={color} className="icon-md" />
                  ),
                }))}
              />
              <Button
                variant="ghost"
                motion="none"
                aria-expanded={moreIcons}
                onClick={() => setMoreIcons((value) => !value)}
              >
                {t("More icons")}
              </Button>
            </div>
            {moreIcons ? (
              <ProjectIconPicker
                project={crewId}
                name={look.icon ?? null}
                color={color}
                onPick={(icon) => onChange({ icon: icon ?? undefined })}
              />
            ) : null}
            <ColorSwatchRow
              colors={TAB_GROUP_COLORS}
              colorIndex={look.color ?? 0}
              onPickIndex={(index) => onChange({ color: index || undefined })}
            />
          </div>
        </Popover>
      ) : null}
    </>
  );
}
