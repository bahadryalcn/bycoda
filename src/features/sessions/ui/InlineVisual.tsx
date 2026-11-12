import { Text } from "../../../shared/ui/Text";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { InlineError } from "../../../shared/ui/InlineError";
import { SurfaceLoading } from "../../../shared/ui/SurfaceLoading";
import { Surface } from "../../../shared/ui/Surface";
import { useEffect, useRef, useState } from "react";
import { HtmlPreview } from "../../files/public/HtmlPreview";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Sheet } from "../../../shared/ui/Sheet";
import { CodeBlock, Maximize2, PanelRight, X } from "../../../shared/ui/icons";
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

/** The snapshot has no file authority: relative resources cannot be resolved. */
export function InlineVisual({ snapshot }: { snapshot: InlineVisualValue }) {
  const t = useT();
  const resolved = useInlineVisualSource(snapshot);
  if (resolved.state === "ready") return <InlineVisualFrame valid={resolved.source} />;
  if (resolved.state === "error")
    return (
      <InlineError retry={{ onRetry: resolved.retry }}>{t("Preview unavailable")}</InlineError>
    );
  return (
    <Surface
      as="section"
      variant="outline"
      padding="none"
      aria-label={snapshot.title}
      aria-busy
      style={{ height: snapshot.height }}
      className="my-2 min-w-0 overflow-hidden"
    >
      <SurfaceLoading />
    </Surface>
  );
}

function InlineVisualFrame({ valid }: { valid: InlineVisualSource }) {
  const t = useT();
  const [view, setView] = useState<"inline" | "panel" | "expanded">("inline");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [expandedToolbar, setExpandedToolbar] = useState<HTMLDivElement | null>(null);
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
  const [scheme, setScheme] = useState(readScheme);
  useEffect(() => {
    const update = () => setScheme(readScheme());
    window.addEventListener(SCHEME_CHANGE_EVENT, update);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, update);
  }, []);
  const source = sandboxedInlineVisual(valid.html, scheme.dark, scheme.theme);
  const controls = (location: typeof view) => (
    <>
      {location !== "expanded" ? (
        <OverflowTooltip label={valid.title}>
          <Text size="caption" tone="inherit" truncate className="min-w-0 flex-1">
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
          onClick={() => setView("panel")}
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
          onClick={() => setView("expanded")}
        >
          <Maximize2 className="icon-sm" />
        </Button>
      ) : null}
      {location === "panel" ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Close")}
          onClick={() => setView("inline")}
        >
          <X className="icon-sm" />
        </Button>
      ) : null}
    </>
  );
  const preview = (location: typeof view) => (
    <HtmlPreview
      path="remote://inline-visual/snapshot.html"
      source={source}
      active
      compact
      toolbar={controls(location)}
      toolbarTarget={location === "expanded" ? expandedToolbar : undefined}
      sourceVisible={sourceOpen}
      originalSource={valid.html}
    />
  );
  return (
    <Surface
      ref={root}
      as="section"
      variant="outline"
      padding="none"
      aria-label={valid.title}
      className="my-2 min-w-0 overflow-hidden font-sans"
    >
      {view === "inline" ? (
        <div style={{ height: valid.height }}>{preview("inline")}</div>
      ) : (
        <div className="flex min-w-0 items-center gap-2 px-2 py-1">
          <PanelRight className="icon-sm" />
          <Text size="caption" tone="inherit" truncate className="min-w-0 flex-1">
            {valid.title}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Close")}
            onClick={() => setView("inline")}
          >
            <X className="icon-sm" />
          </Button>
        </div>
      )}
      {view === "panel" ? (
        <Sheet
          padding="none"
          modal={false}
          side="end"
          title={valid.title}
          header={<></>}
          scroll="none"
          dismissOnOutside={false}
          resizable={{
            min: 320,
            max: 960,
            defaultSize: Math.max(320, Math.min(640, window.innerWidth / 2)),
          }}
          onClose={() => setView("inline")}
        >
          {preview("panel")}
        </Sheet>
      ) : null}
      {view === "expanded" ? (
        <Modal
          padding="none"
          title={valid.title}
          size="full"
          scroll="none"
          toolbar={<div ref={setExpandedToolbar} />}
          className="h-[calc(100dvh-32px)]"
          onClose={() => setView("inline")}
        >
          <div className="h-full min-h-0">{preview("expanded")}</div>
        </Modal>
      ) : null}
    </Surface>
  );
}
