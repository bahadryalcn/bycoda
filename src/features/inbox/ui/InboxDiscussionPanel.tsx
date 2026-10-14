import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import { PanelLeft, RotateCcw } from "../../../shared/ui/icons";
import { IconButton } from "../../../app/shell/TitleBar";
import { useDragResize } from "../../../shared/hooks/useDragResize";
import { inboxItemRef, type InboxItem } from "../model/githubTasks";
import { inboxAskKey } from "../model/inboxAsk";

export type InboxSessionPortal = { sessionId: string; host: HTMLElement };
let rememberedWidth = 440;

/** Only a destination for the regular session pane; it owns no chat state. */
export function InboxDiscussionPanel({
  item,
  onClose,
  onOpen,
  onRestart,
  onMount,
}: {
  item: InboxItem;
  onClose: () => void;
  onOpen: (item: InboxItem) => Promise<string>;
  onRestart: (item: InboxItem) => Promise<string>;
  onMount: (portal: InboxSessionPortal | null) => void;
}) {
  useLocale();
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const resize = useDragResize({
    min: 360,
    max: () => Math.max(360, window.innerWidth - 650),
    initial: rememberedWidth,
    defaultWidth: 440,
    direction: "left",
    onCommit: (width) => {
      rememberedWidth = width;
    },
  });
  const key = inboxAskKey(item);
  useEffect(() => {
    const generation = ++request.current;
    setError(null);
    setLoading(true);
    void onOpen(item)
      .then((sessionId) => {
        if (generation === request.current && host.current)
          onMount({ sessionId, host: host.current });
      })
      .catch((reason) => {
        if (generation === request.current) setError(String(reason));
      })
      .finally(() => {
        if (generation === request.current) setLoading(false);
      });
    return () => {
      ++request.current;
      onMount(null);
    };
    // Metadata refreshes for the same item must not remount its composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, onOpen, onMount, revision]);

  return (
    <aside
      ref={resize.setPaneRef}
      aria-label={t("Ask about {p0}", { p0: inboxItemRef(item) })}
      className="relative flex min-h-0 shrink-0 flex-col border-l border-stroke max-[1100px]:absolute max-[1100px]:inset-0 max-[1100px]:z-10 max-[1100px]:!w-auto max-[1100px]:bg-background-base"
    >
      <div
        role="separator"
        aria-label={t("Resize discussion")}
        aria-orientation="vertical"
        onPointerDown={resize.onPointerDown}
        onDoubleClick={resize.onDoubleClick}
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize max-[1100px]:hidden"
      />
      <header className="flex h-11 shrink-0 items-center border-b border-stroke px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {t("Ask · ")}
          {inboxItemRef(item)}
        </span>
        <IconButton
          label={t("Restart conversation")}
          disabled={loading}
          onClick={() => {
            const generation = ++request.current;
            setLoading(true);
            setError(null);
            void onRestart(item)
              .then((sessionId) => {
                if (generation === request.current && host.current)
                  onMount({ sessionId, host: host.current });
              })
              .catch((reason) => {
                if (generation === request.current) setError(String(reason));
              })
              .finally(() => {
                if (generation === request.current) setLoading(false);
              });
          }}
        >
          <RotateCcw className="size-3.5" />
        </IconButton>
        <IconButton label={t("Close panel")} onClick={onClose}>
          <PanelLeft className="size-3.5" />
        </IconButton>
      </header>
      {error ? (
        <div role="alert" className="p-3 text-xs text-danger">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setRevision((value) => value + 1)}
            className="rounded px-2 py-1 text-content/70 active:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t("Retry")}
          </button>
        </div>
      ) : null}
      {loading ? (
        <p role="status" className="p-3 text-xs text-content/55">
          {t("Loading…")}
        </p>
      ) : null}
      <div ref={host} className="flex min-h-0 min-w-0 flex-1 flex-col" />
    </aside>
  );
}
