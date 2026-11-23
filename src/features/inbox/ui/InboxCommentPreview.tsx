import type { ReactNode } from "react";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Eye } from "../../../shared/ui/icons";
import { AgentMarkdown } from "../../sessions/public/AgentMarkdown";

/** Keep the source mounted while previewing so editor history survives. */
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
  // One writing surface by default; the preview is one toggle away and only exists once there is text.
  const [mode, setMode] = useRetainedState<"source" | "preview">(`${draftIdentity}:view`, "source");
  const previewing = mode === "preview";
  const canPreview = previewing || value.trim().length > 0;
  const bar = previewing ? null : toolbar?.();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {bar || canPreview ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          {bar ?? <span />}
          {canPreview ? (
            <Button
              iconOnly
              size="sm"
              variant="ghost"
              type="button"
              label={t("Preview")}
              pressed={previewing}
              onClick={() => setMode(previewing ? "source" : "preview")}
            >
              <Eye className="icon-sm" strokeWidth={1.75} />
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="min-w-0" hidden={previewing}>
        {children}
      </div>
      {previewing && value.trim() ? (
        <section aria-label={t("Preview")} className="min-w-0 wrap-anywhere">
          <AgentMarkdown text={value} hardBreaks />
        </section>
      ) : null}
    </div>
  );
}
