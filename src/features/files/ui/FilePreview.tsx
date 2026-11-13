import { surfaceAttributes } from "../../../shared/ui/Surface";
import { DiffStat } from "../../../shared/ui/DiffStat";
import { Text } from "../../../shared/ui/Text";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { CircleDashed, X } from "../../../shared/ui/icons";
import { MAX_PREVIEW_LINES } from "../../../integrations/harness/core/preview";
import { displayPath, resolveWorkspacePath } from "../../../shared/lib/paths";
import type { ToolPreview, ToolPreviewLine } from "../../sessions";
import { FileTypeIcon } from "./FileTypeIcon";

type Status = "pending" | "accepted" | "rejected";

const KEYWORDS = new Set([
  "import",
  "export",
  "from",
  "type",
  "interface",
  "const",
  "let",
  "var",
  "function",
  "return",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "class",
  "struct",
  "enum",
  "extends",
  "implements",
  "new",
  "async",
  "await",
  "try",
  "catch",
  "throw",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "in",
  "of",
  "as",
  "is",
  "void",
  "public",
  "private",
  "protected",
  "static",
  "default",
  "package",
  "def",
  "func",
]);

type Props = {
  preview: ToolPreview;
  status: Status;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  variant?: "card" | "popover";
};

export function FilePreview({ preview, status, cwd, onOpenFile, variant = "card" }: Props) {
  useLocale();
  const path = preview.path;
  const filePath = path ? (resolveWorkspacePath(path, cwd) ?? path) : undefined;
  const fileName = preview.fileName || fileNameOf(path);
  const lines = (preview.lines ?? [])
    .filter((line) => line.kind === "add" || line.kind === "del" || line.kind === "context")
    .slice(0, MAX_PREVIEW_LINES);
  const showDiff =
    preview.contentOnly || lines.some((line) => line.kind === "add" || line.kind === "del");
  const added = preview.additions ?? 0;
  const deleted = preview.deletions ?? 0;
  const label = path ? displayPath(path, cwd) : fileName || preview.title || "File";

  return (
    <div
      {...surfaceAttributes(
        { frame: variant === "card" ? "card" : undefined, edge: "all" },
        variant === "card"
          ? "overflow-hidden rounded-(--ui-radius-card) border-(--ui-card-border)"
          : "min-w-0",
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2">
        <FileTypeIcon name={fileName || "file"} isDir={false} />
        {filePath && onOpenFile ? (
          <Button
            variant="ghost"
            motion="none"
            type="button"
            hoverUnderline
            className="min-w-0 flex-1 text-left font-mono"
            truncate
            tooltip={path}
            tooltipWhen={path === label ? "overflow" : "always"}
            onClick={() => onOpenFile(filePath)}
          >
            {label}
          </Button>
        ) : (
          <Tooltip label={path} when={path === label ? "overflow" : "always"}>
            <Text
              truncate
              size="caption"
              tone="primary"
              weight="medium"
              className="min-w-0 flex-1 font-mono"
            >
              {label}
            </Text>
          </Tooltip>
        )}
        {added > 0 || deleted > 0 ? (
          <DiffStat
            additions={added}
            deletions={deleted}
            size="micro"
            weight="medium"
            className="shrink-0 font-sans"
          />
        ) : (
          <StatusIcon status={status} />
        )}
      </div>
      {showDiff ? (
        <>
          <div {...surfaceAttributes({ variant: "inset" }, "h-px")} />
          <div
            className={
              variant === "popover"
                ? "max-h-45 select-text overflow-auto overscroll-contain"
                : undefined
            }
            tabIndex={variant === "popover" ? 0 : undefined}
            aria-label={variant === "popover" ? t("Preview lines") : undefined}
          >
            {preview.contentOnly && !lines.length ? (
              <Text as="p" size="caption" tone="secondary" className="px-3 py-2 font-mono">
                {t("Empty file")}
              </Text>
            ) : null}
            {lines.map((line, index) => (
              <PreviewLine
                key={`${line.number ?? index}-${line.kind}-${index}`}
                line={line}
                showGutter
                scrollable={variant === "popover"}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PreviewLine({
  line,
  showGutter,
  scrollable = false,
}: {
  line: ToolPreviewLine;
  showGutter: boolean;
  scrollable?: boolean;
}) {
  useLocale();
  const bg = line.kind === "add" ? "bg-diff-add-bg" : line.kind === "del" ? "bg-diff-del-bg" : "";
  const bar =
    line.kind === "add" ? "bg-diff-add" : line.kind === "del" ? "bg-diff-del" : "bg-transparent";
  const mark = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const markTone = line.kind === "add" ? "added" : line.kind === "del" ? "removed" : "inherit";

  return (
    <div className={`relative flex items-baseline ${scrollable ? "w-max min-w-full" : ""} ${bg}`}>
      <span className={`absolute inset-y-0 left-0 w-0.5 ${bar}`} />
      <Text size="micro" tone="muted" className="w-7 shrink-0 pr-1 text-right font-mono">
        {line.number ?? " "}
      </Text>
      {showGutter ? (
        <Text
          size="micro"
          tone={markTone}
          weight="medium"
          className="w-3 shrink-0 text-center font-mono"
        >
          {mark}
        </Text>
      ) : null}
      <Text
        size="micro"
        tone="inherit"
        leading="relaxed"
        truncate={!scrollable}
        className={`min-w-0 flex-1 pr-2 font-mono ${scrollable ? "whitespace-pre" : ""}`}
      >
        {highlight(line.text, line.kind === "context")}
      </Text>
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  useLocale();
  if (status === "rejected") {
    return <X tone="danger" className="icon-sm shrink-0" strokeWidth={2} />;
  }
  if (status === "pending") {
    return <CircleDashed tone="muted" className="icon-sm shrink-0" strokeWidth={1.75} />;
  }
  return null;
}

function highlight(text: string, dimmed: boolean) {
  const dim = dimmed ? "opacity-70" : "";
  const trimmed = text.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("///") || trimmed.startsWith("#")) {
    return (
      <Text as="span" size="inherit" tone="muted" className={dim}>
        {text}
      </Text>
    );
  }

  const parts: { text: string; tone?: "success" | "warning" }[] = [];
  const regex = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index) });
    }
    const token = match[1];
    const tone = KEYWORDS.has(token) ? "success" : /^[A-Z]/.test(token) ? "warning" : undefined;
    parts.push({ text: token, tone });
    last = match.index + token.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });

  return (
    <Text as="span" size="inherit" tone="primary" className={dim}>
      {parts.map((part, index) =>
        part.tone ? (
          <Text key={index} as="span" size="inherit" tone={part.tone}>
            {part.text}
          </Text>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </Text>
  );
}

function fileNameOf(path?: string): string | undefined {
  if (!path) return undefined;
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1];
}
