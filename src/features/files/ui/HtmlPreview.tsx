import { DocumentMessage } from "./DocumentMessage";
import { errorText } from "../../../shared/lib/errors";
import { t, useLocale } from "../../../shared/i18n/technical";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Portal } from "../../../shared/ui/Portal";
import { RefreshCw } from "../../../shared/ui/icons";
import type { TranscriptSelection } from "../../sessions";
import { readHtmlPreviewSelection, withHtmlSelectionBridge } from "../model/htmlPreviewSelection";
import { Button } from "../../../shared/ui/Button";
import { PreviewSelectionMenu } from "./PreviewSelection";
import { HtmlPreviewSecurityActions } from "./HtmlPreviewSecurityActions";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { InlineError } from "../../../shared/ui/InlineError";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { surfaceAttributes } from "../../../shared/ui/Surface";

/** A separate protocol and opaque sandbox keep generated scripts out of the app. */
export function HtmlPreview({
  path,
  source,
  active,
  toolbar,
  toolbarTarget,
  compact = false,
  sourceVisible = false,
  originalSource = source,
}: {
  path: string;
  source: string;
  active: boolean;
  /** Embedded previews compose their actions into this single toolbar. */
  toolbar?: ReactNode;
  /** A surrounding dialog can own the toolbar row without remounting the frame. */
  toolbarTarget?: HTMLElement | null;
  compact?: boolean;
  sourceVisible?: boolean;
  originalSource?: string;
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
    const requestToken = crypto.randomUUID();
    let token: string = requestToken;
    const close = (id: string) => {
      void invoke("close_html_preview", { token: id }).catch((error: unknown) => {
        console.error("Could not close HTML preview:", error);
      });
    };
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
      token: requestToken,
      path,
      content: withHtmlSelectionBridge(source, channel),
    })
      .then((id) => {
        token = id;
        if (cancelled) {
          close(id);
          return;
        }
        // Tauri encodes the full path argument, including slashes. Convert only
        // the token so the preview route and its relative assets stay hierarchical.
        opening.current = false;
        setState({ url: `${convertFileSrc(id, "html-preview")}/index.html` });
      })
      .catch((error: unknown) => {
        close(requestToken);
        if (!cancelled) {
          opening.current = false;
          setState({ error: errorText(error) });
        }
      });
    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      close(token);
    };
  }, [path, source, active, reload]);

  if (!active) return null;
  const reloadPreview = () => {
    if (opening.current) return;
    opening.current = true;
    setState({});
    setReload((value) => value + 1);
  };
  const header = (
    <div
      {...(toolbarTarget
        ? { className: "flex items-center gap-1" }
        : surfaceAttributes(
            { frame: "pane", edge: "bottom" },
            compact
              ? "flex min-h-(--ui-control-height-compact) shrink-0 items-center gap-1 px-2 py-1"
              : "flex min-h-(--ui-control-height-compact) shrink-0 flex-wrap items-center gap-1 px-3 py-1",
          ))}
    >
      {toolbar}
      <HtmlPreviewSecurityActions key={path} path={path} />
      <Button
        variant="ghost"
        size="sm"
        {...(compact
          ? { iconOnly: true as const, label: t("Reload preview") }
          : { iconOnly: false as const })}
        loading={!state.url && !state.error}
        onClick={reloadPreview}
      >
        {compact ? <RefreshCw className="icon-sm" /> : t("Reload preview")}
      </Button>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbarTarget ? <Portal target={toolbarTarget}>{header}</Portal> : header}
      {sourceVisible ? (
        <OutputBlock frame="filled" scroll tabIndex={0} className="m-3 min-h-0 flex-1">
          {originalSource}
        </OutputBlock>
      ) : null}
      {state.error && !sourceVisible ? (
        compact ? (
          // An embedded card has no room for a full message page: one line, retry beside it.
          <InlineError inset="row" details={state.error} retry={{ onRetry: reloadPreview }}>
            {t("Couldn’t preview this file")}
          </InlineError>
        ) : (
          <DocumentMessage title={t("Couldn’t preview this file")} error detail={state.error} />
        )
      ) : state.url ? (
        <iframe
          ref={frameRef}
          title={t("HTML live preview")}
          src={state.url}
          sandbox="allow-scripts allow-forms"
          allow="microphone 'none'; camera 'none'; display-capture 'none'"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 border-0"
          hidden={sourceVisible}
        />
      ) : !sourceVisible ? (
        <SurfaceLoading title={t("Opening preview…")} />
      ) : null}
      <PreviewSelectionMenu
        selection={sourceVisible ? null : selection}
        path={path}
        onDismiss={() => setSelection(null)}
      />
    </div>
  );
}
