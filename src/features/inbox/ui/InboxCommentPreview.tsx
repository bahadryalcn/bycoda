import type { ReactNode } from "react";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t } from "../../../shared/i18n";
import { TabStrip } from "../../../shared/ui/Tabs";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";

/** Keep the source mounted while switching views so editor history survives. */
export function InboxCommentPreview({
  draftIdentity,
  value,
  children,
  toolbar,
}: {
  draftIdentity: string;
  value: string;
  children: ReactNode;
  toolbar?: () => ReactNode;
}) {
  // One writing surface by default; the preview is one tab away.
  const [mode, setMode] = useRetainedState<"source" | "split" | "preview">(
    `${draftIdentity}:view`,
    "source",
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <TabStrip
        label={t("Comment")}
        value={mode}
        onValueChange={setMode}
        items={[
          { value: "source", label: t("Source") },
          { value: "split", label: t("Split") },
          { value: "preview", label: t("Preview") },
        ]}
      />
      {mode === "preview" ? null : toolbar?.()}
      <div
        className={
          mode === "split"
            ? "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4"
            : "min-w-0"
        }
      >
        <div className="min-w-0" hidden={mode === "preview"}>
          {children}
        </div>
        {mode !== "source" && value.trim() ? (
          <section aria-label={t("Preview")} className="min-w-0 wrap-anywhere">
            <AgentMarkdown text={value} hardBreaks />
          </section>
        ) : null}
      </div>
    </div>
  );
}
