import { Button } from "../../../shared/ui/Button";
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { copyMessage } from "../../../platform/tauri/clipboard";
import type { Block } from "../model/session";
import { toolResultTexts } from "../model/commandInspection";
import { boundedToolPreview } from "../model/toolInspection";
import { JsonViewer } from "../../../shared/ui/JsonViewer";

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
    tool?.detail?.trim() ||
    tool?.output?.trim() ||
    tool?.preview?.output?.trim() ||
    tool?.outputTruncated
  );
}

/** Mounted only after an explicit disclosure; never reads today's file as historical output. */
export function ToolInspectionPanel({ block }: { block: Block }) {
  const t = useT();
  const [copyState, setCopyState] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const copying = useRef(false);
  const copyGeneration = useRef(0);
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
  const bodyText = sections.map((section) => section.text).join("\n\n");
  const copyText = bodyText ? [bodyText, ...copyNotices].join("\n\n") : "";
  const resetTimer = useRef<number | null>(null);
  const clearResetTimer = () => {
    if (resetTimer.current != null) window.clearTimeout(resetTimer.current);
    resetTimer.current = null;
  };
  useEffect(() => {
    copyGeneration.current += 1;
    copying.current = false;
    clearResetTimer();
    setCopyState("idle");
    return () => {
      copyGeneration.current += 1;
      clearResetTimer();
    };
  }, [block.id, copyText]);
  const copy = () => {
    if (copying.current) return;
    copying.current = true;
    const generation = copyGeneration.current;
    setCopyState("pending");
    void copyMessage(copyText).then(
      () => {
        if (copyGeneration.current !== generation) return;
        copying.current = false;
        setCopyState("copied");
        clearResetTimer();
        resetTimer.current = window.setTimeout(() => setCopyState("idle"), 2000);
      },
      () => {
        if (copyGeneration.current !== generation) return;
        copying.current = false;
        setCopyState("failed");
      },
    );
  };

  // One quiet code-block surface: the sections are spaced, not ruled, and the
  // single Copy lives on the first heading instead of a bar of its own.
  return (
    <div
      data-tool-inspection
      className="flex min-w-0 flex-col gap-2 overflow-clip rounded-lg border border-(--color-stroke) bg-(--ui-surface-panel) pb-2"
    >
      {sections.map((section, index) => {
        const json =
          !section.diff &&
          !section.error &&
          !section.truncated &&
          section.title !== "Command" &&
          section.title !== "Written content"
            ? inspectionJson(section.text)
            : null;
        return (
          <section key={index} className="min-w-0">
            <div className="flex min-h-7 items-center justify-between gap-2 pr-1 pl-3">
              <h4 className="text-ui-caption font-medium text-(--ui-text-secondary)">
                {t(section.title)}
              </h4>
              {index === 0 ? (
                <div className="flex items-center gap-2">
                  {copyState === "failed" ? (
                    <span role="status" className="text-ui-caption text-(--ui-tone-danger-fg)">
                      {t("Copy failed")}
                    </span>
                  ) : null}
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={!copyText}
                    loading={copyState === "pending"}
                    onClick={copy}
                  >
                    {t(copyState === "copied" ? "Copied" : "Copy")}
                  </Button>
                </div>
              ) : null}
            </div>
            {json ? (
              <JsonViewer data={json.data} label={t(section.title)} maxHeight={320} pageSize={50} />
            ) : (
              <pre
                tabIndex={0}
                className={`max-h-80 min-w-0 select-text overflow-auto overscroll-contain px-3 py-1 font-mono text-ui-caption leading-5 ${section.error ? "text-(--ui-tone-danger-fg)" : "text-(--ui-text-secondary)"} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-focus-ring-color)`}
              >
                {section.diff
                  ? section.text.split("\n").map((line, lineIndex) => (
                      <span
                        key={lineIndex}
                        className={
                          line.startsWith("+")
                            ? "text-diff-add-fg"
                            : line.startsWith("-")
                              ? "text-diff-del-fg"
                              : undefined
                        }
                      >
                        {line}
                        {"\n"}
                      </span>
                    ))
                  : section.text ||
                    t(section.truncated ? "Output left out to keep this run small." : "Empty file")}
              </pre>
            )}
            {section.truncated || section.legacy ? (
              <p className="px-3 pt-1 text-ui-caption text-(--ui-text-secondary)">
                {t(
                  section.legacy
                    ? "Only a shortened preview was saved for this older tool call."
                    : "Content shortened to keep this conversation responsive.",
                )}
              </p>
            ) : null}
          </section>
        );
      })}
      {!sections.length && block.tool?.outputTruncated ? (
        <p className="px-3 pt-2 text-ui-caption text-(--ui-text-secondary)">
          {t("Output left out to keep this run small.")}
        </p>
      ) : null}
    </div>
  );
}
