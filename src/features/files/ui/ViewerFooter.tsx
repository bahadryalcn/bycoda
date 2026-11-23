import type { ReactNode } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Button } from "../../../shared/ui/Button";
import { ExternalLink } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n/technical";

/**
 * Bottom bar every read-only viewer shares: file name first, then its metadata,
 * zoom and the open action passed as children.
 */
export function ViewerFooter({ name, children }: { name: string; children?: ReactNode }) {
  useLocale();
  return (
    <Text
      as="footer"
      {...surfaceAttributes(
        { frame: "pane", edge: "top" },
        "flex min-h-(--ui-control-height-compact) shrink-0 flex-wrap items-center gap-3 border-(--ui-pane-border) px-3 py-1",
      )}
    >
      <OverflowTooltip label={name}>
        <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
          {name}
        </Text>
      </OverflowTooltip>
      {children}
    </Text>
  );
}

/** The one "open externally" action; `localCopy` marks a remote file opened from a local copy. */
export function OpenInDefaultAppButton({
  localCopy,
  loading,
  onOpen,
}: {
  localCopy: boolean;
  loading?: boolean;
  onOpen: () => void;
}) {
  useLocale();
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={loading}
      startIcon={<ExternalLink className="icon-xs" strokeWidth={1.75} />}
      tooltip={
        localCopy
          ? t("Changes to this local copy are not saved to the connected machine.")
          : undefined
      }
      onClick={onOpen}
    >
      {t(localCopy ? "Open local copy" : "Open in default app")}
    </Button>
  );
}
