import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
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
        className="size-9 shrink-0"
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
            <div role="group" aria-label={t("Crew icon")} className="flex flex-wrap gap-0.5">
              {QUICK_ICONS.map((icon) => (
                <Button
                  key={icon}
                  variant="item"
                  motion="none"
                  iconOnly
                  label={projectMascot(crewId, icon).label}
                  aria-pressed={look.icon === icon}
                  selected={look.icon === icon}
                  onClick={() => onChange({ icon })}
                  className="grid size-7 place-items-center"
                >
                  <ProjectMascot project={crewId} name={icon} color={color} className="icon-md" />
                </Button>
              ))}
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
              customColor={null}
              customPickerOpen={false}
              onPickIndex={(index) => onChange({ color: index || undefined })}
            />
          </div>
        </Popover>
      ) : null}
    </>
  );
}
