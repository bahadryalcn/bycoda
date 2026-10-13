import { t, useLocale } from "../../../shared/i18n/technical";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { TranscriptSelection } from "../../sessions/model/transcriptSelection";
import { readHtmlPreviewSelection, withHtmlSelectionBridge } from "../model/htmlPreviewSelection";
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
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  useEffect(() => {
    setSelection(null);
    if (!active) return;
    let cancelled = false;
    let token: string | undefined;
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
        setState({ url: convertFileSrc(`${id}/index.html`, "html-preview") });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ error: String(error) });
      });
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      if (token) void invoke("close_html_preview", { token });
    };
  }, [path, source, active, reload]);

  if (!active) return null;
  if (state.error)
    return (
      <div role="alert" className="p-6 text-[12px] text-red-400">
        {state.error}
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-9 shrink-0 items-center border-b border-stroke bg-surface px-3">
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="text-[12px] text-content/70 hover:text-content"
        >
          {t("Reload preview")}
        </button>
      </div>
      {state.url ? (
        <iframe
          ref={frameRef}
          title={t("HTML live preview")}
          src={state.url}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0"
        />
      ) : (
        <p className="p-6 text-[12px] text-gray-500">{t("Opening preview…")}</p>
      )}
      <PreviewSelectionMenu
        selection={selection}
        path={path}
        onDismiss={() => setSelection(null)}
      />
    </div>
  );
}
