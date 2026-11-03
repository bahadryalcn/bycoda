import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { InlineError } from "../../../shared/ui/InlineError";
import { Surface } from "../../../shared/ui/Surface";
import { useEffect, useMemo, useState } from "react";
import { HtmlPreview } from "../../files/ui/HtmlPreview";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { useT } from "../../../shared/i18n";
import { SCHEME_CHANGE_EVENT } from "../../settings/model/appearance";
import {
  inlineVisualSnapshot,
  sandboxedInlineVisual,
  type InlineVisualSnapshot,
} from "../model/inlineVisual";

/** The snapshot has no file authority: relative resources cannot be resolved. */
export function InlineVisual({ snapshot }: { snapshot: InlineVisualSnapshot }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [dark, setDark] = useState(
    () => !document.documentElement.classList.contains("theme-light"),
  );
  useEffect(() => {
    const update = () => setDark(!document.documentElement.classList.contains("theme-light"));
    window.addEventListener(SCHEME_CHANGE_EVENT, update);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, update);
  }, []);
  const valid = useMemo(() => inlineVisualSnapshot(snapshot), [snapshot]);
  const source = useMemo(() => sandboxedInlineVisual(valid?.html ?? "", dark), [valid, dark]);
  if (!valid) return <InlineError>{t("Preview unavailable")}</InlineError>;
  const preview = (active: boolean) => (
    <HtmlPreview path="remote://inline-visual/snapshot.html" source={source} active={active} />
  );
  return (
    <Surface
      as="section"
      variant="outline"
      padding="none"
      aria-label={valid.title}
      className="my-2 min-w-0 overflow-hidden"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-1">
        <OverflowTooltip label={valid.title}>
          <span className="min-w-0 flex-1 truncate text-ui-caption">{valid.title}</span>
        </OverflowTooltip>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={sourceOpen}
          onClick={() => setSourceOpen(!sourceOpen)}
        >
          {t("Source")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
          {t("Expand")}
        </Button>
      </div>
      {sourceOpen ? (
        <pre
          tabIndex={0}
          className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-ui-caption"
        >
          {valid.html}
        </pre>
      ) : (
        <div style={{ height: valid.height }} className="max-h-[70vh] min-h-40">
          {preview(!expanded)}
        </div>
      )}
      {expanded ? (
        <Modal
          title={valid.title}
          size="full"
          scroll="none"
          className="h-[calc(100dvh-32px)]"
          onClose={() => setExpanded(false)}
        >
          <div className="h-full min-h-0">{preview(true)}</div>
        </Modal>
      ) : null}
    </Surface>
  );
}
