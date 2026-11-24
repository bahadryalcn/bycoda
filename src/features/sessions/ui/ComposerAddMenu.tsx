import { useRef } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { CursorMagicSelection, FilePlus, Plus } from "../../../shared/ui/icons";

/** The plus button and its add menu, shared by the chat composer and the queued message editor. */
export function ComposerAddMenu({
  open,
  onOpenChange,
  className,
  usageGuide,
  align = "end",
  disabled = false,
  uploadUnavailable,
  skillPrefix,
  onUpload,
  onSkills,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  usageGuide?: string;
  /** Menu edge aligned to the button: `start` when the button opens a toolbar. */
  align?: "start" | "end";
  disabled?: boolean;
  /** Why upload is off; the item stays visible and says so. */
  uploadUnavailable?: string;
  /** The skill trigger shown in the hint; no Skills item without one. */
  skillPrefix?: "/" | "$";
  onUpload: () => void;
  onSkills: () => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <div className={className ?? "relative flex shrink-0"}>
      <Button
        ref={anchor}
        variant="ghost"
        type="button"
        iconOnly
        label={t("Add files or skills")}
        data-usage-guide={usageGuide}
        disabled={disabled}
        selected={open}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <Plus className="icon-sm" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          returnFocusRef={anchor}
          label={t("Add files or skills")}
          side="top"
          align={align}
          size="md"
          onClose={() => onOpenChange(false)}
          data-composer-plus
          items={[
            {
              kind: "group",
              id: "add",
              label: t("Add to message"),
              items: [
                {
                  kind: "item",
                  id: "upload",
                  label: t("Upload file"),
                  icon: <FilePlus />,
                  disabled: !!uploadUnavailable,
                  description: uploadUnavailable,
                },
                ...(skillPrefix
                  ? [
                      {
                        kind: "item" as const,
                        id: "skills",
                        label: t("Skills"),
                        icon: <CursorMagicSelection />,
                        description:
                          skillPrefix === "$"
                            ? t("Choose a skill or type $name")
                            : t("Choose a skill or type /name"),
                      },
                    ]
                  : []),
              ],
            },
          ]}
          onPick={(id) => {
            if (id === "upload") onUpload();
            else onSkills();
          }}
        />
      ) : null}
    </div>
  );
}
