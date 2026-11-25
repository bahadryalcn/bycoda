import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { InlineMessage } from "../../../../../shared/ui/InlineError";
import { Maximize2, X } from "../../../../../shared/ui/icons";
import { Spinner } from "../../../../../shared/ui/Spinner";
import { Text } from "../../../../../shared/ui/Text";
import { OverflowTooltip } from "../../../../../shared/ui/Tooltip";
import type { BackgroundLibraryImage } from "../../../model/backgroundLibrary";
import {
  dismissGenerationJob,
  isActiveGeneration,
  type ThemeGenerationJob,
} from "./themeGenerationJobs";

function status(job: ThemeGenerationJob) {
  switch (job.status) {
    case "running":
      return job.kind === "image" ? t("Drawing a background image…") : t("Generating…");
    case "saving":
      return t("Saving…");
    case "cancelled":
      return t("Cancelled");
    case "done":
      return t("Ready");
    case "failed":
      return job.kind === "image"
        ? t("Background image generation failed.")
        : t("Theme generation failed.");
  }
}

export function ThemeGenerationActivity({
  jobs,
  currentImageIds,
  onPreview,
}: {
  jobs: ThemeGenerationJob[];
  currentImageIds: ReadonlySet<string>;
  onPreview: (
    image: BackgroundLibraryImage,
    job: { name: string; batch: number; index: number },
  ) => void;
}) {
  const [showRecent, setShowRecent] = useState(false);
  if (!jobs.length) return null;
  const active = jobs.filter(isActiveGeneration);
  const recent = jobs.filter((job) => !isActiveGeneration(job));
  const visible = [...active, ...(showRecent ? recent : recent.slice(0, 1))];
  return (
    <div className="theme-generation-activity" role="group" aria-label={t("Generation")}>
      {visible.map((job) => {
        const detail = job.status === "failed" ? job.detail : undefined;
        const signedOut =
          detail && /authenticat|log ?in|credential|expired|unauthori/i.test(detail);
        const image =
          job.status === "done" && job.image && !currentImageIds.has(job.image.id)
            ? job.image
            : undefined;
        return (
          <div className="theme-generation-entry" key={job.id}>
            <div className="theme-generation-row">
              <div className="theme-generation-name">
                <OverflowTooltip label={job.name}>
                  <Text truncate>{job.name}</Text>
                </OverflowTooltip>
                <Text size="caption" tone="secondary">
                  {job.kind === "themes"
                    ? t("Theme")
                    : job.provider === "codex"
                      ? "Codex"
                      : "Gemini"}
                </Text>
              </div>
              {/* While cancelling, the Cancel action itself says so beside its spinner. */}
              {job.status === "cancelling" ? null : (
                <InlineMessage
                  tone={
                    job.status === "failed"
                      ? "danger"
                      : job.status === "done"
                        ? "success"
                        : "neutral"
                  }
                  icon={
                    isActiveGeneration(job) ? (
                      <Spinner size="xs" />
                    ) : job.status === "cancelled" ? null : undefined
                  }
                >
                  {status(job)}
                </InlineMessage>
              )}
              <div className="theme-generation-actions">
                {job.status === "running" || job.status === "cancelling" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${t("Cancel")} ${job.name}`}
                    loading={job.status === "cancelling"}
                    loadingLabel={t("Cancelling…")}
                    onClick={job.status === "running" ? job.cancel : undefined}
                  >
                    {t("Cancel")}
                  </Button>
                ) : null}
                {job.status === "failed" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      job.kind === "themes" && active.some((entry) => entry.kind === "themes")
                    }
                    disabledReason={t("Wait for the current theme generation to finish.")}
                    onClick={job.retry}
                  >
                    {t("Retry")}
                  </Button>
                ) : null}
                {image && job.kind === "image" ? (
                  <Button
                    iconOnly
                    size="sm"
                    variant="ghost"
                    label={t("Preview {p0}", { p0: job.name })}
                    onClick={() => onPreview(image, job)}
                  >
                    <Maximize2 />
                  </Button>
                ) : null}
                {!isActiveGeneration(job) ? (
                  <Button
                    iconOnly
                    size="sm"
                    variant="ghost"
                    label={`${t("Dismiss")} ${job.name}`}
                    onClick={() => dismissGenerationJob(job.id)}
                  >
                    <X />
                  </Button>
                ) : null}
              </div>
            </div>
            {detail || signedOut ? (
              <InlineMessage tone="neutral" icon={null} live="off">
                {detail}
                {signedOut
                  ? ` ${
                      job.kind === "themes"
                        ? t(
                            "Pick a signed-in account in the model picker, or sign in to the provider again.",
                          )
                        : t("Check the selected image provider and sign in again.")
                    }`
                  : null}
              </InlineMessage>
            ) : null}
            {job.status === "running" && job.cancelError !== undefined ? (
              <InlineMessage tone="warning">
                {[t("Cancellation could not be confirmed."), job.cancelError]
                  .filter(Boolean)
                  .join(" ")}
              </InlineMessage>
            ) : null}
          </div>
        );
      })}
      {recent.length > 1 ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showRecent}
            onClick={() => setShowRecent(!showRecent)}
          >
            {t("Recent activity")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
