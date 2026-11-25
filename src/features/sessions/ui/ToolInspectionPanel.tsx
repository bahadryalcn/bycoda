import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "../../../shared/i18n";
import { storedFlag } from "../../../shared/lib/storedSetting";
import { FloatingButtonGroup } from "../../../shared/ui/FloatingButtonGroup";
import { Check, Copy, RotateCcw, WrapText } from "../../../shared/ui/icons";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import type { Block } from "../model/session";
import { toolResultTexts } from "../model/commandInspection";
import { boundedToolPreview } from "../model/toolInspection";
import { ToolInspectionDiff } from "./ToolInspectionDiff";
import { ToolInspectionSplitDiff } from "./ToolInspectionSplitDiff";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { observeResize } from "../../../shared/lib/observeResize";
import { diffLineCount, resolveDiffLayout, type DiffLayoutChoice } from "../model/toolDiffSplit";
import { JsonViewer } from "../../../shared/ui/JsonViewer";
import { AnsiText } from "../../../shared/ui/AnsiText";
import { stripAnsi } from "../../../shared/lib/ansi";
import "./chat-controls.css";

// Long commands and output wrap by default; aligned output (tables, diffs) can opt out, and the choice persists.
const toolOutputWrap = storedFlag("bycoda.toolOutputWrap", true, "bycoda:tool-output-wrap", true);
const loadToolOutputWrap = () => toolOutputWrap.load() ?? true;
function useToolOutputWrap() {
  return useSyncExternalStore(toolOutputWrap.subscribe, loadToolOutputWrap, () => true);
}

/** Only complete saved JSON objects/arrays qualify. Plain text and diffs stay intact. */
export function inspectionJson(text: string): { data: unknown } | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
  try {
    return { data: JSON.parse(text) };
  } catch {
    return null;
  }
}

export function hasToolInspection(block: Block): boolean {
  const tool = block.tool;
  return !!(
    tool?.preview?.inspection ||
    (tool?.preview?.kind === "shell" && tool.preview.title) ||
    tool?.preview?.lines?.length ||
    tool?.preview?.contentOnly ||
    tool?.detail ||
    tool?.output ||
    tool?.preview?.output ||
    tool?.outputTruncated
  );
}

/** Mounted only after an explicit disclosure; never reads today's file as historical output. */
export function ToolInspectionPanel({ block }: { block: Block }) {
  const t = useT();
  const sections = useMemo(() => {
    const preview = boundedToolPreview(block.tool?.preview);
    const inspection = preview?.inspection;
    const items: {
      title: string;
      text: string;
      diff?: boolean;
      truncated?: boolean;
      legacy?: boolean;
      error?: boolean;
    }[] = [];
    // Same reconciliation as Command details and Copy (commandInspection.ts).
    const { error, output: outputs } = toolResultTexts(block);
    if (error) items.push({ title: "Error", text: error, error: true });
    if (inspection) {
      items.push({
        title:
          inspection.kind === "diff"
            ? "Changes"
            : inspection.kind === "content"
              ? "Written content"
              : "Command",
        text: inspection.text,
        diff: inspection.kind === "diff",
        truncated: inspection.truncated,
      });
    } else if (preview?.lines?.length || preview?.contentOnly) {
      items.push({
        title: "Saved preview",
        text: (preview.lines ?? [])
          .map(
            (line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`,
          )
          .join("\n"),
        diff: !preview.contentOnly,
        legacy: true,
      });
    }
    // Shell titles may be human-readable summaries; the preview retains the actual command.
    if (!inspection && preview?.kind === "shell" && preview.title) {
      items.unshift({ title: "Command", text: preview.title });
    }
    if (outputs.length) {
      items.push({
        title: "Output",
        text: outputs.join("\n\n"),
        truncated: block.tool?.outputTruncated,
      });
    }
    return items;
  }, [block]);
  // Copy states its own scope: shortened or summary-only text carries a notice so
  // the clipboard never presents an incomplete body as the full result.
  const copyNotices = [
    sections.some((section) => section.truncated)
      ? t("[Shortened: some text was left out to keep this conversation responsive.]")
      : null,
    sections.some((section) => section.legacy)
      ? t("[Only a shortened preview was saved for this older tool call.]")
      : null,
    block.remoteContent ? t("[Only a summary of the output is kept here.]") : null,
  ].filter((notice): notice is string => !!notice);
  const bodyText = sections.map((section) => stripAnsi(section.text)).join("\n\n");
  const copyText = bodyText ? [bodyText, ...copyNotices].join("\n\n") : "";
  // Streaming output changes the copied text, so any outcome or copy in flight belongs to the old text.
  const feedback = useCopyFeedback({
    resetKeys: [block.id, copyText],
    successMs: 2000,
  });
  const wrap = useToolOutputWrap();
  // The conversation always shows unified; the reader's split choice lasts only while this inspector is open.
  const [diffChoice, setDiffChoice] = useState<DiffLayoutChoice>("unified");
  const surface = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  // Split needs room: follow the inspector's own width so the choice survives a resize.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- observes the inspector element's size (ResizeObserver) while mounted
  useEffect(() => {
    const node = surface.current;
    return node ? observeResize(node, (entry) => setWidth(entry.contentRect.width)) : undefined;
  }, []);
  const copy = () => {
    feedback.copy(() => copyMessage(copyText));
  };
  const presentation = useMemo(
    () =>
      sections.map((section) => ({
        section,
        json:
          !section.diff &&
          !section.error &&
          !section.truncated &&
          section.title !== "Command" &&
          section.title !== "Written content"
            ? inspectionJson(section.text)
            : null,
      })),
    [sections],
  );
  // JsonViewer owns its own layout, so the wrap choice only matters when some section is plain text.
  const hasWrappable = presentation.some(({ json }) => json === null);
  const layoutOf = (section: { diff?: boolean; text: string }) =>
    section.diff
      ? resolveDiffLayout(diffChoice, {
          width,
          lines: diffLineCount(section.text),
        })
      : null;
  const actions = [
    {
      id: "copy",
      label: feedback.copied ? t("Copied") : feedback.failed ? t("Retry copy") : t("Copy"),
      icon: feedback.copied ? <Check /> : feedback.failed ? <RotateCcw /> : <Copy />,
      tone: feedback.copied
        ? ("success" as const)
        : feedback.failed
          ? ("danger" as const)
          : undefined,
      disabled: !copyText,
      loading: feedback.pending,
      onSelect: copy,
    },
    ...(hasWrappable
      ? [
          {
            id: "wrap",
            label: t("Wrap lines"),
            icon: <WrapText />,
            pressed: wrap,
            selectionIndicator: "dot" as const,
            onSelect: () => toolOutputWrap.save(!wrap),
          },
        ]
      : []),
  ];

  // One quiet code-block surface: the sections are spaced, not ruled, and the
  // single icon group (Copy, Wrap) lives on the first heading instead of a bar of its own.
  return (
    <Surface
      ref={surface}
      variant="card"
      padding="none"
      data-tool-inspection
      className="flex min-w-0 flex-col gap-2 overflow-clip pb-2"
    >
      {presentation.map(({ section, json }, index) => {
        const layout = layoutOf(section);
        return (
          <section key={index} className="min-w-0">
            <div className="flex min-h-7 items-center justify-between gap-2 pe-1 ps-3">
              <div className="flex min-w-0 items-center gap-2">
                {/* A lone section is named by its own disclosure, so only several need headings. */}
                {presentation.length > 1 ? (
                  <SectionLabel as="h4">{t(section.title)}</SectionLabel>
                ) : (
                  <span />
                )}
                {layout ? (
                  <SegmentedControl
                    size="sm"
                    label={t("Diff view")}
                    value={layout.layout}
                    onValueChange={(value) => setDiffChoice(value as DiffLayoutChoice)}
                    options={[
                      { value: "unified", label: t("Unified") },
                      {
                        value: "split",
                        label: t("Split"),
                        disabled: !layout.splitAvailable,
                      },
                    ]}
                  />
                ) : null}
              </div>
              {index === 0 ? (
                <div className="flex items-center gap-2">
                  <FloatingButtonGroup
                    label={t("Output actions")}
                    // Same bare icon row as the message actions: no tray padding.
                    variant="muted"
                    padding="none"
                    size="sm"
                    iconOnly
                    items={actions}
                  />
                  <LiveText
                    className="sr-only"
                    text={feedback.copied ? t("Copied") : feedback.failed ? t("Copy failed") : ""}
                  />
                </div>
              ) : null}
            </div>
            {layout?.layout === "split" ? (
              <div
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the capped split diff must stay keyboard-scrollable
                tabIndex={0}
                {...surfaceAttributes(
                  { focusRing: "inset" },
                  "max-h-80 overflow-auto overscroll-contain py-1",
                )}
              >
                <ToolInspectionSplitDiff text={section.text} wrap={wrap} />
              </div>
            ) : json ? (
              <JsonViewer data={json.data} label={t(section.title)} maxHeight={320} pageSize={50} />
            ) : (
              <OutputBlock
                tabIndex={0}
                size="caption"
                density="comfortable"
                tone={section.error ? "danger" : "secondary"}
                wrap={wrap}
                {...surfaceAttributes(
                  { focusRing: "inset" },
                  "max-h-80 overflow-auto overscroll-contain px-3 py-1",
                )}
              >
                {section.diff ? (
                  <ToolInspectionDiff text={section.text} />
                ) : section.text ? (
                  <AnsiText text={section.text} />
                ) : (
                  t(section.truncated ? "Output left out to keep this run small." : "Empty file")
                )}
              </OutputBlock>
            )}
            {(section.truncated && section.text) || section.legacy ? (
              <Text as="p" size="caption" tone="secondary" className="px-3 pt-1">
                {t(
                  section.legacy
                    ? "Only a shortened preview was saved for this older tool call."
                    : "Content shortened to keep this conversation responsive.",
                )}
              </Text>
            ) : null}
          </section>
        );
      })}
      {!sections.length && block.tool?.outputTruncated ? (
        <Text as="p" size="caption" tone="secondary" className="px-3 pt-2">
          {t("Output left out to keep this run small.")}
        </Text>
      ) : null}
    </Surface>
  );
}
