import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Sparkles, X } from "../../../../../shared/ui/icons";
import { Modal } from "../../../../../shared/ui/Modal";
import { StatusText, type StatusTextTone } from "../../../../../shared/ui/StatusText";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { ThemeGenerator } from "./ThemeGenerator";
import { useGeneratorState } from "./themeGeneratorSession";
import { isActiveGeneration, readGenerationJobs, useGenerationJobs } from "./themeGenerationJobs";

/**
 * Open state and launcher status for the generator dialog. Closing the dialog never stops a
 * generation (the session keeps it); the launcher shows progress and reopens the dialog.
 */
export function useAppearanceGenerationPanel() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useGeneratorState<string | null>("dismissedGeneration", null);
  const jobs = useGenerationJobs();
  const running = jobs.filter(isActiveGeneration).length;
  const latest = jobs.find((job) => !isActiveGeneration(job));
  const showResult = latest && latest.id !== dismissed;
  const status: { tone: StatusTextTone; label: string } | null = running
    ? { tone: "running", label: t("{p0} running", { p0: running }) }
    : showResult
      ? latest.status === "failed"
        ? { tone: "failed", label: t("Failed") }
        : latest.status === "cancelled"
          ? { tone: "idle", label: t("Cancelled") }
          : { tone: "done", label: t("Ready") }
      : null;
  const dismiss = () => {
    setDismissed(readGenerationJobs().find((job) => !isActiveGeneration(job))?.id ?? null);
    setOpen(false);
  };
  return {
    open,
    status,
    running,
    dismiss,
    show: () => setOpen(true),
    close: () => setOpen(false),
  };
}

type Panel = ReturnType<typeof useAppearanceGenerationPanel>;

export function AppearanceGenerationLauncher({ panel }: { panel: Panel }) {
  const status = panel.status;
  return (
    <div className="appearance-generation-launcher" data-has-status={status ? "" : undefined}>
      <Button
        size="sm"
        variant="secondary"
        aria-label={t("Generate with AI")}
        aria-haspopup="dialog"
        aria-expanded={panel.open}
        aria-description={status?.label}
        onClick={panel.show}
      >
        <Sparkles className="icon-sm" />
        <span className="appearance-generation-label">{t("Generate with AI")}</span>
        {status ? <span className="appearance-generation-short-label">{t("AI")}</span> : null}
        {status ? <StatusText tone={status.tone}>{status.label}</StatusText> : null}
      </Button>
      {status && !panel.running && !panel.open ? (
        <Button size="sm" variant="ghost" iconOnly label={t("Dismiss")} onClick={panel.dismiss}>
          <X />
        </Button>
      ) : null}
    </div>
  );
}

export function AppearanceGenerationDialog({
  panel,
  appearance,
}: {
  panel: Panel;
  appearance: AppearanceSettings;
}) {
  if (!panel.open) return null;
  return (
    <Modal
      title={t("Generate with AI")}
      size="lg"
      fitViewport
      initialFocus=".theme-generator-prompt input"
      onClose={panel.close}
    >
      <ThemeGenerator appearance={appearance} />
    </Modal>
  );
}
