import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { ArrowDown, ArrowUp, Sparkles, X } from "../../../../../shared/ui/icons";
import { Modal } from "../../../../../shared/ui/Modal";
import { InlineMessage } from "../../../../../shared/ui/InlineError";
import { StatusText, type StatusTextTone } from "../../../../../shared/ui/StatusText";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import { ThemeGenerator } from "./ThemeGenerator";
import { useGeneratorState } from "./themeGeneratorSession";
import { isActiveGeneration, readGenerationJobs, useGenerationJobs } from "./themeGenerationJobs";

export function useAppearanceGenerationPanel() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useGeneratorState("generationMinimized", false);
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
    setMinimized(false);
    setOpen(false);
  };
  return {
    open,
    minimized: minimized && !open,
    status,
    running,
    dismiss,
    show: () => setOpen(true),
    minimize: () => {
      setMinimized(true);
      setOpen(false);
    },
  };
}

type Panel = ReturnType<typeof useAppearanceGenerationPanel>;

export function AppearanceGenerationLauncher({ panel }: { panel: Panel }) {
  const status = panel.minimized ? null : panel.status;
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
      {!panel.open && panel.status ? (
        <InlineMessage icon={null} tone="neutral" className="sr-only">
          {panel.status.label}
        </InlineMessage>
      ) : null}
    </div>
  );
}

export function AppearanceGenerationDock({ panel }: { panel: Panel }) {
  if (!panel.minimized) return null;
  return (
    <div
      {...surfaceAttributes(
        { variant: "floating", radius: "popup", elevation: "floating", ring: "pane" },
        "appearance-generation-dock",
      )}
      role="group"
      aria-label={t("Generation")}
    >
      <Button size="sm" variant="ghost" aria-haspopup="dialog" onClick={panel.show}>
        <ArrowUp className="icon-sm" />
        {t("Restore")}
      </Button>
      {panel.status ? <StatusText tone={panel.status.tone}>{panel.status.label}</StatusText> : null}
      <Button size="sm" variant="ghost" iconOnly label={t("Dismiss")} onClick={panel.dismiss}>
        <X />
      </Button>
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
      onClose={panel.dismiss}
      toolbar={
        <Button size="sm" variant="ghost" iconOnly label={t("Minimize")} onClick={panel.minimize}>
          <ArrowDown />
        </Button>
      }
    >
      <ThemeGenerator appearance={appearance} />
    </Modal>
  );
}
