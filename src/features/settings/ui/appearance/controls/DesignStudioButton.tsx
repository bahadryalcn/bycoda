import { lazy, Suspense, useState } from "react";
import { Button } from "../../../../../shared/ui/Button";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { t } from "../../../../../shared/i18n";
import type { DesignKind } from "../../../model/designs";
import { writeGeneratorValue } from "./themeGeneratorSession";
import type { AppearanceSettings } from "../../useAppearanceSettings";

const Studio = lazy(() =>
  import("./DesignStudio").then((module) => ({ default: module.DesignStudio })),
);

/** One creation flow used by Appearance and project background controls. */
export function DesignStudioButton({
  kind = "scene",
  appearance,
  project,
  label,
  onApplied,
}: {
  kind?: DesignKind;
  appearance?: AppearanceSettings;
  project?: string;
  label?: string;
  onApplied?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          writeGeneratorValue("designKind", kind, "scene");
          setOpen(true);
        }}
      >
        {label ?? t("Create")}
      </Button>
      {open ? (
        <Suspense fallback={<LoadingText />}>
          <Studio
            initialKind={kind}
            appearance={appearance}
            project={project}
            onApplied={onApplied}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
