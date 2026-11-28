import { Tooltip } from "../../../shared/ui/Tooltip";
import { presentRemoteError } from "../../connections/public/remoteFailure";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { MarkdownSource as IncrementalMarkdownSource } from "./markdownSource";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Code } from "../../../shared/ui/Code";
import { FoldVertical, UnfoldVertical } from "../../../shared/ui/icons";
import { Link } from "../../../shared/ui/Link";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { useLocale, useT } from "../../../shared/i18n";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveNoteImagePath } from "../../notes/notes";
import {
  openWorkspaceUrl,
  useDevelopmentLinkMachine,
} from "../../connections/public/workspaceUrls";
import { TranscriptSessionId } from "./TranscriptSessionId";
import { openExternal } from "../../../platform/tauri/openExternal";
import {
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { harden } from "rehype-harden";
import {
  Block,
  Streamdown,
  defaultRehypePlugins,
  defaultComponents,
  defaultRemarkPlugins,
  extractTableDataFromElement,
  tableDataToMarkdown,
  useIsCodeFenceIncomplete,
  type BlockProps,
  type Components,
} from "streamdown";
import type { Pluggable, PluggableList, Plugin } from "unified";
import type { Element as HastElement, Root } from "hast";
import { useRenderTrace } from "./useRenderTrace";
import { ExplorerMenu } from "../../files/public/ExplorerMenu";
import { fileLinkMenuItems } from "./fileLinkMenuItems";
import { FileActionError } from "../../files/public/FileActionError";
import { FileTypeIcon } from "../../files/public/FileTypeIcon";
import { useCodeHighlightPlugin } from "../../files/public/useCodeHighlightPlugin";
import { createLazyMermaidPlugin } from "../../files/public/mermaidPlugin";
import { displayPath, isEmailAddress, isExtensionlessFileName } from "../../../shared/lib/paths";
import { useWorkspaceFileResolver } from "../model/reactiveReads";
import type { EditorNavigation, OpenFileFn } from "../../search/model/search";
import { remarkWorkspaceFileLinks } from "../../files/public/markdownFileLinks";
import { isAtxHeadingLine } from "../../files/public/markdownSource";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  isLocalDirectory,
  browseDirectory,
  openPathWithDefaultApp,
  revealPath,
} from "../../../platform/tauri/fs";
import { ChatFolderBrowser } from "../../files/public/ChatFolderBrowser";
import { resolveFileOpenRequest } from "../../files/public/fileIndex";
import { chatPathInfo } from "../../files/public/chatPathChecks";
import { leafName } from "../../files/public/fileName";
import { isKnownFileType } from "../../../shared/lib/fileReferenceKind";
import { detectMarkdownDirection } from "../../../shared/lib/text/markdownDirection";
import {
  FileReferenceBody,
  fileReferenceChip,
  useChatPathIsDirectory,
} from "../../files/public/FileReference";
import {
  messageFileCandidates,
  resolveMessageFileReference,
  sessionFileCandidates,
} from "../../files/public/messagePathContext";
import { TranscriptToolPaths } from "./TranscriptToolPaths";
import { resolveInboxMediaUrl } from "../../inbox/model/inboxMedia";
import { isNoteImagePath } from "../../notes";
import { InboxMedia } from "../../inbox/ui/InboxMedia";
import { isLocalMediaPath, LocalMedia } from "./LocalMedia";
import { mediaKind } from "../../files/public/mediaPreview";
import { DocumentImage, ImageAltText } from "./DocumentImage";
import { resolveDocumentImage } from "../../../shared/lib/paths";
import { rehypeHoldImageSources, rehypeRestoreImageSources } from "./documentImageSources";
import { rehypeHardBreaks } from "./hardBreaks";
import {
  ADAPTIVE_FADE_MAX_MS,
  rehypeWordFade,
  useArrivalFadeWindow,
  usePacedText,
  useWordFading,
  useWordFadeWindow,
} from "./wordFade";
import { loadStreamingTextMode, subscribeStreamingTextMode } from "../../settings/public/settings";
import { usePresentationVisible } from "./presentationVisibility";
import { usePrefersReducedMotion } from "../../settings/public/decorativeMotion";
import { HighlightedCodeBlock } from "./HighlightedCodeBlock";
import { FenceCard, fenceTree } from "./FenceCard";
import { FenceViewToggle } from "./MarkdownModeToggle";
import { JsonViewer } from "../../../shared/ui/JsonViewer";
import { jsonOpenDepth, parseJsonTree } from "../../../shared/lib/jsonTree";
import { CodeRunButton } from "./CodeExecutionContext";
import { codeSourceFingerprint } from "./stableCodeDisclosureIdentity";
import { useParsedMarkdown } from "./useParsedMarkdown";
import { useMarkdownRenderBlocks } from "./useMarkdownRenderBlocks";
import { parseLocalSessionLink } from "../model/localSessionReference";
import { LocalSessionReferenceLink } from "./LocalSessionReferenceLink";
import { remarkLocalSessionLinks } from "./remarkLocalSessionLinks";
import {
  rehypeHoldLocalSessionLinks,
  rehypeRestoreLocalSessionLinks,
} from "./localSessionLinkSources";
import {
  highlightLanguageFor,
  LANGUAGE_FILE_NAMES,
  LANGUAGE_FROM_EXT,
  PLAINTEXT_FENCE_LANGUAGES,
} from "./agentMarkdownLanguages";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Alert, type AlertTone } from "../../../shared/ui/Alert";
import { createMathPlugin } from "@streamdown/math";
import remarkGemoji from "remark-gemoji";
import "katex/dist/katex.min.css";
import { rehypeMarkdownAlerts, type MarkdownAlertKind } from "./markdownAlerts";
import { remarkGuardSingleDollarMath } from "./markdownMath";
import { HtmlSnippetPreview } from "./HtmlSnippetPreview";
const MERMAID_BASE_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
} as const;
const mermaid = createLazyMermaidPlugin({
  config: {
    ...MERMAID_BASE_CONFIG,
    theme: "dark",
  },
});
// Extend href protocols with bycoda, validated before hardening and again at dispatch, and let
// media sources through to MarkdownImage, the allowlist for every image and media element.
const [sanitizeMarkdown, markdownSchema] = defaultRehypePlugins.sanitize as [
  Plugin,
  {
    protocols?: Record<string, string[]>;
    tagNames?: string[];
    attributes?: Record<string, unknown[]>;
    [key: string]: unknown;
  },
];
const WINDOWS_DRIVE_LETTERS = Array.from({ length: 26 }, (_, index) =>
  String.fromCharCode(65 + index),
).flatMap((letter) => [letter, letter.toLowerCase()]);
const LOCAL_SESSION_SANITIZE: Pluggable = [
  sanitizeMarkdown,
  {
    ...markdownSchema,
    // Raw media tags keep only their source; MarkdownMediaTag plays it like an image. A frame keeps
    // only its source and inline page: MarkdownFrameTag sandboxes the page and links the source.
    tagNames: [...(markdownSchema.tagNames ?? []), "video", "audio", "iframe", "mark", "u"],
    attributes: {
      ...markdownSchema.attributes,
      video: ["src", "title"],
      audio: ["src", "title"],
      iframe: ["src", "srcDoc", "title"],
    },
    protocols: {
      ...markdownSchema.protocols,
      href: [...(markdownSchema.protocols?.href ?? []), "bycoda"],
      // A Windows path (`G:/out/a.png`) reads as protocol `G`. MarkdownImage loads only local
      // files and `data:image/` sources, so neither reaches the page as a raw URL.
      src: [...(markdownSchema.protocols?.src ?? []), "data", ...WINDOWS_DRIVE_LETTERS],
    },
  },
];

// KaTeX output and alert kinds are made after sanitizing, so neither is author markup.
const MARKDOWN_MATH = createMathPlugin({ singleDollarTextMath: true });
const RENDERED_EXTENSIONS: PluggableList = [MARKDOWN_MATH.rehypePlugin, rehypeMarkdownAlerts];

const MARKDOWN_HARDEN: Pluggable = [
  harden,
  {
    // MarkdownImage remains the final allowlist. The wildcard lets app-owned
    // relative note URLs reach that component without changing link parsing.
    allowedImagePrefixes: ["*"],
    allowedLinkPrefixes: ["*"],
    allowDataImages: true,
    imageBlockPolicy: "remove" as const,
  },
];

// A reply's images are file paths too (`out/a.png`, `G:/out/a.png`): harden would drop them as
// URLs, so they are held aside like a document's and MarkdownImage resolves and allowlists them.
const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  defaultRehypePlugins.raw,
  LOCAL_SESSION_SANITIZE,
  rehypeHoldLocalSessionLinks,
  rehypeHoldImageSources,
  MARKDOWN_HARDEN,
  rehypeRestoreLocalSessionLinks,
  rehypeRestoreImageSources,
  ...RENDERED_EXTENSIONS,
];

const INBOX_MEDIA_REHYPE_PLUGINS: PluggableList = [
  defaultRehypePlugins.raw,
  LOCAL_SESSION_SANITIZE,
  rehypeHoldLocalSessionLinks,
  [
    harden,
    {
      defaultOrigin: "https://inbox.invalid",
      // URL recognition and native origin authorization still gate every fetched image.
      allowedImagePrefixes: ["*"],
      allowedLinkPrefixes: ["*"],
      allowDataImages: true,
      imageBlockPolicy: "remove" as const,
    },
  ],
  rehypeRestoreLocalSessionLinks,
  ...RENDERED_EXTENSIONS,
];

const DOCUMENT_REHYPE_PLUGINS: PluggableList = [
  defaultRehypePlugins.raw,
  LOCAL_SESSION_SANITIZE,
  rehypeHoldLocalSessionLinks,
  rehypeHoldImageSources,
  MARKDOWN_HARDEN,
  rehypeRestoreLocalSessionLinks,
  rehypeRestoreImageSources,
  ...RENDERED_EXTENSIONS,
];

type FileLinkMenu = {
  x: number;
  y: number;
  path: string;
  navigation?: EditorNavigation;
};

const FileOpenContext = createContext<{
  cwd?: string;
  documentPath?: string;
  onOpenFile?: OpenFileFn;
  onFileContextMenu?: (event: ReactMouseEvent, path: string, navigation?: EditorNavigation) => void;
}>({});

const RemoteMediaContext = createContext<{ enabled: boolean; base?: string }>({ enabled: false });
const LocalMediaContext = createContext(false);

// What DirectionalBlock needs to pick each block's rehype plugins. The plugin
// list handed to Streamdown never changes, so a reply that stops streaming
// keeps its mounted tree instead of remounting it (which would re-parse and
// re-highlight every code block in it).
const BlockPluginContext = createContext<{
  fading: boolean;
  fadeOptions: ReturnType<typeof useWordFadeWindow>;
  hardBreaks: boolean;
  /** Index of the last block of the text last handed to Streamdown. */
  lastBlock: number;
} | null>(null);

type MarkdownLinkProps = Omit<ComponentProps<"a">, "onContextMenu"> & {
  node?: unknown;
  previewMedia?: boolean;
  onContextMenu?: MouseEventHandler<Element>;
};

function MarkdownLink({
  href,
  children,
  className,
  node: _node,
  onClick,
  onContextMenu,
  dir,
  previewMedia = true,
  title,
  ...props
}: MarkdownLinkProps) {
  useLocale();
  const { enabled: allowRemoteMedia, base: remoteBase } = useContext(RemoteMediaContext);
  const localMedia = useContext(LocalMediaContext);
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const machine = useDevelopmentLinkMachine(cwd, href);
  const sessionId = useContext(TranscriptSessionId);
  const resolveFile = useWorkspaceFileResolver();
  const [linkError, setLinkError] = useState<string>();
  const file = href ? resolveFile(href, cwd) : undefined;
  const label = textContent(children);
  const fileLeaf = file ? leafName(file.path) : "";
  const fileSlash = !!file && /[\\/]$/.test(file.path);
  const fileVerifiedDir = useChatPathIsDirectory(
    file?.path,
    !!file && !fileSlash && !isKnownFileType(fileLeaf),
  );
  const fileIsDir = fileSlash || fileVerifiedDir;
  const fileChip = file ? fileReferenceChip(fileLeaf, fileIsDir) : undefined;
  const sessionReference = href ? parseLocalSessionLink(href) : null;
  if (href && sessionReference) {
    return (
      <LocalSessionReferenceLink
        key={href}
        href={href}
        reference={sessionReference}
        className={className}
      >
        {children}
      </LocalSessionReferenceLink>
    );
  }
  const mediaUrl = allowRemoteMedia && href ? resolveInboxMediaUrl(href, remoteBase) : null;
  if (mediaUrl) {
    return <InboxMedia src={mediaUrl} alt={label} />;
  }

  const anchor = (
    <Link
      href={href}
      unstyled={!!fileChip}
      {...fileChip}
      className={[fileChip?.className, className].filter(Boolean).join(" ") || undefined}
      {...props}
      dir={dir ?? "auto"}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (file && onOpenFile) {
          event.preventDefault();
          onOpenFile(file.path, file.navigation);
          return;
        }
        event.preventDefault();
        if (href?.startsWith("#")) {
          scrollToMessageAnchor(event.currentTarget, href.slice(1));
          return;
        }
        const open = !href
          ? undefined
          : /^https?:\/\//i.test(href)
            ? () => openWorkspaceUrl(cwd, href, sessionId)
            : /^mailto:/i.test(href)
              ? () => openExternal(href)
              : undefined;
        if (open) {
          setLinkError(undefined);
          void open().catch((error: unknown) => {
            setLinkError(presentRemoteError(error, { explicit: true }));
          });
        }
      }}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        if (event.defaultPrevented || !file || !onFileContextMenu) return;
        onFileContextMenu(event, file.path, file.navigation);
      }}
    >
      {machine ? `${machine} · ` : null}
      {file ? (
        <FileReferenceBody name={fileLeaf} isDir={fileIsDir}>
          {children}
        </FileReferenceBody>
      ) : (
        children
      )}
    </Link>
  );
  const link = (
    <>
      {/* A markdown link title (a cited source) shows in the shared tooltip, not a native one. */}
      {title ? <Tooltip label={title}>{anchor}</Tooltip> : anchor}
      {linkError ? (
        <FileActionError details={linkError} onDismiss={() => setLinkError(undefined)} />
      ) : null}
    </>
  );
  if (
    localMedia &&
    previewMedia &&
    file &&
    isLocalMediaPath(file.path) &&
    !isNoteImagePath(href ?? "")
  ) {
    return (
      <LocalMedia
        key={file.path}
        path={file.path}
        label={label || file.path}
        onOpen={onOpenFile ? () => onOpenFile(file.path, file.navigation) : undefined}
        onContextMenu={(event) => {
          onContextMenu?.(event);
          if (!event.defaultPrevented) onFileContextMenu?.(event, file.path, file.navigation);
        }}
        fallback={link}
      />
    );
  }
  return link;
}

/**
 * Scroll to an in-message anchor such as a footnote. Every reply numbers its footnotes
 * from 1, so the target is looked up inside the link's own message, not the document.
 */
function scrollToMessageAnchor(link: Element, id: string) {
  if (!id) return;
  let target: Element | null = null;
  try {
    target = (link.closest(".agent-markdown") ?? link.ownerDocument).querySelector(
      `[id="${CSS.escape(decodeURIComponent(id))}"]`,
    );
  } catch {
    // A malformed escape in the fragment names no element.
  }
  target?.scrollIntoView({ block: "nearest" });
}

type MarkdownCodeProps = ComponentProps<"code"> & { node?: unknown };

function MarkdownCode({ children, className, node, onContextMenu, ...props }: MarkdownCodeProps) {
  useLocale();
  const incomplete = useIsCodeFenceIncomplete();
  const block = Object.prototype.hasOwnProperty.call(props, "data-block");
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const localMedia = useContext(LocalMediaContext);
  const resolveFile = useWorkspaceFileResolver();
  const text = block ? "" : textContent(children);
  const slashCommand = /^\/[\p{L}\p{N}_-]+$/u.test(text.trim());
  const fileName = inlineFileName(text);
  const reference = /^[\p{L}\p{N}_-]+$/u.test(text.trim()) ? `./${text.trim()}` : text;
  const candidate =
    !block &&
    !slashCommand &&
    text.length <= 4096 &&
    /[\\/]/.test(reference) &&
    !/[\r\n]/.test(text)
      ? resolveFile(reference, cwd)
      : undefined;
  const [verified, setVerified] = useState<{ path: string; isDir: boolean }>();
  const ambiguousPath = candidate?.path;
  useEffect(() => {
    if (!ambiguousPath) return;
    let cancelled = false;
    void chatPathInfo(ambiguousPath).then((info) => {
      if (!cancelled)
        setVerified(info.exists ? { path: ambiguousPath, isDir: info.isDir } : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [ambiguousPath]);
  if (!block) {
    // A name with a known file type opens as written; any other path-like text needs the file
    // system to confirm it, so identifiers such as `images.generate` stay plain code.
    const file =
      fileName && isKnownFileType(fileName) && !text.trim().startsWith("/")
        ? resolveFile(text, cwd)
        : candidate && verified && candidate.path === verified.path
          ? candidate
          : undefined;
    const fileIsDir =
      !!file &&
      (/[\\/]$/.test(text.trim()) || (!!verified && verified.path === file.path && verified.isDir));
    const fileChip = file ? fileReferenceChip(leafName(file.path), fileIsDir) : undefined;
    const open = file && onOpenFile ? () => onOpenFile(file.path, file.navigation) : undefined;
    const span = (
      <span className="inline-flex max-w-full items-center align-baseline">
        <Code
          {...props}
          // A file reference brings its own tinted chip; other inline code keeps the neutral one.
          variant={fileChip ? "plain" : "chip"}
          size="caption"
          dir="ltr"
          {...fileChip}
          className={`inline-flex items-center gap-1 max-w-full [overflow-wrap:anywhere] align-baseline ${
            fileChip?.className ?? ""
          } ${className ?? ""}`}
          role={open ? "link" : undefined}
          tabIndex={open ? 0 : undefined}
          onClick={open}
          onContextMenu={(event) => {
            onContextMenu?.(event);
            if (event.defaultPrevented || !file || !onFileContextMenu) return;
            onFileContextMenu(event, file.path, file.navigation);
          }}
          onKeyDown={
            open
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                  }
                }
              : undefined
          }
        >
          {file ? (
            <FileReferenceBody name={leafName(file.path)} isDir={fileIsDir}>
              {children}
            </FileReferenceBody>
          ) : (
            children
          )}
        </Code>
      </span>
    );
    // A video or audio path written as code plays above its path, like a linked one.
    return localMedia && file && mediaKind(file.path) && isLocalMediaPath(file.path) ? (
      <LocalMedia key={file.path} path={file.path} label={fileName || text} fallback={span} />
    ) : (
      span
    );
  }

  const meta = codeMeta(node);
  const fence = parseCodeFence(className, meta);
  if (fence.language.toLowerCase() === "mermaid") {
    return <MermaidBlock code={textContent(children)} incomplete={incomplete} />;
  }
  const iconName = fence.fileName ?? (fence.language ? fileNameForLanguage(fence.language) : "");
  const lineNumbers = !/\bnoLineNumbers\b/.test(meta);
  const code = textContent(children);
  if (!incomplete && !fence.filePath && /^html?$/i.test(fence.language) && code.trim()) {
    return (
      <HtmlFence
        code={code}
        iconName={iconName}
        className={className}
        lineNumbers={lineNumbers}
        startLine={fence.startLine}
      />
    );
  }
  // A complete, valid JSON object or array shows as a tree with a Raw toggle. A fence that is still
  // streaming, invalid, a scalar or too large keeps the highlighted block below. Parsed once per settled text.
  const json =
    !incomplete && !fence.filePath && fence.language.toLowerCase() === "json"
      ? parseJsonTree(code)
      : null;
  if (json?.ok) {
    return (
      <JsonFence
        code={code}
        data={json.data}
        iconName={iconName}
        className={className}
        lineNumbers={lineNumbers}
        startLine={fence.startLine}
      />
    );
  }
  // highlightLanguageFor picks a grammar for plaintext fences (a detected one
  // for untagged fences), but Streamdown's CodeBlock reuses that same value
  // for the header label. Without this, an untagged fence would gain a header
  // naming a language it never declared. Render our own label with the
  // original language instead, and hide Streamdown's via CSS (see
  // .markdown-code-fallback-label in index.css).
  const isPlaintextFallback = PLAINTEXT_FENCE_LANGUAGES.has(fence.language.toLowerCase());

  return (
    <MarkdownCodeShell code={code} language={fence.language}>
      {iconName ? (
        <span className="markdown-code-icon" aria-hidden="true">
          <FileTypeIcon name={iconName} isDir={false} />
        </span>
      ) : null}
      {fence.filePath ? (
        <MarkdownCodePath path={fence.filePath} startLine={fence.startLine} />
      ) : isPlaintextFallback ? (
        <span className="markdown-code-fallback-label">{fence.language}</span>
      ) : null}
      <CodeCopyButton code={code} />
      <CodeRunButton code={code} language={fence.language} incomplete={!!incomplete} />
      <HighlightedCodeBlock
        className={className}
        code={code}
        isIncomplete={incomplete}
        language={highlightLanguageFor(fence.language, code)}
        lineNumbers={lineNumbers}
        startLine={fence.startLine}
      />
    </MarkdownCodeShell>
  );
}

function MarkdownCodeShell({
  code,
  language,
  children,
}: {
  code: string;
  language: string;
  children: ReactNode;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const label = collapsed ? t("Expand code block") : t("Collapse code block");
  // Only a collapsed block shows its summary; a streaming one would otherwise
  // split every line on every frame for nothing.
  const codeLines = collapsed ? code.replace(/\r?\n$/, "").split(/\r?\n/) : [];
  const summary = collapsed
    ? {
        preview: (codeLines.find((line) => line.trim())?.trim() || t("Code block")).slice(0, 160),
        lineCount: code ? codeLines.length : 0,
      }
    : { preview: "", lineCount: 0 };
  return (
    <div
      className="markdown-code-shell markdown-code-resizable"
      data-collapsed={collapsed}
      data-code-identity={codeSourceFingerprint(language, code)}
      dir="ltr"
      tabIndex={0}
      role="region"
      aria-label={t("Code block")}
      onPointerDown={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-streamdown="code-block-body"]')
        ) {
          event.currentTarget.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(event) => {
        if (
          !(event.ctrlKey || event.metaKey) ||
          event.altKey ||
          event.shiftKey ||
          event.key.toLowerCase() !== "c"
        )
          return;
        const selection = window.getSelection();
        if (!selection?.toString() || !selection.anchorNode || !selection.focusNode) return;
        if (
          !event.currentTarget.contains(selection.anchorNode) ||
          !event.currentTarget.contains(selection.focusNode)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        void copyText(selection.toString()).catch(() => {
          // Preserve the selection so the context-menu copy remains available.
        });
      }}
    >
      <Button
        motion="none"
        iconOnly
        label={label}
        variant="ghost"
        type="button"
        className="markdown-code-copy markdown-code-toggle"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? (
          <UnfoldVertical aria-hidden className="icon-sm" />
        ) : (
          <FoldVertical aria-hidden className="icon-sm" />
        )}
      </Button>
      {collapsed ? (
        <Button
          motion="none"
          variant="item"
          type="button"
          aria-label={`${label}: ${summary.preview}`}
          className="markdown-code-summary"
          aria-expanded={false}
          aria-controls={contentId}
          onClick={() => setCollapsed(false)}
        >
          <span className="markdown-code-summary-preview" dir="auto">
            {summary.preview}
          </span>
          <span className="markdown-code-summary-count">
            {summary.lineCount} {summary.lineCount === 1 ? t("line") : t("lines")}
          </span>
        </Button>
      ) : null}
      <div id={contentId}>{children}</div>
    </div>
  );
}

function CodeCopyButton({
  code,
  getText,
  label: labelProp,
}: {
  code: string;
  /** Read the text at click time, for content that only exists in the DOM. */
  getText?: () => string;
  label?: string;
}) {
  const t = useT();
  return (
    <CopyButton
      motion="none"
      iconOnly
      label={labelProp ?? t("Copy code")}
      className="markdown-code-copy"
      resetKeys={[code]}
      text={() => (getText ? getText() : code.replace(/\r?\n$/, ""))}
    />
  );
}

type MarkdownImageProps = ComponentProps<"img"> & { node?: unknown };

const noteImageSrcCache = new Map<string, string>();

function NoteAssetImage({
  asset,
  alt,
  ...props
}: Omit<MarkdownImageProps, "src" | "node"> & { asset: string }) {
  useLocale();
  const [src, setSrc] = useState(() => noteImageSrcCache.get(asset));

  useEffect(() => {
    if (src) return;
    let cancelled = false;
    void resolveNoteImagePath(asset)
      .then((path) => {
        const next = convertFileSrc(path);
        noteImageSrcCache.delete(asset);
        noteImageSrcCache.set(asset, next);
        while (noteImageSrcCache.size > 256) {
          const oldest = noteImageSrcCache.keys().next().value;
          if (oldest === undefined) break;
          noteImageSrcCache.delete(oldest);
        }
        if (!cancelled) setSrc(next);
      })
      .catch((error) => {
        console.warn("AgentMarkdown operation failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [asset, src]);

  return (
    <img
      {...props}
      src={src}
      alt={alt ?? ""}
      data-note-image={asset}
      draggable={false}
      loading="lazy"
    />
  );
}

function MarkdownImage({ src, alt, node: _node, ...props }: MarkdownImageProps) {
  useLocale();
  const { enabled: allowRemoteMedia, base: remoteBase } = useContext(RemoteMediaContext);
  const localMedia = useContext(LocalMediaContext);
  const { cwd, documentPath, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const resolveFile = useWorkspaceFileResolver();
  const url = typeof src === "string" ? src.trim() : "";
  const remoteUrl = allowRemoteMedia && url ? resolveInboxMediaUrl(url, remoteBase) : null;
  if (remoteUrl) return <InboxMedia src={remoteUrl} alt={alt} />;
  if (documentPath) {
    const image = cwd ? resolveDocumentImage(url, documentPath, cwd) : undefined;
    const align = (_node as { properties?: { align?: unknown } } | undefined)?.properties?.align;
    return image && cwd ? (
      <DocumentImage
        key={image.path}
        root={cwd}
        {...image}
        alt={alt}
        title={props.title}
        width={props.width}
        height={props.height}
        align={typeof align === "string" ? align : undefined}
      />
    ) : (
      <ImageAltText alt={alt} title={props.title} />
    );
  }
  if (url.startsWith("data:image/")) {
    return <img {...props} src={url} alt={alt ?? ""} />;
  }
  if (isNoteImagePath(url)) {
    return <NoteAssetImage key={url} {...props} asset={url} alt={alt} />;
  }
  const file = localMedia && url ? resolveFile(url, cwd) : undefined;
  if (file && isLocalMediaPath(file.path)) {
    return (
      <LocalMedia
        key={file.path}
        path={file.path}
        label={alt || file.path}
        onOpen={onOpenFile ? () => onOpenFile(file.path, file.navigation) : undefined}
        onContextMenu={(event) => onFileContextMenu?.(event, file.path, file.navigation)}
        fallback={
          <MarkdownLink href={url} previewMedia={false}>
            {alt || url}
          </MarkdownLink>
        }
      />
    );
  }
  // An image the reply cannot show here (an SVG, a remote picture) stays a link, never a gap.
  return url ? (
    <MarkdownLink href={url} previewMedia={false}>
      {alt || url}
    </MarkdownLink>
  ) : (
    <ImageAltText alt={alt} title={props.title} />
  );
}

const ALERT_TONE: Record<MarkdownAlertKind, AlertTone> = {
  note: "info",
  tip: "success",
  important: "info",
  warning: "warning",
  caution: "danger",
};

/** A `> [!NOTE]` quote as a titled note; any other quote stays a quote. */
function MarkdownBlockquote({
  node,
  children,
  ...props
}: ComponentProps<"blockquote"> & { node?: HastElement }) {
  const t = useT();
  const kind = node?.properties.dataMarkdownAlert as MarkdownAlertKind | undefined;
  if (!kind || !(kind in ALERT_TONE))
    return <defaultComponents.blockquote {...props}>{children}</defaultComponents.blockquote>;
  const title =
    kind === "note"
      ? t("Note")
      : kind === "tip"
        ? t("Tip")
        : kind === "important"
          ? t("Important")
          : kind === "warning"
            ? t("Warning")
            : t("Caution");
  return (
    // ui-drift-ignore: alert-role-prop -- a reply's callout is document content, not live feedback; a status role would re-announce it on every streamed render.
    <Alert tone={ALERT_TONE[kind]} title={title} role="note" data-markdown-alert={kind}>
      {children}
    </Alert>
  );
}

/**
 * A raw `<iframe>`: an inline page (`srcdoc`) runs in the visual sandbox; a remote page is never
 * embedded, it stays a link the owner can open.
 */
function MarkdownFrameTag({ src, srcDoc, title }: ComponentProps<"iframe"> & { node?: unknown }) {
  if (srcDoc?.trim())
    return (
      <FenceCard
        language={title || "html"}
        icon={null}
        toggle={null}
        actions={<CodeCopyButton code={srcDoc} />}
      >
        <HtmlSnippetPreview html={srcDoc} />
      </FenceCard>
    );
  if (src && /^https?:\/\//i.test(src))
    return (
      <MarkdownLink href={src} previewMedia={false}>
        {title || src}
      </MarkdownLink>
    );
  return <ImageAltText alt={title} />;
}

/** A raw `<video>` or `<audio>` tag plays through the same local-file allowlist as an image. */
function MarkdownMediaTag({ src, title, node }: { src?: string; title?: string; node?: unknown }) {
  return <MarkdownImage src={src} alt={title} node={node} />;
}

function MarkdownTable(props: ComponentProps<typeof defaultComponents.table>) {
  const t = useT();
  const shell = useRef<HTMLDivElement>(null);
  // Read the rendered table on click so a table still streaming in is copied
  // as it is shown, and links and inline code come out as their text.
  const getMarkdown = useCallback(() => {
    const table = shell.current?.querySelector<HTMLElement>('table[data-streamdown="table"]');
    return table ? tableDataToMarkdown(extractTableDataFromElement(table)) : "";
  }, []);
  return (
    <div ref={shell} className="markdown-table-shell">
      <CodeCopyButton code="" getText={getMarkdown} label={t("Copy table as Markdown")} />
      <defaultComponents.table {...props} />
    </div>
  );
}

/** Task markers are document content: a checked state shown, never a control that toggles. Other inputs are dropped. */
function MarkdownInput({
  node: _node,
  type,
  checked,
}: ComponentProps<"input"> & { node?: unknown }) {
  if (type !== "checkbox") return null;
  return (
    <Checkbox
      checked={!!checked}
      onChange={noopChange}
      tabIndex={-1}
      aria-readonly="true"
      className="markdown-task-marker pointer-events-none me-1 align-middle"
    />
  );
}

function noopChange() {}

const MarkdownProseContext = createContext<((text: string) => ReactNode) | undefined>(undefined);
const literalOrInteractiveTags = new Set(["a", "button", "code", "kbd", "pre", "samp", "summary"]);

function rehypeMarkdownProse() {
  return function markProse(node: Root | HastElement) {
    node.children = node.children.map((child) => {
      if (child.type === "element" && !literalOrInteractiveTags.has(child.tagName)) {
        markProse(child);
      }
      if (child.type !== "text" || !/[[@/$]/.test(child.value)) return child;
      return {
        type: "element",
        tagName: "span",
        properties: { dataMarkdownProse: true },
        children: [child],
      };
    });
  };
}

function MarkdownProseSpan({
  node,
  children,
  ...props
}: ComponentProps<"span"> & { node?: HastElement }) {
  const renderProse = useContext(MarkdownProseContext);
  const source = node?.children[0];
  if (node?.properties.dataMarkdownProse && source?.type === "text" && renderProse) {
    return <>{renderProse(source.value)}</>;
  }
  return <span {...props}>{children}</span>;
}

const MARKDOWN_COMPONENTS = {
  input: MarkdownInput,
  a: MarkdownLink,
  code: MarkdownCode,
  img: MarkdownImage,
  video: MarkdownMediaTag,
  audio: MarkdownMediaTag,
  iframe: MarkdownFrameTag,
  blockquote: MarkdownBlockquote,
  table: MarkdownTable,
} satisfies Components;
const MARKDOWN_PROSE_COMPONENTS = { ...MARKDOWN_COMPONENTS, span: MarkdownProseSpan };

/**
 * With dir="auto" Streamdown wraps each block in
 * `<div dir="..." style="display: contents">`. WebKit's triple-click then runs
 * past the block to the end of the reply, because a contents box gives the
 * selection no block boundary to stop at. Keep the per-block direction
 * but put it on a real block box; index.css zeroes its margins so spacing still
 * comes from the block inside it.
 */
const DirectionalBlock = memo(function DirectionalBlock({ dir, ...props }: BlockProps) {
  useLocale();
  // Streamdown's dir="auto" scans every historical block on each token. Use
  // the same detector here, where unchanged blocks can retain their result.
  const direction = dir ?? detectMarkdownDirection(props.content);
  const ctx = useContext(BlockPluginContext);
  // Only the block still being written fades its words: it is the only one
  // whose text changes, and a block that has been passed is re-parsed once,
  // without spans, so a long reply does not keep a span per word.
  const fade = !!ctx?.fading && props.index === ctx.lastBlock;
  const hardBreaks = !!ctx?.hardBreaks;
  const hasProseRenderer = !!useContext(MarkdownProseContext);
  const fadeOptions = ctx?.fadeOptions;
  const base = props.rehypePlugins;
  // Read newlines after word fading and before handing prose to the token renderer.
  const fadePlugin = useMemo<Pluggable>(() => [rehypeWordFade, fadeOptions], [fadeOptions]);
  const rehypePlugins = useMemo<PluggableList | undefined>(
    () =>
      fade || hardBreaks || hasProseRenderer
        ? [
            ...(base ?? []),
            ...(fade ? [fadePlugin] : []),
            ...(hardBreaks ? [rehypeHardBreaks] : []),
            ...(hasProseRenderer ? [rehypeMarkdownProse] : []),
          ]
        : base,
    [base, fade, fadePlugin, hardBreaks, hasProseRenderer],
  );
  const block = <Block {...props} rehypePlugins={rehypePlugins} />;
  return direction ? (
    <div dir={direction} className="agent-markdown-block">
      {block}
    </div>
  ) : (
    block
  );
});

export const AgentMarkdown = memo(function AgentMarkdown({
  text,
  streaming,
  revealOnMount,
  className,
  cwd,
  onOpenFile,
  allowRemoteMedia,
  remoteMediaBaseUrl,
  localMedia,
  documentPath,
  hardBreaks,
  renderProse,
  isProseLine,
}: {
  text: string;
  streaming?: boolean;
  /** Pace newly arrived output; saved or reopened output opts out. */
  revealOnMount?: boolean;
  className?: string;
  cwd?: string;
  onOpenFile?: OpenFileFn;
  allowRemoteMedia?: boolean;
  /** Provider page used to resolve relative attachment links, never local workspace paths. */
  remoteMediaBaseUrl?: string;
  /** Inline workspace media only when explicitly enabled by an agent response. */
  localMedia?: boolean;
  documentPath?: string;
  /** Show a newline inside a block as a line break, as a document does. */
  hardBreaks?: boolean;
  /** Render application tokens in prose after Markdown parsing and sanitization. */
  renderProse?: (text: string) => ReactNode;
  /** Retain lines with application tokens as prose during file auto-linking. */
  isProseLine?: (line: string) => boolean;
}) {
  const t = useT();
  const codePlugin = useCodeHighlightPlugin();
  const markdownPlugins = useMemo(() => ({ code: codePlugin, mermaid }), [codePlugin]);
  const [fileMenu, setFileMenu] = useState<FileLinkMenu | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [remoteFolder, setRemoteFolder] = useState<string>();
  const [revealRemoteOnOpen, setRevealRemoteOnOpen] = useState(false);
  // Read at click time so streaming text does not recreate the file callbacks.
  const readText = useStableCallback(() => text);
  const readToolPaths = useContext(TranscriptToolPaths);
  const resolveInMessage = useCallback(
    (path: string) => resolveMessageFileReference(path, cwd, readText(), readToolPaths?.() ?? []),
    [cwd, readText, readToolPaths],
  );
  const openFile = useCallback<OpenFileFn>(
    (...args) => {
      const [path, ...rest] = args;
      const hasContext =
        !!cwd &&
        (messageFileCandidates(path, cwd, readText()).length > 0 ||
          sessionFileCandidates(path, cwd, readToolPaths?.() ?? []).length > 0);
      if (!path.startsWith("remote://")) {
        if (!hasContext) {
          onOpenFile?.(...args);
          return;
        }
        void resolveInMessage(path).then((resolved) => onOpenFile?.(resolved, ...rest));
        return;
      }
      // Host file managers are not visible on this computer. Folders open here.
      // Remote bare names resolve against the message and session first, too.
      void (hasContext ? resolveInMessage(path) : Promise.resolve(path)).then((resolved) =>
        browseDirectory(resolved).then(
          () => {
            setRevealRemoteOnOpen(false);
            setRemoteFolder(resolved);
          },
          () => onOpenFile?.(resolved, ...rest),
        ),
      );
    },
    [cwd, onOpenFile, resolveInMessage, readText, readToolPaths],
  );
  const onRevealFile = useCallback(
    (path: string, revealLocal = false) => {
      setFileActionError(null);
      void (async () => {
        const inMessage = await resolveInMessage(path);
        const resolved = cwd ? await resolveFileOpenRequest(cwd, inMessage) : inMessage;
        if (resolved.startsWith("remote://")) {
          const folder = await browseDirectory(resolved, true);
          setRevealRemoteOnOpen(revealLocal);
          setRemoteFolder(folder.path);
          return;
        }
        if (await isLocalDirectory(resolved)) await openPathWithDefaultApp(resolved);
        else await revealPath(resolved);
      })().catch((error) =>
        setFileActionError(
          t("Could not open the containing folder: {p0}", {
            p0: presentRemoteError(error, { explicit: true }),
          }),
        ),
      );
    },
    [cwd, resolveInMessage, t],
  );
  const onFileContextMenu = useCallback(
    (event: ReactMouseEvent, path: string, navigation?: EditorNavigation) => {
      event.preventDefault();
      event.stopPropagation();
      setFileMenu({ x: event.clientX, y: event.clientY, path, navigation });
    },
    [],
  );
  const fileOpen = useMemo(
    () => ({
      cwd,
      documentPath,
      onOpenFile: onOpenFile ? openFile : undefined,
      onFileContextMenu,
    }),
    [cwd, documentPath, onOpenFile, openFile, onFileContextMenu],
  );
  const remarkPlugins = useMemo<PluggableList>(
    () => [
      ...Object.values(defaultRemarkPlugins),
      MARKDOWN_MATH.remarkPlugin,
      remarkGuardSingleDollarMath,
      remarkGemoji,
      remarkLocalSessionLinks,
      [remarkWorkspaceFileLinks, { cwd, isProseLine }],
    ],
    [cwd, isProseLine],
  );
  const remoteMedia = !!allowRemoteMedia;
  const textMode = useSyncExternalStore(
    subscribeStreamingTextMode,
    loadStreamingTextMode,
    loadStreamingTextMode,
  );
  const adaptive = textMode === "adaptive";
  const reducedMotion = usePrefersReducedMotion();
  // Keep one hook order when preferences change during an active reply.
  const paced = usePacedText(text, !!streaming, revealOnMount, !adaptive);
  const [mountEntrance, setMountEntrance] = useState(revealOnMount ?? !!streaming);
  useEffect(() => {
    setMountEntrance(false);
  }, []);
  const fading = useWordFading(
    !!streaming || paced.revealing || (adaptive && mountEntrance),
    adaptive ? ADAPTIVE_FADE_MAX_MS : undefined,
  );
  const visible = usePresentationVisible(fading);
  const fadeRoot = useRef<HTMLDivElement>(null);
  const previousPresentation = useRef({ visible, textMode, reducedMotion });
  useLayoutEffect(() => {
    const previous = previousPresentation.current;
    if (
      previous.visible !== visible ||
      previous.textMode !== textMode ||
      previous.reducedMotion !== reducedMotion
    ) {
      for (const word of fadeRoot.current?.querySelectorAll("[data-word-fade]") ?? []) {
        word.setAttribute("data-word-settled", "");
      }
    }
    previousPresentation.current = { visible, textMode, reducedMotion };
  }, [visible, textMode, reducedMotion]);
  useRenderTrace(text, paced.text, paced.revealing, streaming);
  // Only the words still fading in, in the last block, carry a span (see
  // DirectionalBlock and useWordFadeWindow), and a word keeps its element until
  // its fade is over, since dropping one mid-fade would remount it and fade it
  // again. Streamdown keeps a block's elements while its text is unchanged, so
  // the few spans on a finished reply stay, inert: the fade rule needs
  // `.word-fading`, which comes off with the fade.
  const rehypePlugins = documentPath
    ? DOCUMENT_REHYPE_PLUGINS
    : remoteMedia
      ? INBOX_MEDIA_REHYPE_PLUGINS
      : MARKDOWN_REHYPE_PLUGINS;
  // Publish the tail index with the context value. A mutable ref would let a
  // memoized former tail retain its fading plugin after a new block arrives.
  // Each message keeps its own parse, so a growing reply only lexes its open tail.
  const markdownStream = useId();
  const {
    blocks: parsedBlocks,
    pending: parsePending,
    sourceFallback,
  } = useParsedMarkdown(paced.text, markdownStream);
  const { blocks: markdownBlocks, pending: renderPending } = useMarkdownRenderBlocks(
    parsedBlocks,
    markdownStream,
  );
  const markdownPending = parsePending || renderPending;
  const lastBlock = parsedBlocks.length - 1;
  const parseBlocks = useCallback(() => markdownBlocks, [markdownBlocks]);
  // Worker parses must change children: Streamdown's memo comparator ignores the parser callback.
  const [markdownSource] = useState(() => new IncrementalMarkdownSource());
  const parsedSource = markdownSource.read(markdownBlocks);
  const pacedFadeOptions = useWordFadeWindow(paced.text);
  const arrivalFadeOptions = useArrivalFadeWindow(
    text,
    adaptive && !reducedMotion,
    visible,
    mountEntrance,
  );
  const fadeOptions = adaptive ? arrivalFadeOptions : pacedFadeOptions;
  const blockPlugins = useMemo(
    () => ({ fading, fadeOptions, hardBreaks: !!hardBreaks, lastBlock }),
    [fading, fadeOptions, hardBreaks, lastBlock],
  );
  const onFileMenuPick = async (id: string) => {
    if (!fileMenu) return;
    const menuPath = fileMenu.path;
    setFileMenu(null);
    setFileActionError(null);

    if (id === "reveal" || id === "reveal-local") {
      onRevealFile(menuPath, id === "reveal-local");
      return;
    }
    const reference = await resolveInMessage(menuPath);
    // The context menu resolves shortened paths in the same way as a click.
    const path =
      id !== "open-bycoda" && cwd
        ? await resolveFileOpenRequest(cwd, reference).catch(() => reference)
        : reference;
    if (id === "open-bycoda") {
      if (path.startsWith("remote://")) openFile(path, fileMenu.navigation);
      else if (fileMenu.navigation) onOpenFile?.(path, fileMenu.navigation);
      else onOpenFile?.(path);
      return;
    }

    let action: Promise<void>;
    switch (id) {
      case "open-default":
        action = openPathWithDefaultApp(path);
        break;
      case "copy-path":
        action = copyText(path);
        break;
      case "copy-relative-path":
        action = copyText(displayPath(path, cwd));
        break;
      default:
        return;
    }
    void action.catch((error) => {
      console.error(`Failed to run file-link action ${id}:`, error);
      setFileActionError(
        id === "open-default"
          ? t("Could not open the file in its default app: {p0}", { p0: String(error) })
          : t("Could not complete the file action: {p0}", { p0: String(error) }),
      );
    });
  };

  return (
    <RemoteMediaContext.Provider value={{ enabled: remoteMedia, base: remoteMediaBaseUrl }}>
      <LocalMediaContext.Provider value={!!localMedia}>
        <FileOpenContext.Provider value={fileOpen}>
          <BlockPluginContext.Provider value={blockPlugins}>
            <div ref={fadeRoot} className="min-w-0" aria-busy={markdownPending || undefined}>
              {sourceFallback ? (
                <>
                  <InlineMessage tone="warning">
                    {t("Formatted preview unavailable. Showing source.")}
                  </InlineMessage>
                  <div className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {paced.text}
                  </div>
                </>
              ) : (
                <MarkdownProseContext.Provider value={renderProse}>
                  <Streamdown
                    BlockComponent={DirectionalBlock}
                    className={`agent-markdown min-w-0 font-sans text-ui-body leading-6 ${fading ? "word-fading" : ""} ${className ?? ""}`}
                    components={renderProse ? MARKDOWN_PROSE_COMPONENTS : MARKDOWN_COMPONENTS}
                    controls={false}
                    isAnimating={!!streaming || paced.revealing}
                    parseIncompleteMarkdown={false}
                    parseMarkdownIntoBlocksFn={parseBlocks}
                    plugins={markdownPlugins}
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                  >
                    {parsedSource}
                  </Streamdown>
                </MarkdownProseContext.Provider>
              )}
            </div>
            {fileMenu ? (
              <ExplorerMenu
                x={fileMenu.x}
                y={fileMenu.y}
                items={fileLinkMenuItems(
                  t,
                  !!onOpenFile,
                  !!cwd,
                  fileMenu.path.startsWith("remote://"),
                )}
                ariaLabel={t("File link actions")}
                onPick={onFileMenuPick}
                onClose={() => setFileMenu(null)}
              />
            ) : null}
            {remoteFolder ? (
              <ChatFolderBrowser
                key={`${remoteFolder}:${revealRemoteOnOpen}`}
                path={remoteFolder}
                revealOnOpen={revealRemoteOnOpen}
                onOpenFile={onOpenFile}
                onClose={() => setRemoteFolder(undefined)}
              />
            ) : null}
            {fileActionError ? (
              <FileActionError
                details={fileActionError}
                onDismiss={() => setFileActionError(null)}
              />
            ) : null}
          </BlockPluginContext.Provider>
        </FileOpenContext.Provider>
      </LocalMediaContext.Provider>
    </RemoteMediaContext.Provider>
  );
});

export const MarkdownPreview = memo(function MarkdownPreview({
  text,
  streaming,
  cwd,
  documentPath,
  onOpenFile,
  header,
  hardBreaks,
}: {
  text: string;
  streaming?: boolean;
  cwd?: string;
  documentPath?: string;
  onOpenFile?: OpenFileFn;
  header?: ReactNode;
  hardBreaks?: boolean;
}) {
  const t = useT();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <div
      ref={lockOverscroll}
      tabIndex={0}
      role="region"
      aria-label={t("Markdown preview")}
      data-markdown-region="preview"
      className="markdown-preview h-full overflow-y-auto overscroll-none [overflow-anchor:none]"
    >
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {header}
        <AgentMarkdown
          text={text}
          streaming={streaming}
          cwd={cwd}
          documentPath={documentPath}
          onOpenFile={onOpenFile}
          hardBreaks={hardBreaks}
        />
      </div>
    </div>
  );
});

export const MarkdownSource = memo(function MarkdownSource({ text }: { text: string }) {
  const t = useT();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <div
      ref={lockOverscroll}
      tabIndex={0}
      role="region"
      aria-label={t("Markdown source")}
      data-markdown-region="source"
      className="markdown-preview h-full overflow-y-auto overscroll-none [overflow-anchor:none]"
    >
      <OutputBlock size="secondary" className="min-h-full min-w-0 px-4 py-3">
        <MarkdownSourceHighlight text={text} />
      </OutputBlock>
    </div>
  );
});

export function MarkdownSourceHighlight({ text }: { text: string }) {
  useLocale();
  if (!text) return null;
  return (
    <>
      {text.split(/(\n)/).map((part, index) =>
        part === "\n" ? (
          "\n"
        ) : isAtxHeadingLine(part) ? (
          <span key={index} className="markdown-source-heading">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function JsonFence({
  code,
  data,
  iconName,
  className,
  lineNumbers,
  startLine,
}: {
  code: string;
  data: object;
  iconName: string;
  className?: string;
  lineNumbers: boolean;
  startLine?: number;
}) {
  const t = useT();
  const [view, setView] = useState<"tree" | "raw">("tree");
  const icon = iconName ? <FileTypeIcon name={iconName} isDir={false} /> : null;
  const toggle = (
    <FenceViewToggle
      label={t("JSON view")}
      value={view}
      options={[
        { value: "tree", label: t("Tree") },
        { value: "raw", label: t("Raw") },
      ]}
      onChange={(next) => setView(next === "raw" ? "raw" : "tree")}
    />
  );
  if (view === "raw") {
    return (
      <MarkdownCodeShell code={code} language="json">
        {icon ? (
          <span className="markdown-code-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {toggle}
        <CodeCopyButton code={code} />
        <HighlightedCodeBlock
          className={className}
          code={code}
          isIncomplete={false}
          language="json"
          lineNumbers={lineNumbers}
          startLine={startLine}
        />
      </MarkdownCodeShell>
    );
  }
  return (
    <FenceCard language="json" icon={icon} toggle={toggle} actions={<CodeCopyButton code={code} />}>
      <JsonViewer
        data={data}
        defaultExpandDepth={jsonOpenDepth(data)}
        showPath={false}
        maxHeight={360}
        label={t("JSON tree")}
        className={fenceTree}
      />
    </FenceCard>
  );
}

/** A whole page (doctype or `<html>` first) is an output to look at; a fragment is code to read. */
const HTML_DOCUMENT = /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html)[\s>]/i;

/** An ```html fence with a Preview / Code switch; the preview runs in the inline visual sandbox. */
function HtmlFence({
  code,
  iconName,
  className,
  lineNumbers,
  startLine,
}: {
  code: string;
  iconName: string;
  className?: string;
  lineNumbers: boolean;
  startLine?: number;
}) {
  const t = useT();
  const [view, setView] = useState<"preview" | "code">(() =>
    HTML_DOCUMENT.test(code) ? "preview" : "code",
  );
  const icon = iconName ? <FileTypeIcon name={iconName} isDir={false} /> : null;
  const toggle = (
    <FenceViewToggle
      label={t("HTML view")}
      value={view}
      options={[
        { value: "preview", label: t("Preview") },
        { value: "code", label: t("Code") },
      ]}
      onChange={(next) => setView(next === "preview" ? "preview" : "code")}
    />
  );
  if (view === "code") {
    return (
      <MarkdownCodeShell code={code} language="html">
        {icon ? (
          <span className="markdown-code-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {toggle}
        <CodeCopyButton code={code} />
        <HighlightedCodeBlock
          className={className}
          code={code}
          isIncomplete={false}
          language="html"
          lineNumbers={lineNumbers}
          startLine={startLine}
        />
      </MarkdownCodeShell>
    );
  }
  return (
    <FenceCard language="html" icon={icon} toggle={toggle} actions={<CodeCopyButton code={code} />}>
      <HtmlSnippetPreview html={code} />
    </FenceCard>
  );
}

let mermaidRenderSequence = 0;
function nextMermaidRenderId() {
  return ++mermaidRenderSequence;
}

function MermaidBlock({ code, incomplete }: { code: string; incomplete: boolean }) {
  useLocale();
  // A render result belongs to the code and scheme it was made for: anything
  // else reads as loading, so no effect has to clear it.
  const [rendered, setRendered] = useState<{
    code: string;
    colorScheme: string;
    svg?: string;
    failed?: boolean;
  } | null>(null);
  const colorScheme = useColorScheme();
  const current =
    rendered && rendered.code === code && rendered.colorScheme === colorScheme ? rendered : null;
  const svg = current?.svg ?? null;
  const failed = current?.failed ?? false;
  const t = useT();
  const [view, setView] = useState<"diagram" | "source">("diagram");

  useEffect(() => {
    if (incomplete) return;
    let cancelled = false;
    const id = `mermaid-${Math.abs(hashCode(code)).toString(36)}-${nextMermaidRenderId()}`;
    void mermaid
      .getMermaid({
        ...MERMAID_BASE_CONFIG,
        theme: colorScheme === "light" ? "default" : "dark",
      })
      .render(id, code)
      .then((result) => {
        if (cancelled) return;
        setRendered({ code, colorScheme, svg: result.svg });
      })
      .catch(() => {
        if (!cancelled) setRendered({ code, colorScheme, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [code, incomplete, colorScheme]);

  const icon = <FileTypeIcon name="diagram.mmd" isDir={false} />;
  // The diagram is drawn once the fence is complete; until then (and when it cannot be drawn) only the source shows.
  const showSource = incomplete || failed || (!!svg && view === "source");
  const toggle = (
    <FenceViewToggle
      label={t("Diagram view")}
      value={view}
      options={[
        { value: "diagram", label: t("Diagram") },
        { value: "source", label: t("Source") },
      ]}
      onChange={(next) => setView(next === "source" ? "source" : "diagram")}
    />
  );
  if (showSource) {
    return (
      <MarkdownCodeShell code={code} language="mermaid">
        <span className="markdown-code-icon" aria-hidden="true">
          {icon}
        </span>
        {svg && !incomplete && !failed ? toggle : null}
        <CodeCopyButton code={code} />
        <HighlightedCodeBlock
          code={code}
          isIncomplete={incomplete}
          language="mermaid"
          lineNumbers
        />
      </MarkdownCodeShell>
    );
  }

  if (!svg) {
    return <Skeleton lines={5} className="h-32" />;
  }

  return (
    <FenceCard
      language="mermaid"
      icon={icon}
      toggle={toggle}
      actions={<CodeCopyButton code={code} />}
    >
      <div
        className="mermaid-block overflow-x-auto p-3"
        data-streamdown="mermaid-block"
        dir="ltr"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </FenceCard>
  );
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function codeMeta(node: unknown): string {
  if (!node || typeof node !== "object" || !("properties" in node)) return "";
  const properties = node.properties;
  if (!properties || typeof properties !== "object" || !("metastring" in properties)) {
    return "";
  }
  return typeof properties.metastring === "string" ? properties.metastring : "";
}

function textContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(value)) {
    return textContent(value.props.children);
  }
  return "";
}

function parseCodeFence(
  className: string | undefined,
  meta: string,
): {
  language: string;
  startLine?: number;
  fileName?: string;
  filePath?: string;
} {
  const raw = className?.match(/\blanguage-([^\s]+)/)?.[1] ?? "";
  const metaStart = meta.match(/\bstartLine=(\d+)/);
  const metaStartLine = metaStart ? Number(metaStart[1]) : undefined;
  // Markdown puts the first space-separated fence token in the language class
  // and the remainder in metastring, including spaces in a source file path.
  const pathRemainder = meta.replace(/(?:^|\s+)startLine=\d+(?=\s|$)/g, "").trim();
  const reference = pathRemainder ? `${raw} ${pathRemainder}` : raw;

  const citation = reference.match(/^(\d+):(\d+):(.+)$/);
  if (citation) {
    const filePath = citation[3];
    const fileName = filePath.split(/[/\\]/).filter(Boolean).pop() ?? filePath;
    return {
      language: languageFromFileName(fileName),
      startLine: Number(citation[1]),
      fileName,
      filePath,
    };
  }

  if (/[/\\]/.test(raw)) {
    const fileName = reference.split(/[/\\]/).filter(Boolean).pop() ?? reference;
    return {
      language: languageFromFileName(fileName),
      startLine: metaStartLine,
      fileName,
      filePath: reference,
    };
  }

  return { language: raw, startLine: metaStartLine };
}

function MarkdownCodePath({ path, startLine }: { path: string; startLine?: number }) {
  useLocale();
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const resolveFile = useWorkspaceFileResolver();
  const file = resolveFile(path, cwd);
  if (!file || !onOpenFile) {
    return <span className="markdown-code-path">{path}</span>;
  }
  const navigation =
    file.navigation ?? (startLine && startLine > 0 ? { line: startLine } : undefined);
  return (
    <span className="markdown-code-path">
      <Button
        motion="none"
        variant="ghost"
        type="button"
        className="markdown-code-path-link"
        tooltip={file.path}
        onClick={() => onOpenFile(file.path, navigation)}
        onContextMenu={(event) => onFileContextMenu?.(event, file.path, navigation)}
      >
        {path}
      </Button>
    </span>
  );
}

function languageFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : lower;
  return LANGUAGE_FROM_EXT[ext] ?? ext;
}

function fileNameForLanguage(language: string): string {
  const key = language.toLowerCase();
  return LANGUAGE_FILE_NAMES[key] ?? `code.${key}`;
}

function inlineFileName(value: string): string | undefined {
  const text = value.trim();
  if (!text || text.length > 4096 || /[\r\n]/.test(text)) return undefined;
  if (isEmailAddress(text)) return undefined;
  if (/^\/[\p{L}\p{N}_-]+$/u.test(text)) return undefined;

  const withoutLocation = text.replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, "");
  const fileName = withoutLocation.split(/[/\\]/).filter(Boolean).pop();
  if (!fileName) return undefined;

  // Explicit filesystem roots and relative directory markers also identify
  // extensionless folders. Bare protocol methods such as currentTime/read do not.
  if (
    /^(?:\/|[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|%[A-Za-z_][A-Za-z0-9_]*(?:\(x86\))?%)/i.test(text) ||
    /[\\/]$/.test(text)
  ) {
    return fileName;
  }

  if (isExtensionlessFileName(fileName)) {
    return fileName;
  }

  const extension = fileName.includes(".") ? fileName.split(".").pop() : undefined;
  // Only a recognised file type counts; `images.generate` or `logs.sources` is an identifier.
  return extension && isKnownFileType(fileName) ? fileName : undefined;
}
