import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { Surface } from "../../../shared/ui/Surface";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HtmlPreview } from "../../files/public/HtmlPreview";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Sheet } from "../../../shared/ui/Sheet";
import { CircleAlert, CodeBlock, Maximize2, PanelRight, X } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { SCHEME_CHANGE_EVENT } from "../../settings/public/appearance";
import {
  INLINE_VISUAL_THEME_TOKENS,
  sandboxedInlineVisual,
  type InlineVisual as InlineVisualValue,
  type InlineVisualSource,
  type InlineVisualTheme,
} from "../model/inlineVisual";
import { useInlineVisualSource } from "../hooks/useInlineVisualSource";
import { createInlineVisualFrameHost, moveInlineVisualFrameHost } from "./inlineVisualFrameHost";

type View = "inline" | "panel" | "expanded";

function readTheme(): InlineVisualTheme {
  const style = getComputedStyle(document.documentElement);
  const theme: InlineVisualTheme = {};
  for (const [name, token] of Object.entries(INLINE_VISUAL_THEME_TOKENS))
    theme[name as keyof InlineVisualTheme] = style.getPropertyValue(token).trim() || undefined;
  return theme;
}
const readScheme = () => ({
  dark: !document.documentElement.classList.contains("theme-light"),
  theme: readTheme(),
});

/** The app's scheme and theme values for a sandboxed visual, refreshed when the scheme changes. */
export function useInlineVisualScheme() {
  const [scheme, setScheme] = useState(readScheme);
  // Re-reads the theme tokens when the app scheme changes, so an open visual follows it.
  useEffect(() => {
    const update = () => setScheme(readScheme());
    window.addEventListener(SCHEME_CHANGE_EVENT, update);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, update);
  }, []);
  return scheme;
}

/** The snapshot has no file authority: relative resources cannot be resolved. */
export function InlineVisual({ snapshot }: { snapshot: InlineVisualValue }) {
  const t = useT();
  const resolved = useInlineVisualSource(snapshot);
  if (resolved.state === "ready") return <InlineVisualFrame valid={resolved.source} />;
  if (resolved.state === "error")
    return (
      // Same box as the loaded visual, so a retry that succeeds does not shift the transcript.
      <Surface
        as="section"
        variant="card"
        padding="none"
        aria-label={snapshot.title}
        style={{ "--inline-visual-height": `${snapshot.height}px` } as React.CSSProperties}
        className="my-2 h-(--inline-visual-height) min-w-0 overflow-hidden font-sans"
        data-inline-visual-error
      >
        <div className="flex h-full items-center gap-2 ps-3.5 pe-2">
          <CircleAlert className="icon-sm shrink-0 text-(--ui-tone-danger-fg)" aria-hidden />
          <Text
            role="alert"
            size="caption"
            tone="inherit"
            className="min-w-0 flex-1 text-(--transcript-ink-chrome)"
          >
            {t("Preview unavailable")}
          </Text>
          <Button variant="ghost" size="sm" type="button" onClick={resolved.retry}>
            {t("Try again")}
          </Button>
        </div>
      </Surface>
    );
  return (
    <Surface
      as="section"
      variant="card"
      padding="none"
      aria-label={snapshot.title}
      aria-busy
      style={{ "--inline-visual-height": `${snapshot.height}px` } as React.CSSProperties}
      className="my-2 min-w-0 overflow-hidden h-(--inline-visual-height)"
    >
      <SurfaceLoading />
    </Surface>
  );
}

function InlineVisualFrame({ valid }: { valid: InlineVisualSource }) {
  const t = useT();
  const [view, setView] = useState<View>("inline");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [expandedToolbar, setExpandedToolbar] = useState<HTMLDivElement | null>(null);
  // One host element holds the preview for the card's whole life; the views only provide the slot
  // it sits in. The card slot stays mounted in every view, so the host always has a place to
  // wait in while a panel or dialog is torn down, and the card keeps its transcript height.
  const [host] = useState(createInlineVisualFrameHost);
  const [inlineSlot, setInlineSlot] = useState<HTMLDivElement | null>(null);
  const [panelSlot, setPanelSlot] = useState<HTMLDivElement | null>(null);
  const [expandedSlot, setExpandedSlot] = useState<HTMLDivElement | null>(null);
  const slot = view === "inline" ? inlineSlot : view === "panel" ? panelSlot : expandedSlot;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Move the existing iframe DOM host into the mounted view before paint.
  useLayoutEffect(() => {
    if (slot) moveInlineVisualFrameHost(host, slot);
  }, [host, slot]);
  // Every view change goes through here: the host leaves a panel or dialog before React removes
  // it, so closing never takes the live frame down with the overlay.
  const go = (next: View) => {
    if (view !== "inline" && inlineSlot) moveInlineVisualFrameHost(host, inlineSlot);
    setView(next);
  };
  const root = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  useEffect(() => {
    if (view === "inline" && previousView.current !== "inline") {
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-visual-action="${previousView.current}"]`)
        ?.focus({ preventScroll: true });
    }
    previousView.current = view;
  }, [view]);
  const scheme = useInlineVisualScheme();
  const source = sandboxedInlineVisual(valid.html, scheme.dark, scheme.theme);
  const controls = (location: View) => (
    <>
      {location !== "expanded" ? (
        <OverflowTooltip label={valid.title}>
          <Text
            size="caption"
            tone="inherit"
            truncate
            className="min-w-0 flex-1 text-(--transcript-ink-chrome)"
          >
            {valid.title}
          </Text>
        </OverflowTooltip>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Source")}
        selected={sourceOpen}
        aria-expanded={sourceOpen}
        onClick={() => setSourceOpen(!sourceOpen)}
      >
        <CodeBlock className="icon-sm" />
      </Button>
      {location !== "panel" ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Open in panel")}
          data-visual-action="panel"
          onClick={() => go("panel")}
        >
          <PanelRight className="icon-sm" />
        </Button>
      ) : null}
      {location !== "expanded" ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Expand")}
          data-visual-action="expanded"
          onClick={() => go("expanded")}
        >
          <Maximize2 className="icon-sm" />
        </Button>
      ) : null}
      {location === "panel" ? (
        <Button variant="ghost" size="sm" iconOnly label={t("Close")} onClick={() => go("inline")}>
          <X className="icon-sm" />
        </Button>
      ) : null}
    </>
  );
  return (
    <Surface
      ref={root}
      as="section"
      variant="card"
      padding="none"
      aria-label={valid.title}
      className="my-2 min-w-0 overflow-hidden font-sans"
    >
      {/* ui-drift-ignore: portal-outside-shared -- The portal keeps one preview mounted across inline, Sheet and Modal slots. */}
      {createPortal(
        <HtmlPreview
          path="remote://inline-visual/snapshot.html"
          source={source}
          active
          compact
          toolbar={controls(view)}
          toolbarTarget={view === "expanded" ? expandedToolbar : undefined}
          sourceVisible={sourceOpen}
          originalSource={valid.html}
        />,
        host,
      )}
      {/* Same height in every view, so opening a panel or dialog never shifts the transcript. */}
      <div
        className="relative h-(--inline-visual-height)"
        style={{ "--inline-visual-height": `${valid.height}px` } as React.CSSProperties}
      >
        <div ref={setInlineSlot} className="h-full min-h-0" />
        {view !== "inline" ? (
          <div
            data-inline-visual-row
            className="absolute inset-0 flex items-center justify-center px-2 py-1"
          >
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <PanelRight className="icon-sm shrink-0" />
              <Text size="caption" tone="inherit" truncate className="min-w-0">
                {valid.title}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                label={t("Close")}
                onClick={() => go("inline")}
              >
                <X className="icon-sm" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      {view === "panel" ? (
        <Sheet
          padding="none"
          modal={false}
          side="end"
          title={valid.title}
          header={false}
          scroll="none"
          dismissOnOutside={false}
          resizable={{
            min: 320,
            max: 960,
            defaultSize: Math.max(320, Math.min(640, window.innerWidth / 2)),
          }}
          onClose={() => go("inline")}
        >
          <div ref={setPanelSlot} className="h-full min-h-0" />
        </Sheet>
      ) : null}
      {view === "expanded" ? (
        <Modal
          padding="none"
          title={valid.title}
          size="full"
          scroll="none"
          toolbar={<div ref={setExpandedToolbar} />}
          height="fill"
          onClose={() => go("inline")}
        >
          <div ref={setExpandedSlot} className="h-full min-h-0" />
        </Modal>
      ) : null}
    </Surface>
  );
}
