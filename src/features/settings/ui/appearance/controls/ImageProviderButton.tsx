import { useRef, useState } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { DropdownMenu } from "../../../../../shared/ui/DropdownMenu";
import { ImagePlus, Sparkles } from "../../../../../shared/ui/icons";
import { HarnessIcon } from "../../../../../shared/ui/identity/HarnessIcon";

export type ImageProviderChoice = "none" | "codex" | "gemini";

/** Compact image-generation choice; the shared menu owns keyboard navigation and focus return. */
export function ImageProviderButton({
  value,
  onChange,
}: {
  value: ImageProviderChoice;
  onChange: (value: ImageProviderChoice) => void;
}) {
  useLocale();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const choices = [
    { id: "none", label: t("None"), icon: <ImagePlus /> },
    { id: "codex", label: "Codex", icon: <HarnessIcon harness="codex" /> },
    { id: "gemini", label: "Gemini", icon: <Sparkles /> },
  ] as const;
  const selected = choices.find((choice) => choice.id === value)!;
  return (
    <>
      <Button
        iconOnly
        ref={anchor}
        label={`${t("Background image")}: ${selected.label}`}
        size="sm"
        variant="ghost"
        pressed={value !== "none"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {selected.icon}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Image provider")}
          initialActiveId={value}
          items={choices.map((choice) => ({
            ...choice,
            kind: "item",
            checked: choice.id === value,
            selectionRole: "radio",
          }))}
          onPick={(id) => {
            if (id === "none" || id === "codex" || id === "gemini") onChange(id);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
