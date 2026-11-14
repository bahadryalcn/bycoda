import type { ReactNode } from "react";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t } from "../../../shared/i18n";
import { TabStrip } from "../../../shared/ui/Tabs";
import { Text } from "../../../shared/ui/Text";
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
  toolbar?: (mode: "source" | "split" | "preview") => ReactNode;
}) {
  const [mode, setMode] = useRetainedState<"source" | "split" | "preview">(
    `${draftIdentity}:view`,
    "split",
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
      {toolbar?.(mode)}
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
        {mode !== "source" ? (
          <section aria-label={t("Preview")} className="min-w-0 wrap-anywhere">
            {value.trim() ? (
              <AgentMarkdown text={value} hardBreaks />
            ) : (
              <Text tone="secondary">{t("No preview")}</Text>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
