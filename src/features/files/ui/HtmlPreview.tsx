import { t, useLocale } from "../../../shared/i18n/technical";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { TranscriptSelection } from "../../sessions/model/transcriptSelection";
import { readHtmlPreviewSelection, withHtmlSelectionBridge } from "../model/htmlPreviewSelection";
import { Button } from "../../../shared/ui/Button";
import { PreviewSelectionMenu } from "./PreviewSelection";

/** A separate protocol and opaque sandbox keep generated scripts out of the app. */
export function HtmlPreview({
  path,
  source,
  active,
}: {
  path: string;
  source: string;
  active: boolean;
}) {
  useLocale();
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  const [reload, setReload] = useState(0);
  const opening = useRef(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  useEffect(() => {
    setSelection(null);
    if (!active) return;
    let cancelled = false;
    let token: string | undefined;
    opening.current = true;
    setState({});
    const channel = crypto.randomUUID();
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (!event.data || event.data.channel !== channel) return;
      setSelection(readHtmlPreviewSelection(event.data, channel, frame.getBoundingClientRect()));
    };
    window.addEventListener("message", onMessage);
    void invoke<string>("create_html_preview", {
      path,
      content: withHtmlSelectionBridge(source, channel),
    })
      .then((id) => {
        token = id;
        if (cancelled) {
          void invoke("close_html_preview", { token: id });
          return;
        }
        // Tauri encodes the full path argument, including slashes. Convert only
        // the token so the preview route and its relative assets stay hierarchical.
        opening.current = false;
        setState({ url: `${convertFileSrc(id, "html-preview")}/index.html` });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          opening.current = false;
          setState({ error: String(error) });
        }
      });
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      if (token) void invoke("close_html_preview", { token });
    };
  }, [path, source, active, reload]);

  if (!active) return null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex min-h-9 shrink-0 items-center border-b border-stroke bg-surface px-3 py-1">
        <Button
          variant="ghost"
          size="sm"
          motion="none"
          loading={!state.url && !state.error}
          onClick={() => {
            if (opening.current) return;
            opening.current = true;
            setState({});
            setReload((value) => value + 1);
          }}
        >
          {t("Reload preview")}
        </Button>
      </div>
      {state.error ? (
        <div role="alert" className="min-w-0 break-words p-6 text-ui-caption text-danger">
          {state.error}
        </div>
      ) : state.url ? (
        <iframe
          ref={frameRef}
          title={t("HTML live preview")}
          src={state.url}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0"
        />
      ) : (
        <p role="status" className="p-6 text-ui-caption text-[var(--ui-text-muted)]">
          {t("Opening preview…")}
        </p>
      )}
      <PreviewSelectionMenu
        selection={selection}
        path={path}
        onDismiss={() => setSelection(null)}
      />
    </div>
  );
}
