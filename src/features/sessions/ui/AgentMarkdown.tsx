import { Button } from "../../../shared/ui/Button";
import { useTransientFlag } from "../../../shared/hooks/useTransientFlag";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openWorkspaceUrl } from "../../connections/model/workspaceUrls";
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
  CodeBlock,
  Streamdown,
  defaultRehypePlugins,
  defaultComponents,
  defaultRemarkPlugins,
  detectTextDirection,
  extractTableDataFromElement,
  tableDataToMarkdown,
  useIsCodeFenceIncomplete,
  type BlockProps,
  type Components,
} from "streamdown";
import type { Pluggable, PluggableList } from "unified";
import { PerformanceTraceContext } from "./performanceTraceContext";
import {
  createPerformanceTraceId,
  isPerformanceTracingEnabled,
  recordPerformanceEvent,
  startPerformanceSpan,
} from "../../../shared/lib/performanceTrace";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";
import { FileActionError } from "../../files/ui/FileActionError";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { boundedCode } from "../../files/editor/codeHighlightPlugin";
import { createLazyMermaidPlugin } from "../../files/editor/mermaidPlugin";
import {
  displayPath,
  isEmailAddress,
  isExtensionlessFileName,
  resolveWorkspaceFileReference,
} from "../../../shared/lib/paths";
import type { EditorNavigation, OpenFileFn } from "../../search/model/search";
import { remarkWorkspaceFileLinks } from "../../files/model/markdownFileLinks";
import { isAtxHeadingLine } from "../../files/model/markdownSource";
import { useColorScheme } from "../../../shared/hooks/useColorScheme";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  isLocalDirectory,
  browseDirectory,
  openPathWithDefaultApp,
  revealPath,
} from "../../../platform/tauri/fs";
import { ChatFolderBrowser } from "../../files/ui/ChatFolderBrowser";
import { Check, Copy, FolderOpen } from "../../../shared/ui/icons";
import { resolveFileOpenRequest } from "../../files/model/fileIndex";
import { existingChatPath } from "../../files/model/chatPathChecks";
import {
  messageFileCandidates,
  resolveMessageFileReference,
} from "../../files/model/messagePathContext";
import { INBOX_MEDIA_PREFIXES, isInboxMediaUrl } from "../../inbox/model/inboxMedia";
import { isNoteImagePath } from "../../notes";
import { IS_MAC, IS_WIN } from "../../../platform/tauri/platform";
import { InboxMedia } from "../../inbox/ui/InboxMedia";
import { isLocalMediaPath, LocalMedia } from "./LocalMedia";
import { rehypeHardBreaks } from "./hardBreaks";
import {
  ADAPTIVE_FADE_MAX_MS,
  rehypeWordFade,
  useArrivalFadeWindow,
  usePacedText,
  useWordFading,
  useWordFadeWindow,
} from "./wordFade";
import { loadStreamingTextMode, subscribeStreamingTextMode } from "../../settings/model/settings";
import { usePresentationVisible } from "./presentationVisibility";
import { usePrefersReducedMotion } from "../../settings/model/decorativeMotion";
import { HighlightedCodeBlock } from "./HighlightedCodeBlock";
import { parseStreamingMarkdown } from "./streamingMarkdown";

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

const MARKDOWN_PLUGINS = { code: boundedCode, mermaid };

const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      // MarkdownImage remains the final allowlist. The wildcard lets app-owned
      // relative note URLs reach that component without changing link parsing.
      allowedImagePrefixes: ["*"],
      allowedLinkPrefixes: ["*"],
      allowDataImages: true,
      imageBlockPolicy: "remove" as const,
    },
  ],
];

const INBOX_MEDIA_REHYPE_PLUGINS: PluggableList = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      defaultOrigin: "https://inbox.invalid",
      allowedImagePrefixes: INBOX_MEDIA_PREFIXES,
      allowedLinkPrefixes: ["*"],
      allowDataImages: true,
      imageBlockPolicy: "remove" as const,
    },
  ],
];

type FileLinkMenu = {
  x: number;
  y: number;
  path: string;
  navigation?: EditorNavigation;
};

const FileOpenContext = createContext<{
  cwd?: string;
  onOpenFile?: OpenFileFn;
  onRevealFile?: (path: string) => void;
  onFileContextMenu?: (event: ReactMouseEvent, path: string, navigation?: EditorNavigation) => void;
}>({});

const RemoteMediaContext = createContext(false);
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

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

function fileLinkMenuItems(
  canOpenInBycoda: boolean,
  canCopyRelativePath: boolean,
  remote = false,
): ExplorerMenuItem[] {
  return [
    {
      kind: "item",
      id: "open-bycoda",
      get label() {
        return t("Open in {p0}", { p0: PRODUCT_IDENTITY.displayName });
      },
      disabled: !canOpenInBycoda,
    },
    {
      kind: "item",
      id: "open-default",
      get label() {
        return t("Open in Default App");
      },
      disabled: remote,
    },
    {
      kind: "item",
      id: "reveal",
      label: remote ? `Open Containing Folder in ${PRODUCT_IDENTITY.displayName}` : REVEAL_LABEL,
    },
    ...(remote ? [{ kind: "item" as const, id: "reveal-local", label: REVEAL_LABEL }] : []),
    { kind: "sep" },
    {
      kind: "item",
      id: "copy-path",
      get label() {
        return t("Copy Path");
      },
    },
    ...(canCopyRelativePath
      ? [
          {
            kind: "item" as const,
            id: "copy-relative-path",
            get label() {
              return t("Copy Relative Path");
            },
          },
        ]
      : []),
  ];
}

const LANGUAGE_FROM_EXT: Record<string, string> = {
  sh: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  ts: "typescript",
  js: "javascript",
  md: "markdown",
  yml: "yaml",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
};

const LANGUAGE_FILE_NAMES: Record<string, string> = {
  bash: "code.sh",
  c: "code.c",
  cpp: "code.cpp",
  "c++": "code.cpp",
  csharp: "code.cs",
  css: "code.css",
  go: "code.go",
  html: "code.html",
  java: "code.java",
  javascript: "code.js",
  js: "code.js",
  jsx: "code.jsx",
  json: "code.json",
  markdown: "code.md",
  md: "code.md",
  php: "code.php",
  python: "code.py",
  py: "code.py",
  ruby: "code.rb",
  rust: "code.rs",
  rs: "code.rs",
  shell: "code.sh",
  sh: "code.sh",
  sql: "code.sql",
  swift: "code.swift",
  toml: "code.toml",
  ts: "code.ts",
  tsx: "code.tsx",
  typescript: "code.ts",
  xml: "code.xml",
  yaml: "code.yaml",
  yml: "code.yaml",
  zsh: "code.sh",
};

// Shiki (via Streamdown's CodeBlock) treats these as plaintext and renders no
// syntax colors at all, which is common in agent output (pseudocode, file
// trees, command output) fenced as `text` or left untagged. Falling back to
// the JS grammar for these still colors strings, numbers, and punctuation,
// matching what most agent-output fences actually look like.
const PLAINTEXT_FENCE_LANGUAGES = new Set(["text", "plaintext", "txt", ""]);

function highlightLanguageFor(language: string): string {
  return PLAINTEXT_FENCE_LANGUAGES.has(language.toLowerCase()) ? "js" : language;
}

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
  ...props
}: MarkdownLinkProps) {
  useLocale();
  const allowRemoteMedia = useContext(RemoteMediaContext);
  const localMedia = useContext(LocalMediaContext);
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const [linkError, setLinkError] = useState<string>();
  const file = href ? resolveWorkspaceFileReference(href, cwd) : undefined;
  const label = textContent(children);
  if (allowRemoteMedia && href && isInboxMediaUrl(href)) {
    return <InboxMedia src={href} alt={label} />;
  }

  const link = (
    <>
      <a
        href={href}
        className={`text-(--ui-tone-info-fg) hover:text-(--ui-tone-info-fg) hover:underline ${className ?? ""}`}
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
          if (href && /^https?:\/\//i.test(href)) {
            setLinkError(undefined);
            void openWorkspaceUrl(cwd, href).catch((error) => {
              setLinkError(error instanceof Error ? error.message : String(error));
            });
          }
        }}
        onContextMenu={(event) => {
          onContextMenu?.(event);
          if (event.defaultPrevented || !file || !onFileContextMenu) return;
          onFileContextMenu(event, file.path, file.navigation);
        }}
      >
        {children}
      </a>
      {file ? <FileRevealButton path={file.path} /> : null}
      {linkError ? (
        <FileActionError message={linkError} onDismiss={() => setLinkError(undefined)} />
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

function FileRevealButton({ path }: { path: string }) {
  // A changed reference must start unverified, even when a prior path was valid.
  return <VerifiedFileRevealButton key={path} path={path} />;
}

function VerifiedFileRevealButton({ path }: { path: string }) {
  useLocale();
  const { onRevealFile } = useContext(FileOpenContext);
  const [exists, setExists] = useState(false);
  useEffect(() => {
    if (!onRevealFile) return;
    let cancelled = false;
    void existingChatPath(path).then((confirmed) => {
      if (!cancelled) setExists(confirmed);
    });
    return () => {
      cancelled = true;
    };
  }, [path, onRevealFile]);
  if (!onRevealFile || !exists) return null;
  return (
    <Button
      motion="none"
      iconOnly
      label={t("Open containing folder")}
      variant="ghost"
      type="button"
      aria-label={t("Open containing folder")}
      title={t("Open containing folder: {p0}", { p0: path })}
      className="ml-1 shrink-0"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onRevealFile?.(path);
      }}
    >
      <FolderOpen className="size-3.5" />
    </Button>
  );
}

type MarkdownCodeProps = ComponentProps<"code"> & { node?: unknown };

function EmailCopyButton({ text }: { text: string }) {
  useLocale();
  const [copied, setCopied] = useTransientFlag(1500);
  const [failed, setFailed] = useState(false);
  const label = failed ? t("Copy failed — try again") : copied ? t("Copied") : t("Copy");
  return (
    <Button
      motion="none"
      variant="ghost"
      type="button"
      title={label}
      aria-label={label}
      className="shrink-0"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setCopied(false);
        setFailed(false);
        void copyText(text).then(
          () => setCopied(true),
          () => setFailed(true),
        );
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span className="sr-only" role="status" aria-live="polite">
        {failed || copied ? label : ""}
      </span>
    </Button>
  );
}

function MarkdownCode({ children, className, node, onContextMenu, ...props }: MarkdownCodeProps) {
  useLocale();
  const incomplete = useIsCodeFenceIncomplete();
  const block = Object.prototype.hasOwnProperty.call(props, "data-block");
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
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
      ? resolveWorkspaceFileReference(reference, cwd)
      : undefined;
  const [verifiedPath, setVerifiedPath] = useState<string>();
  const ambiguousPath = candidate?.path;
  useEffect(() => {
    if (!ambiguousPath) return;
    let cancelled = false;
    void existingChatPath(ambiguousPath).then((exists) => {
      if (!cancelled) setVerifiedPath(exists ? ambiguousPath : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [ambiguousPath]);
  if (!block) {
    const file =
      fileName && !text.trim().startsWith("/")
        ? resolveWorkspaceFileReference(text, cwd)
        : candidate?.path === verifiedPath
          ? candidate
          : undefined;
    const open = file && onOpenFile ? () => onOpenFile(file.path, file.navigation) : undefined;
    return (
      <span className="inline-flex max-w-full items-center align-baseline">
        {isEmailAddress(text) ? <EmailCopyButton key={text} text={text} /> : null}
        <code
          {...props}
          dir="ltr"
          className={`inline-flex items-center gap-1 rounded-md bg-(--ui-surface-raised) px-1.5 min-h-6 max-w-full [overflow-wrap:anywhere] align-baseline font-mono text-[0.8em] text-(--ui-tone-neutral-fg) ${
            open ? "cursor-pointer hover:text-(--ui-tone-info-fg) hover:underline" : ""
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
          {fileName && file ? (
            <span aria-hidden="true">
              <FileTypeIcon name={fileName} isDir={/[\\/]$/.test(text)} size={14} />
            </span>
          ) : null}
          {children}
        </code>
        {file && file.path === verifiedPath ? <FileRevealButton path={file.path} /> : null}
      </span>
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
  // highlightLanguageFor swaps the fence language for "js" so Shiki still
  // colors plaintext fences, but Streamdown's CodeBlock reuses that same
  // value for the header label. Without this, a `text` fence would show a
  // "js" header, and an untagged fence would gain a header it never had.
  // Render our own label with the original language instead, and hide
  // Streamdown's via CSS (see .markdown-code-fallback-label in index.css).
  const isPlaintextFallback = PLAINTEXT_FENCE_LANGUAGES.has(fence.language.toLowerCase());

  return (
    <MarkdownCodeShell code={code}>
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
      <HighlightedCodeBlock
        className={className}
        code={code}
        isIncomplete={incomplete}
        language={highlightLanguageFor(fence.language)}
        lineNumbers={lineNumbers}
        startLine={fence.startLine}
      />
    </MarkdownCodeShell>
  );
}

function MarkdownCodeShell({ code, children }: { code: string; children: ReactNode }) {
  useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const contentId = useId();
  const label = collapsed ? "Expand code block" : "Collapse code block";
  const summary = useMemo(() => {
    const lines = code.replace(/\r?\n$/, "").split(/\r?\n/);
    return {
      preview: (lines.find((line) => line.trim())?.trim() || "Code block").slice(0, 160),
      lineCount: code ? lines.length : 0,
    };
  }, [code]);

  return (
    <div
      className="markdown-code-shell markdown-code-resizable"
      data-collapsed={collapsed}
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

        title={label}
        aria-label={label}
        className="markdown-code-copy markdown-code-toggle"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        onClick={() => setCollapsed((value) => !value)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d={collapsed ? "m6 8 4 4 4-4" : "m6 12 4-4 4 4"} />
        </svg>
      </Button>
      {collapsed ? (
        <Button
          motion="none"
          variant="ghost"
          type="button"

          title={label}
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
  label = t("Copy code"),
  copiedMessage = t("Code copied."),
  className = "",
}: {
  code: string;
  /** Read the text at click time, for content that only exists in the DOM. */
  getText?: () => string;
  label?: string;
  copiedMessage?: string;
  className?: string;
}) {
  useLocale();
  const [copied, setCopied] = useTransientFlag(1500);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCopied(false);
    setFailed(false);
  }, [code]);

  return (
    <Button
      motion="none"
      variant="ghost"
      className={className}
      type="button"
      title={failed ? t("Copy failed — try again") : copied ? t("Copied") : label}
      aria-label={failed ? t("Copy failed — try again") : copied ? t("Copied") : label}

      onClick={() => {
        setFailed(false);
        const text = getText ? getText() : code.replace(/\r?\n$/, "");
        void copyText(text).then(
          () => {
            setCopied(true);
          },
          () => setFailed(true),
        );
      }}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {failed ? t("Copy failed. Try again.") : copied ? copiedMessage : ""}
      </span>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <g className="markdown-code-copy-pages">
          <path d="M12 4H6a2 2 0 0 0-2 2v6" />
          <rect x="7" y="7" width="9" height="9" rx="1.5" />
        </g>
        <path className="markdown-code-copy-check" d="M4.5 10.5 8.2 14 15.5 6.5" />
      </svg>
    </Button>
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
    void invoke<string>("notes_image_path", { asset })
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
  const allowRemoteMedia = useContext(RemoteMediaContext);
  const localMedia = useContext(LocalMediaContext);
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const url = typeof src === "string" ? src.trim() : "";
  if (url.startsWith("data:image/")) {
    return <img {...props} src={url} alt={alt ?? ""} />;
  }
  if (isNoteImagePath(url)) {
    return <NoteAssetImage {...props} asset={url} alt={alt} />;
  }
  const file = localMedia && url ? resolveWorkspaceFileReference(url, cwd) : undefined;
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
  if (!allowRemoteMedia || !url || !isInboxMediaUrl(url)) return null;
  return <InboxMedia src={url} alt={alt} />;
}

function MarkdownTable(props: ComponentProps<typeof defaultComponents.table>) {
  useLocale();
  const shell = useRef<HTMLDivElement>(null);
  // Read the rendered table on click so a table still streaming in is copied
  // as it is shown, and links and inline code come out as their text.
  const getMarkdown = useCallback(() => {
    const table = shell.current?.querySelector<HTMLElement>('table[data-streamdown="table"]');
    return table ? tableDataToMarkdown(extractTableDataFromElement(table)) : "";
  }, []);
  return (
    <div ref={shell} className="markdown-table-shell">
      <CodeCopyButton
        code=""
        getText={getMarkdown}
        label={t("Copy table as Markdown")}
        copiedMessage={t("Table copied.")}
      />
      <defaultComponents.table {...props} />
    </div>
  );
}

const MARKDOWN_COMPONENTS = {
  a: MarkdownLink,
  code: MarkdownCode,
  img: MarkdownImage,
  table: MarkdownTable,
} satisfies Components;

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
  const direction = useMemo(() => dir ?? detectTextDirection(props.content), [dir, props.content]);
  const ctx = useContext(BlockPluginContext);
  // Only the block still being written fades its words: it is the only one
  // whose text changes, and a block that has been passed is re-parsed once,
  // without spans, so a long reply does not keep a span per word.
  const fade = !!ctx?.fading && props.index === ctx.lastBlock;
  const hardBreaks = !!ctx?.hardBreaks;
  const fadeOptions = ctx?.fadeOptions;
  const base = props.rehypePlugins;
  // Hard breaks go last, so nothing after them undoes them, and after the word
  // fade, whose word spans would otherwise hide the newlines from them.
  const fadePlugin = useMemo<Pluggable>(() => [rehypeWordFade, fadeOptions], [fadeOptions]);
  const rehypePlugins = useMemo<PluggableList | undefined>(
    () =>
      fade || hardBreaks
        ? [
            ...(base ?? []),
            ...(fade ? [fadePlugin] : []),
            ...(hardBreaks ? [rehypeHardBreaks] : []),
          ]
        : base,
    [base, fade, fadePlugin, hardBreaks],
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
  localMedia,
  hardBreaks,
}: {
  text: string;
  streaming?: boolean;
  /** Pace newly arrived output; saved or reopened output opts out. */
  revealOnMount?: boolean;
  className?: string;
  cwd?: string;
  onOpenFile?: OpenFileFn;
  allowRemoteMedia?: boolean;
  /** Inline workspace media only when explicitly enabled by an agent response. */
  localMedia?: boolean;
  /** Show a newline inside a block as a line break, as a document does. */
  hardBreaks?: boolean;
}) {
  useLocale();
  const [fileMenu, setFileMenu] = useState<FileLinkMenu | null>(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [remoteFolder, setRemoteFolder] = useState<string>();
  const [revealRemoteOnOpen, setRevealRemoteOnOpen] = useState(false);
  // Read at click time so streaming text does not recreate the file callbacks.
  const textRef = useRef(text);
  textRef.current = text;
  const resolveInMessage = useCallback(
    (path: string) => resolveMessageFileReference(path, cwd, textRef.current),
    [cwd],
  );
  const openFile = useCallback<OpenFileFn>(
    (...args) => {
      const [path, ...rest] = args;
      if (!path.startsWith("remote://")) {
        if (!cwd || messageFileCandidates(path, cwd, textRef.current).length === 0) {
          onOpenFile?.(...args);
          return;
        }
        void resolveInMessage(path).then((resolved) => onOpenFile?.(resolved, ...rest));
        return;
      }
      // Host file managers are not visible on this computer. Folders open here.
      void browseDirectory(path).then(
        () => {
          setRevealRemoteOnOpen(false);
          setRemoteFolder(path);
        },
        () => onOpenFile?.(...args),
      );
    },
    [cwd, onOpenFile, resolveInMessage],
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
        setFileActionError(`Could not open the containing folder: ${String(error)}`),
      );
    },
    [cwd, resolveInMessage],
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
      onOpenFile: onOpenFile ? openFile : undefined,
      onFileContextMenu,
      onRevealFile,
    }),
    [cwd, onOpenFile, openFile, onFileContextMenu, onRevealFile],
  );
  const remarkPlugins = useMemo<PluggableList>(
    () => [...Object.values(defaultRemarkPlugins), [remarkWorkspaceFileLinks, { cwd }]],
    [cwd],
  );
  const remoteMedia = !!allowRemoteMedia;
  const textMode = useSyncExternalStore(
    subscribeStreamingTextMode,
    loadStreamingTextMode,
    loadStreamingTextMode,
  );
  const adaptive = textMode === "adaptive";
  const visible = usePresentationVisible();
  const reducedMotion = usePrefersReducedMotion();
  // Keep one hook order when preferences change during an active reply.
  const paced = usePacedText(text, !!streaming, revealOnMount, !adaptive);
  const [mountEntrance, setMountEntrance] = useState(revealOnMount ?? !!streaming);
  useEffect(() => {
    setMountEntrance(false);
  }, []);
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
  const submissionTraceId = useContext(PerformanceTraceContext);
  const paintTrace = useRef<string | null>(null);
  const firstPaintRecorded = useRef(false);
  const receivedText = useRef(text);
  useEffect(() => {
    if (!isPerformanceTracingEnabled()) return;
    if (
      firstPaintRecorded.current &&
      receivedText.current === text &&
      paintTrace.current !== submissionTraceId
    )
      return;
    receivedText.current = text;
    if (submissionTraceId && paintTrace.current !== submissionTraceId)
      firstPaintRecorded.current = false;
    paintTrace.current = submissionTraceId ?? paintTrace.current ?? createPerformanceTraceId();
    recordPerformanceEvent("renderer-receive", { items: text.length }, paintTrace.current);
  }, [text, submissionTraceId]);
  useEffect(() => {
    if (!isPerformanceTracingEnabled()) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (!firstPaintRecorded.current) {
          firstPaintRecorded.current = true;
          recordPerformanceEvent(
            "first-paint",
            { items: paced.text.length },
            paintTrace.current ?? undefined,
          );
        }
        if (!streaming && !paced.revealing)
          recordPerformanceEvent(
            "last-paint",
            { items: paced.text.length },
            paintTrace.current ?? undefined,
          );
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [paced.text, paced.revealing, streaming, submissionTraceId]);
  const fading = useWordFading(
    !!streaming || paced.revealing || (adaptive && mountEntrance),
    adaptive ? ADAPTIVE_FADE_MAX_MS : undefined,
  );
  // Only the words still fading in, in the last block, carry a span (see
  // DirectionalBlock and useWordFadeWindow), and a word keeps its element until
  // its fade is over, since dropping one mid-fade would remount it and fade it
  // again. Streamdown keeps a block's elements while its text is unchanged, so
  // the few spans on a finished reply stay, inert: the fade rule needs
  // `.word-fading`, which comes off with the fade.
  const rehypePlugins = remoteMedia ? INBOX_MEDIA_REHYPE_PLUGINS : MARKDOWN_REHYPE_PLUGINS;
  // Publish the tail index with the context value. A mutable ref would let a
  // memoized former tail retain its fading plugin after a new block arrives.
  const markdownBlocks = useMemo(() => {
    const end = startPerformanceSpan("markdown-render", { items: paced.text.length });
    const blocks = parseStreamingMarkdown(paced.text);
    end({ blocks: blocks.length });
    return blocks;
  }, [paced.text]);
  const lastBlock = markdownBlocks.length - 1;
  const parseBlocks = useCallback(() => markdownBlocks, [markdownBlocks]);
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
        `Could not ${id === "open-default" ? "open the file in its default app" : "complete the file action"}: ${String(error)}`,
      );
    });
  };

  return (
    <RemoteMediaContext.Provider value={remoteMedia}>
      <LocalMediaContext.Provider value={!!localMedia}>
        <FileOpenContext.Provider value={fileOpen}>
          <BlockPluginContext.Provider value={blockPlugins}>
            <div ref={fadeRoot} className="min-w-0">
              <Streamdown
                BlockComponent={DirectionalBlock}
                className={`agent-markdown min-w-0 font-sans text-sm leading-6 ${fading ? "word-fading" : ""} ${className ?? ""}`}
                components={MARKDOWN_COMPONENTS}
                controls={false}
                isAnimating={!!streaming || paced.revealing}
                parseIncompleteMarkdown={false}
                parseMarkdownIntoBlocksFn={parseBlocks}
                plugins={MARKDOWN_PLUGINS}
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
              >
                {paced.text}
              </Streamdown>
            </div>
            {fileMenu ? (
              <ExplorerMenu
                x={fileMenu.x}
                y={fileMenu.y}
                items={fileLinkMenuItems(
                  !!onOpenFile,
                  !!cwd,
                  fileMenu.path.startsWith("remote://"),
                )}
                ariaLabel="File link actions"
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
                message={fileActionError}
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
  onOpenFile,
  header,
  hardBreaks,
}: {
  text: string;
  streaming?: boolean;
  cwd?: string;
  onOpenFile?: OpenFileFn;
  header?: ReactNode;
  hardBreaks?: boolean;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <div
      ref={lockOverscroll}
      tabIndex={0}
      role="region"
      aria-label={t("Markdown preview")}
      className="markdown-preview h-full overflow-y-auto overscroll-none [overflow-anchor:none]"
    >
      <div className="px-6 py-8">
        {header}
        <AgentMarkdown
          text={text}
          streaming={streaming}
          cwd={cwd}
          onOpenFile={onOpenFile}
          hardBreaks={hardBreaks}
        />
      </div>
    </div>
  );
});

export const MarkdownSource = memo(function MarkdownSource({ text }: { text: string }) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <div
      ref={lockOverscroll}
      tabIndex={0}
      role="region"
      aria-label={t("Markdown source")}
      className="markdown-preview h-full overflow-y-auto overscroll-none [overflow-anchor:none]"
    >
      <pre className="min-h-full min-w-0 whitespace-pre-wrap wrap-break-word px-4 py-3 font-mono text-[13px] leading-5 text-(--ui-text-secondary)">
        <MarkdownSourceHighlight text={text} />
      </pre>
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

function MermaidBlock({ code, incomplete }: { code: string; incomplete: boolean }) {
  useLocale();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (incomplete) {
      setSvg(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    const id = `mermaid-${Math.abs(hashCode(code)).toString(36)}-${Date.now().toString(36)}`;
    void mermaid
      .getMermaid({
        ...MERMAID_BASE_CONFIG,
        theme: colorScheme === "light" ? "default" : "dark",
      })
      .render(id, code)
      .then((result) => {
        if (cancelled) return;
        setSvg(result.svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, incomplete, colorScheme]);

  if (incomplete || failed) {
    return (
      <MarkdownCodeShell code={code}>
        <span className="markdown-code-icon" aria-hidden="true">
          <FileTypeIcon name="diagram.mmd" isDir={false} />
        </span>
        <CodeCopyButton code={code} />
        <CodeBlock code={code} isIncomplete={incomplete} language="mermaid" lineNumbers={false} />
      </MarkdownCodeShell>
    );
  }

  if (!svg) {
    return (
      <div className="h-32 animate-pulse rounded-[10px] border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised)" />
    );
  }

  return (
    <div
      className="mermaid-block overflow-x-auto rounded-[10px] border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) p-3"
      data-streamdown="mermaid-block"
      dir="ltr"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
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
  const file = resolveWorkspaceFileReference(path, cwd);
  if (!file || !onOpenFile) {
    return <span className="markdown-code-path">{path}</span>;
  }
  const navigation =
    file.navigation ?? (startLine && startLine > 0 ? { line: startLine } : undefined);
  return (
    <span
      className="markdown-code-path"
      style={{ display: "flex", alignItems: "center", pointerEvents: "auto" }}
    >
      <Button
        motion="none"
        variant="ghost"
        type="button"

        style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        className="markdown-code-path-link"
        title={file.path}
        onClick={() => onOpenFile(file.path, navigation)}
        onContextMenu={(event) => onFileContextMenu?.(event, file.path, navigation)}
      >
        {path}
      </Button>
      <FileRevealButton path={file.path} />
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
  return extension && /^[a-z][a-z0-9+-]{0,11}$/i.test(extension) ? fileName : undefined;
}
