import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { PaneHeader } from "../../../shared/ui/PaneHeader";
import { Sash } from "../../../shared/ui/Sash";
import { Sheet } from "../../../shared/ui/Sheet";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { RotateCcw, X } from "../../../shared/ui/icons";
import type { PanelSessionPortal } from "../model/scopedPanelSession";

const narrowQuery = "(max-width: 960px)";
const subscribeNarrow = (update: () => void) => {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
};
const isNarrow = () => window.matchMedia(narrowQuery).matches;
const serverNarrow = () => false;

export type SessionDiscussionPanelProps = {
  scopeKey: string;
  title: ReactNode;
  label: string;
  onOpen(): Promise<string>;
  onRestart?(): Promise<string>;
  onClose(): void;
  onMount(portal: PanelSessionPortal | null): void;
  /** Keep the owning workspace's minimum chat width and remaining pane space. */
  minWidth?: number;
  maxWidth?: () => number;
  /** Override shared persistence when the owning feature keeps its own width lifecycle. */
  widthPreference?: { initial: number; onCommit(width: number): void };
  actions?: ReactNode;
  className?: string;
  /** The parent layout can show the base ground for a contained overlay. */
  adaptiveBase?: boolean;
};

/** A resizable destination for the real SessionPane. Chat state and execution remain in its owner. */
export function SessionDiscussionPanel({
  scopeKey,
  title,
  label,
  onOpen,
  onRestart,
  onClose,
  onMount,
  minWidth = 320,
  maxWidth,
  widthPreference,
  actions,
  className,
  adaptiveBase,
}: SessionDiscussionPanelProps) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const open = useStableCallback(onOpen);
  const mount = useStableCallback(onMount);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, serverNarrow);
  const [initialWidth] = useState(() => {
    if (widthPreference) return widthPreference.initial;
    let savedWidth = 0;
    try {
      savedWidth = Number(localStorage.getItem("bycoda.session-panel.width"));
    } catch {
      // Storage may be unavailable; the panel still opens at its default width.
    }
    return savedWidth || 440;
  });
  const { setPaneRef, sashProps } = useDragResize({
    min: minWidth,
    max: maxWidth ?? (() => Math.max(minWidth, window.innerWidth - 380)),
    initial: initialWidth,
    defaultWidth: 440,
    direction: "left",
    onCommit: (width) => {
      if (widthPreference) {
        widthPreference.onCommit(width);
        return;
      }
      try {
        localStorage.setItem("bycoda.session-panel.width", String(width));
      } catch {
        /* Resizing still works without preference storage. */
      }
    },
  });

  // Rebind only when the conversation scope, retry, or portal destination changes, never on streamed text.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keeps the mounted session portal attached to its current scope and responsive host, and releases it on unmount.
  useEffect(() => {
    const generation = ++request.current;
    let active = true;
    setError("");
    setLoading(true);
    void open()
      .then((sessionId) => {
        if (active && generation === request.current && host.current)
          mount({ sessionId, host: host.current });
      })
      .catch((cause: unknown) => {
        if (active && generation === request.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active && generation === request.current) setLoading(false);
      });
    return () => {
      active = false;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate pending restart generations; this ref is a request counter, not a DOM node.
      ++request.current;
      mount(null);
    };
  }, [scopeKey, revision, narrow, open, mount]);

  const restart = () => {
    if (!onRestart) return;
    const generation = ++request.current;
    setLoading(true);
    setError("");
    void onRestart()
      .then((sessionId) => {
        if (generation === request.current && host.current)
          mount({ sessionId, host: host.current });
      })
      .catch((cause: unknown) => {
        if (generation === request.current)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (generation === request.current) setLoading(false);
      });
  };
  const content = (
    <>
      {narrow && actions ? (
        <div className="flex items-center gap-2 px-3 py-2">{actions}</div>
      ) : null}
      {narrow && onRestart ? (
        <Button
          variant="ghost"
          size="sm"
          startIcon={<RotateCcw className="icon-sm" aria-hidden />}
          disabled={loading}
          onClick={restart}
        >
          {t("Restart conversation")}
        </Button>
      ) : null}
      {error ? (
        <InlineError
          retry={{ label: t("Try again"), onRetry: () => setRevision((value) => value + 1) }}
        >
          {error}
        </InlineError>
      ) : null}
      {loading ? <LoadingText className="p-3" /> : null}
      <div ref={host} className="flex min-h-0 min-w-0 flex-1 flex-col" />
    </>
  );
  if (narrow)
    return (
      <Sheet title={label} onClose={onClose} scroll="none">
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">{content}</div>
      </Sheet>
    );
  return (
    <aside
      ref={setPaneRef}
      aria-label={label}
      {...surfaceAttributes(
        {
          frame: "pane",
          edge: "inline-start",
          variant: adaptiveBase ? "adaptive-base" : undefined,
        },
        `${className ?? ""} relative flex min-h-0 min-w-0 shrink-0 flex-col`,
      )}
    >
      <Sash
        {...sashProps}
        appearance="hidden"
        label={t("Resize discussion")}
        className="absolute inset-y-0 -start-px"
      />
      <PaneHeader
        titleAs="div"
        title={title}
        actions={
          <>
            {actions}
            {onRestart ? (
              <Button
                variant="ghost"
                iconOnly
                label={t("Restart conversation")}
                disabled={loading}
                onClick={restart}
              >
                <RotateCcw className="icon-sm" />
              </Button>
            ) : null}
            <Button variant="ghost" iconOnly label={t("Close panel")} onClick={onClose}>
              <X className="icon-sm" />
            </Button>
          </>
        }
      />
      {content}
    </aside>
  );
}
