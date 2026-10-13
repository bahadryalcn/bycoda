import { t, useLocale } from "../../shared/i18n/technical";
import { useEffect, useRef, useState } from "react";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";
import { hostToolTargetKey, type HostToolTarget } from "../connections/model/hostToolTarget";
import type {
  BrowserAnnotationCapture,
  BrowserElementTarget,
} from "../../shared/lib/browserAnnotation";
import { attachBrowserSelectionAcrossWindows } from "./browserComposer";
import { BrowserAnnotationDetails } from "./BrowserAnnotationDetails";

type BrowserState = {
  open: boolean;
  url: string | null;
  controlling: boolean;
  leaseId?: string;
  leaseExpiresAt?: number;
  data?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  viewport?: { width: number; height: number };
  navigationId?: string;
  annotationId?: string;
  selection?: BrowserAnnotationCapture;
  hover?: BrowserElementTarget;
  limitation?: string;
  runtime?: { installed: boolean; installing: boolean; version: string };
};
type Frame = { src: string; width: number; height: number; navigationId?: string };
type Props = {
  cwd: string;
  initialUrl?: string;
  sessionId?: string;
  composerSessionId?: string;
  composerWindow?: string;
  hostTarget?: HostToolTarget;
  annotationsAllowed?: boolean;
  hostLabel?: string;
};

export function BrowserPanel(props: Props) {
  return (
    <ProjectBrowserPanel
      key={JSON.stringify([
        props.cwd,
        props.initialUrl,
        props.sessionId,
        props.composerSessionId,
        hostToolTargetKey(props.hostTarget ?? { kind: "project" }),
        props.annotationsAllowed ?? (!props.hostTarget || props.hostTarget.kind === "project"),
      ])}
      {...props}
    />
  );
}

/** Read on entry; frames and input remain explicit. Only the visible panel owns requests. */
function ProjectBrowserPanel({
  cwd,
  initialUrl,
  sessionId,
  composerSessionId = sessionId,
  composerWindow,
  hostTarget = { kind: "project" },
  annotationsAllowed = hostTarget.kind === "project",
  hostLabel,
}: Props) {
  useLocale();
  const [state, setState] = useState<BrowserState>();
  const [url, setUrl] = useState(initialUrl ?? "http://localhost:3000");
  const [text, setText] = useState("");
  const [frame, setFrame] = useState<Frame>();
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<BrowserAnnotationCapture>();
  const [hover, setHover] = useState<BrowserElementTarget>();
  const [comment, setComment] = useState("");
  const [limitation, setLimitation] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(false);
  const pending = useRef(false);
  const latest = useRef<BrowserState | undefined>(undefined);
  const generation = useRef(0);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const mode = useRef<{ id: string; navigationId: string } | undefined>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverReading = useRef(false);
  const hoverActive = useRef(false);
  const liveReading = useRef(false);
  const pointer = useRef({ x: 640, y: 360 });
  const hoverVersion = useRef(0);

  const resetPick = () => {
    hoverActive.current = false;
    mode.current = undefined;
    setSelecting(false);
    setSelection(undefined);
    setHover(undefined);
    setComment("");
    setLimitation("");
    hoverVersion.current++;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };

  const request = (
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<BrowserState | undefined> => {
    const version = generation.current;
    const annotation = mode.current;
    const call = serial.current
      .catch(() => {})
      .then(async () => {
        if (!alive.current || version !== generation.current) return;
        const annotationMethod = method.startsWith("browser.annotation.");
        if (method === "browser.annotation.select") setSelection(undefined);
        if (annotationMethod && !annotationsAllowed)
          throw new Error(
            t("Browser selections can be attached only on this conversation's project host."),
          );
        const capability = annotationMethod
          ? "browser.annotation"
          : method === "browser.setup"
            ? "browser.shared.setup"
            : "browser.shared";
        const parameters = {
          ...(annotationMethod
            ? { sessionId, annotationId: annotation?.id, navigationId: annotation?.navigationId }
            : method === "browser.open" && hostTarget.kind === "project" && sessionId
              ? { sessionId }
              : {}),
          ...params,
          leaseId: latest.current?.leaseId,
        };
        const result =
          annotationMethod || hostTarget.kind === "project"
            ? await hostFeatureRequest<BrowserState>(cwd, capability, method, parameters)
            : await hostToolRequest<BrowserState>(cwd, capability, method, parameters, hostTarget);
        if (!alive.current || version !== generation.current) {
          if (method === "browser.annotation.start" && result.annotationId)
            void hostFeatureRequest(cwd, "browser.annotation", "browser.annotation.cancel", {
              sessionId,
              annotationId: result.annotationId,
            }).catch(() => {});
          return;
        }
        if (
          result.controlling &&
          result.leaseExpiresAt != null &&
          result.leaseExpiresAt <= Date.now()
        ) {
          result.controlling = false;
          result.leaseId = undefined;
          result.annotationId = undefined;
        }
        if (
          mode.current &&
          (!result.controlling ||
            result.annotationId !== mode.current.id ||
            result.navigationId !== mode.current.navigationId)
        ) {
          resetPick();
          setNotice(t("Selection expired. Refresh the frame and select the element again."));
        }
        if (latest.current?.navigationId && result.navigationId !== latest.current.navigationId)
          setFrame(undefined);
        result.runtime ??= latest.current?.runtime;
        latest.current = result;
        setState(result);
        if (method === "browser.annotation.select")
          setLimitation(result.limitation ? t(result.limitation) : "");
        if (result.selection) {
          if (
            result.selection.sessionId !== sessionId ||
            result.selection.navigationId !== result.navigationId ||
            !mode.current
          )
            throw new Error(t("Browser selection belongs to another conversation"));
          setSelection(result.selection);
          setHover(undefined);
          setLimitation("");
          setFrame({
            src: `data:${result.selection.screenshot.mimeType};base64,${result.selection.screenshot.data}`,
            width: result.selection.screenshot.width,
            height: result.selection.screenshot.height,
            navigationId: result.navigationId,
          });
        }
        if (result.data)
          setFrame({
            src: `data:${result.mimeType};base64,${result.data}`,
            width: result.width ?? result.viewport?.width ?? 1280,
            height: result.height ?? result.viewport?.height ?? 720,
            navigationId: result.navigationId,
          });
        else if (!result.open || method === "browser.open") setFrame(undefined);
        return result;
      });
    serial.current = call;
    return call;
  };
  const cancelSelection = () => {
    const previous = mode.current;
    generation.current++;
    resetPick();
    pending.current = false;
    setBusy(false);
    if (previous)
      void request("browser.annotation.cancel", {
        annotationId: previous.id,
        navigationId: previous.navigationId,
      }).catch(() => {});
  };
  const inspectHover = (point: { x: number; y: number }) => {
    hoverActive.current = true;
    pointer.current = point;
    const version = ++hoverVersion.current;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (!alive.current || !mode.current || pending.current || hoverReading.current) return;
      hoverReading.current = true;
      void request("browser.annotation.hover", point)
        .then((result) => {
          if (result && mode.current && hoverVersion.current === version) {
            setHover(result.hover);
            setLimitation(result.limitation ? t(result.limitation) : "");
          }
        })
        .catch((cause) => {
          if (alive.current && mode.current)
            setLimitation(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          hoverReading.current = false;
          if (
            alive.current &&
            mode.current &&
            hoverActive.current &&
            hoverVersion.current !== version
          )
            inspectHover(pointer.current);
        });
    }, 90);
  };
  const action = async (work: () => Promise<unknown>) => {
    if (pending.current || !alive.current) return;
    pending.current = true;
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      if (alive.current && version === generation.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setSelection(undefined);
      }
    } finally {
      if (version === generation.current) {
        pending.current = false;
        if (alive.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void action(async () => {
      const status = await request("browser.status");
      if (!status) return;
      if (initialUrl) {
        const parsed = new URL(initialUrl);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
          throw new Error(t("Use an HTTP or HTTPS address."));
        const claimed = await request("browser.claim");
        if (!claimed?.controlling) throw new Error(t("Take control, then open a URL"));
        if (await request("browser.open", { url: initialUrl })) await request("browser.frame");
        return;
      }
      if (status?.url) setUrl(status.url);
      if (status?.open) await request("browser.frame");
    });
    return () => {
      alive.current = false;
      generation.current++;
      pending.current = false;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      const previous = mode.current;
      mode.current = undefined;
      if (previous)
        void serial.current
          .catch(() => {})
          .then(() =>
            hostFeatureRequest(cwd, "browser.annotation", "browser.annotation.cancel", {
              sessionId,
              annotationId: previous.id,
            }),
          )
          .catch(() => {});
    };
    // This scope is keyed by cwd. Opening a different host creates a fresh panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const expiresAt = state?.leaseExpiresAt;
    if (!state?.controlling || expiresAt == null) return;
    const timer = window.setTimeout(
      () => {
        if (latest.current?.leaseExpiresAt !== expiresAt) return;
        const expired = { ...latest.current, controlling: false, leaseId: undefined };
        const wasSelecting = !!mode.current;
        latest.current = expired;
        setState(expired);
        generation.current++;
        resetPick();
        pending.current = false;
        setBusy(false);
        setNotice(
          wasSelecting
            ? t("Selection expired. Refresh the frame and select the element again.")
            : t("Browser control ended. Open a website or claim control to interact again."),
        );
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [state?.controlling, state?.leaseExpiresAt]);
  useEffect(() => {
    if (!selecting) return;
    const timer = window.setInterval(() => {
      if (!pending.current && !hoverReading.current)
        void request("browser.status").catch(() => {
          if (!alive.current) return;
          cancelSelection();
          setNotice(t("Selection expired. Refresh the frame and select the element again."));
        });
    }, 1000);
    return () => window.clearInterval(timer);
    // This scope is keyed by project and both conversation identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting]);
  useEffect(() => {
    if (!live || !state?.open || selecting) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) return;
      if (
        !document.hidden &&
        !pending.current &&
        !hoverReading.current &&
        !liveReading.current &&
        !mode.current
      ) {
        liveReading.current = true;
        try {
          await request("browser.frame");
        } catch (cause) {
          if (!cancelled && alive.current) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setLive(false);
          }
        } finally {
          liveReading.current = false;
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // This component is keyed by the complete project and conversation scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, state?.open, selecting]);

  const input = async (params: Record<string, unknown>, onSuccess?: () => void) => {
    if (!latest.current?.open || !latest.current.controlling) return;
    if (!(await request("browser.input", params))) return;
    onSuccess?.();
    setFrame(undefined);
    try {
      await request("browser.frame");
    } catch (cause) {
      throw new Error(
        `${t("Action completed. Refresh the frame to see the result.")} ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  const canInput = !!state?.open && !!state.controlling && !busy;
  const canPageInput = canInput && !selecting;
  const setupRequired = state?.runtime?.installed === false;
  const validUrl = (() => {
    try {
      const parsed = new URL(url.trim());
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  })();

  const openWebsite = async () => {
    if (!validUrl || selecting) return;
    const current = latest.current ?? (await request("browser.status"));
    if (!current) return;
    if (current.runtime?.installed === false)
      throw new Error(t("Set up the browser on this computer, then open your website."));
    if (
      !current.controlling ||
      (current.leaseExpiresAt != null && current.leaseExpiresAt <= Date.now())
    ) {
      const claimed = await request("browser.claim");
      if (!claimed?.controlling)
        throw new Error(
          t("Browser control is unavailable. Try again when the other device releases it."),
        );
    }
    if (await request("browser.open", { url: url.trim() })) await request("browser.frame");
  };

  return (
    <section
      className="host-tool-panel"
      aria-label={t("Shared host browser")}
      aria-busy={busy}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && selecting) {
          event.preventDefault();
          event.stopPropagation();
          cancelSelection();
        }
      }}
    >
      <header className="host-tool-intro">
        <h3>
          {t("Shared host browser")}
          {hostLabel ? ` · ${hostLabel}` : ""}
        </h3>
        <p>
          {t(
            "Enter a website address and open it on this computer. Click the preview to interact, or select an element to discuss with your agent.",
          )}
        </p>
      </header>
      <div className="host-tool-toolbar">
        <span className="host-tool-status" role="status">
          {!state
            ? error
              ? t("Browser unavailable")
              : t("Checking browser…")
            : state.open
              ? t("Browser open")
              : t("Browser closed")}
        </span>
        <span className="host-tool-muted">
          {state?.controlling
            ? t("Control active · 30 seconds after each action")
            : state?.open
              ? t("View only · take control to interact")
              : t("Ready to open a website")}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void action(() => request("browser.status"))}
        >
          {!state && error ? t("Retry") : t("Status")}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? (
        <p role="status" className="host-tool-muted">
          {notice}
        </p>
      ) : null}
      <section className="host-tool-card" aria-label={t("Open a website")}>
        <form
          className="host-tool-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void action(openWebsite);
          }}
        >
          <label className="host-tool-field host-tool-grow">
            {t("Website address")}
            <input
              value={url}
              maxLength={4096}
              disabled={busy || selecting}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:3000"
              required
            />
          </label>
          <button
            type="submit"
            className="host-tool-primary"
            disabled={busy || selecting || setupRequired || !validUrl}
          >
            {t("Open website")}
          </button>
        </form>
        <p className="host-tool-muted">
          {setupRequired
            ? t("Set up the browser on this computer, then open your website.")
            : t(
                "Opening a website takes control for 30 seconds. Another device's active control is respected.",
              )}
        </p>
        {state?.url ? <p className="host-tool-location">{state.url}</p> : null}
      </section>
      {setupRequired ? (
        <section className="host-tool-card" aria-label={t("Browser setup required")}>
          <strong>{t("Browser setup required")}</strong>
          <p className="host-tool-muted">
            {t("Download the browser runtime once on this computer. Then websites can open here.")}
          </p>
          <button
            type="button"
            className="host-tool-primary"
            disabled={busy || state?.runtime?.installing}
            onClick={() => void action(() => request("browser.setup"))}
          >
            {state?.runtime?.installing ? t("Installing browser…") : t("Set up host browser")}
          </button>
        </section>
      ) : null}
      <div className="host-tool-actions">
        <button
          type="button"
          disabled={busy || !state?.open}
          onClick={() => void action(() => request("browser.frame"))}
        >
          {t("Refresh frame")}
        </button>
        <label className="host-tool-check">
          <input
            type="checkbox"
            disabled={busy || !state?.open || selecting}
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          {t("Live view")}
        </label>
        {state?.open && !state.controlling ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(() => request("browser.claim"))}
          >
            {t("Claim control")}
          </button>
        ) : null}
      </div>
      {state?.open ? (
        <div className="host-tool-toolbar">
          <button
            type="button"
            className="host-tool-primary"
            aria-pressed={selecting}
            disabled={
              !canInput || !sessionId || !frame?.navigationId || selecting || !annotationsAllowed
            }
            onClick={() =>
              void action(async () => {
                const result = await request("browser.annotation.start", {
                  navigationId: frame?.navigationId,
                });
                if (!result?.annotationId || !result.navigationId) return;
                mode.current = { id: result.annotationId, navigationId: result.navigationId };
                setSelecting(true);
                setNotice("");
                setSelection(undefined);
                setComment("");
              })
            }
          >
            {t("Select element and add to composer")}
          </button>
          {selecting ? (
            <button type="button" onClick={cancelSelection}>
              {t("Cancel selection")}
            </button>
          ) : null}
        </div>
      ) : null}
      {selecting ? (
        <p className="host-tool-muted">
          {t(
            "Point at an element and click to select. Page actions are blocked. Use arrow keys and Enter on the preview; Escape cancels.",
          )}
        </p>
      ) : null}
      {!annotationsAllowed ? (
        <p className="host-tool-muted">
          {t("Browser selections can be attached only on this conversation's project host.")}
        </p>
      ) : null}
      {limitation ? (
        <p role="status" className="host-tool-muted">
          {limitation}
        </p>
      ) : null}
      {frame ? (
        <div className="host-tool-preview">
          <div className="host-browser-surface" data-selecting={selecting}>
            <img
              src={frame.src}
              alt={t("Shared host browser screenshot; click to interact when controlling")}
              className={
                canInput ? "host-browser-frame host-frame-interactive" : "host-browser-frame"
              }
              draggable={false}
              tabIndex={canInput ? 0 : -1}
              role={selecting ? "button" : undefined}
              aria-label={
                selecting ? t("Select an element in the host browser preview") : undefined
              }
              onKeyDown={(event) => {
                if (!selecting || !canInput) return;
                const delta = (
                  {
                    ArrowUp: [0, -10],
                    ArrowDown: [0, 10],
                    ArrowLeft: [-10, 0],
                    ArrowRight: [10, 0],
                  } as Record<string, number[]>
                )[event.key];
                if (delta) {
                  event.preventDefault();
                  inspectHover({
                    x: Math.max(0, Math.min(frame.width - 1, pointer.current.x + delta[0])),
                    y: Math.max(0, Math.min(frame.height - 1, pointer.current.y + delta[1])),
                  });
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void action(() => request("browser.annotation.select", pointer.current));
                }
              }}
              onPointerMove={(event) => {
                if (!selecting || !canInput) return;
                const box = event.currentTarget.getBoundingClientRect();
                if (box.width && box.height)
                  inspectHover({
                    x: Math.max(
                      0,
                      Math.min(
                        frame.width - 1,
                        ((event.clientX - box.left) * frame.width) / box.width,
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        frame.height - 1,
                        ((event.clientY - box.top) * frame.height) / box.height,
                      ),
                    ),
                  });
              }}
              onPointerLeave={() => {
                hoverActive.current = false;
                hoverVersion.current++;
                setHover(undefined);
              }}
              onClick={(event) => {
                if (!canInput) return;
                const box = event.currentTarget.getBoundingClientRect();
                if (!box.width || !box.height) return;
                const x = Math.max(
                  0,
                  Math.min(frame.width - 1, ((event.clientX - box.left) * frame.width) / box.width),
                );
                const y = Math.max(
                  0,
                  Math.min(
                    frame.height - 1,
                    ((event.clientY - box.top) * frame.height) / box.height,
                  ),
                );
                event.preventDefault();
                pointer.current = { x, y };
                if (selecting) void action(() => request("browser.annotation.select", { x, y }));
                else void action(() => input({ kind: "click", x, y }));
              }}
            />
            {selecting
              ? [selection?.element, hover].map((element, index) =>
                  element ? (
                    <span
                      key={index}
                      className="host-browser-highlight"
                      data-selected={index === 0}
                      aria-hidden
                      style={{
                        insetInlineStart: `${(element.bounds.x / frame.width) * 100}%`,
                        insetBlockStart: `${(element.bounds.y / frame.height) * 100}%`,
                        inlineSize: `${(element.bounds.width / frame.width) * 100}%`,
                        blockSize: `${(element.bounds.height / frame.height) * 100}%`,
                      }}
                    />
                  ) : null,
                )
              : null}
          </div>
        </div>
      ) : (
        <div className="host-tool-empty">
          {state?.open
            ? t("Refresh the frame to view this page.")
            : setupRequired
              ? t("Set up the browser above to start previewing websites.")
              : t("Open a website above to see its preview here.")}
        </div>
      )}
      {selection ? (
        <section className="host-browser-selection" aria-label={t("Selected browser element")}>
          <BrowserAnnotationDetails annotation={selection} />
          <label className="host-tool-field">
            {t("Explain the selected element")}
            <textarea
              value={comment}
              maxLength={4000}
              onChange={(event) => setComment(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="host-tool-toolbar">
            <button
              type="button"
              className="host-tool-primary"
              disabled={!canInput}
              onClick={() =>
                void action(async () => {
                  const result = await request("browser.annotation.read");
                  if (!result?.selection || !composerSessionId || !sessionId) return;
                  await attachBrowserSelectionAcrossWindows(
                    cwd,
                    composerSessionId,
                    sessionId,
                    result.selection,
                    comment,
                    composerWindow,
                  );
                  cancelSelection();
                  setNotice(t("Added to composer. Review the attachment and send when ready."));
                })
              }
            >
              {t("Add selection to composer")}
            </button>
            <button
              type="button"
              disabled={!canInput}
              onClick={() =>
                void action(async () => {
                  await request("browser.annotation.clear");
                  setSelection(undefined);
                  setHover(undefined);
                  setComment("");
                })
              }
            >
              {t("Remove selection")}
            </button>
          </div>
        </section>
      ) : null}
      <details className="host-tool-help">
        <summary>{t("Keyboard and scroll controls")}</summary>
        <p>
          {t(
            "Click a field in the preview first, then type below. These controls are available while you own browser control.",
          )}
        </p>
        <form
          className="host-tool-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            if (canPageInput && text)
              void action(() => input({ kind: "text", text }, () => setText("")));
          }}
        >
          <label className="host-tool-field host-tool-grow">
            {t("Text to type into host browser")}
            <input
              value={text}
              maxLength={4096}
              disabled={!canPageInput}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button type="submit" disabled={!canPageInput || !text}>
            {t("Type text")}
          </button>
          <button
            type="button"
            disabled={!canPageInput}
            onClick={() => void action(() => input({ kind: "key", key: "Enter" }))}
          >
            {t("Enter")}
          </button>
          <button
            type="button"
            disabled={!canPageInput}
            onClick={() => void action(() => input({ kind: "scroll", y: -500 }))}
          >
            {t("Scroll up")}
          </button>
          <button
            type="button"
            disabled={!canPageInput}
            onClick={() => void action(() => input({ kind: "scroll", y: 500 }))}
          >
            {t("Scroll down")}
          </button>
        </form>
      </details>
      {busy ? (
        <p role="status" className="host-tool-muted">
          {t("Working on the host…")}
        </p>
      ) : null}
      <details className="host-tool-help">
        <summary>{t("Browser controls and setup")}</summary>
        {state?.runtime ? (
          <p className="host-tool-muted">
            {state.runtime.installing
              ? t("Installing browser…")
              : state.runtime.installed
                ? t("Browser runtime ready")
                : t("Browser setup required")}
          </p>
        ) : null}
        <div className="host-tool-toolbar">
          {!(state?.open && !state.controlling) ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(() => request("browser.claim"))}
            >
              {state?.controlling ? t("Renew control") : t("Claim control")}
            </button>
          ) : null}
          {state?.controlling ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(() => request("browser.release"))}
            >
              {t("Release")}
            </button>
          ) : null}
          {state?.open ? (
            <button
              type="button"
              disabled={!canInput}
              onClick={() => void action(() => request("browser.close"))}
            >
              {t("Close browser")}
            </button>
          ) : null}
          {!setupRequired ? (
            <button
              type="button"
              disabled={
                busy || selecting || state?.runtime?.installing || state?.runtime?.installed
              }
              onClick={() => void action(() => request("browser.setup"))}
            >
              {t("Set up host browser")}
            </button>
          ) : null}
        </div>
        <p>
          {t(
            "Download the pinned Playwright and Chromium runtime into this host’s cache. Setup runs only when requested.",
          )}
        </p>
        <p>
          {t(
            "Temporary Chromium runs on the selected machine. Authenticated devices share its view; one device controls it for 30 seconds. Setup runs only when requested.",
          )}
        </p>
      </details>
    </section>
  );
}
