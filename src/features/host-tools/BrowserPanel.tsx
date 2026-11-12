import { StatusDot } from "../../shared/ui/StatusDot";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { Text } from "../../shared/ui/Text";
import { OverflowTooltip } from "../../shared/ui/Tooltip";
import { Alert } from "../../shared/ui/Alert";
import { Heading } from "../../shared/ui/Heading";
import { Progress } from "../../shared/ui/Progress";
import { InlineError } from "../../shared/ui/InlineError";
import { DetailedInlineError } from "../../shared/ui/ErrorDetails";
import { t, useLocale } from "../../shared/i18n/technical";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RoomToolsUiContext } from "./toolsUiControl";
import { hostFeatureRequest, hostToolRequest } from "../connections/model/hostFeatureClient";
import { hostToolTargetKey, type HostToolTarget } from "../connections/model/hostToolTarget";
import type {
  BrowserAnnotationCapture,
  BrowserElementTarget,
} from "../../shared/lib/browserAnnotation";
import {
  attachBrowserSelectionAcrossWindows,
  BrowserDraftDeliveryUncertainError,
} from "./browserComposer";
import { BrowserAnnotationDetails } from "./BrowserAnnotationDetails";
import { BrowserInspectorNavigation } from "./BrowserInspectorNavigation";
import { Button } from "../../shared/ui/Button";
import { TextField } from "../../shared/ui/TextField";
import { TextareaField } from "../../shared/ui/TextareaField";
import { Popover } from "../../shared/ui/Popover";
import { InfoPopover } from "../../shared/ui/InfoPopover";
import { toolsSessionKey } from "./toolsSessionRegistry";
import {
  readBrowserDraftTransfer,
  writeBrowserDraftTransfer,
  subscribeBrowserDraftTransfer,
} from "./browserDraftTransfer";
import {
  CursorMagicSelection,
  RefreshCw,
  SlidersHorizontal,
  Globe,
  Maximize2,
  Pause,
  Play,
  MessageSquarePlus,
  X,
} from "../../shared/ui/icons";
import { BrowserControlToggle, BrowserControlsPopover } from "./ui/BrowserControls";
import { BrowserStartPage } from "./ui/BrowserStartPage";
import { rememberBrowserUrl } from "./model/browserRecents";
import { browserStatusPresentation } from "./model/browserStatus";
import { browserKeyInput } from "./model/browserKeys";
import { useBrowserLeaseKeepAlive, useBrowserLiveFrames } from "./hooks/useBrowserLiveFrames";
import { Disclosure } from "../../shared/ui/Disclosure";
import "./BrowserPanel.css";

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
  documentId?: string;
  frameSequence?: number;
  cursor?: string;
  annotationId?: string;
  selection?: BrowserAnnotationCapture;
  hover?: BrowserElementTarget;
  limitation?: string;
  runtime?: { installed: boolean; installing: boolean; version: string };
};
type Frame = {
  src: string;
  width: number;
  height: number;
  navigationId?: string;
  documentId?: string;
};
type Props = {
  cwd: string;
  initialUrl?: string;
  sessionId?: string;
  composerSessionId?: string;
  composerWindow?: string;
  hostTarget?: HostToolTarget;
  annotationsAllowed?: boolean;
  hostLabel?: string;
  active?: boolean;
  roomSubject?: RoomToolsUiContext;
  onMounted?: () => void;
};

export function BrowserPanel(props: Props) {
  return (
    <ProjectBrowserPanel
      key={JSON.stringify([
        props.cwd,
        props.initialUrl,
        props.sessionId,
        props.roomSubject && [
          props.roomSubject.environmentId,
          props.roomSubject.projectId,
          props.roomSubject.threadId,
        ],
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
  active = true,
  roomSubject,
  onMounted,
}: Props) {
  useEffect(() => {
    onMounted?.();
  }, [onMounted]);
  useLocale();
  const [state, setState] = useState<BrowserState>();
  const [url, setUrl] = useState(initialUrl ?? "http://localhost:3000");
  const [text, setText] = useState("");
  const [frame, setFrame] = useState<Frame>();
  const [cursor, setCursor] = useState<string>();
  // Mounting always starts with a status read; controls wait for it instead of
  // accepting a submit that the pending read would drop.
  const [busy, setBusy] = useState(true);
  const [live, setLive] = useState(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const initialized = useRef(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const controlsTrigger = useRef<HTMLButtonElement>(null);
  const statusTrigger = useRef<HTMLButtonElement>(null);
  const [controlsFromStatus, setControlsFromStatus] = useState(false);
  const [error, setError] = useState("");
  const [inputBlocked, setInputBlocked] = useState(
    () =>
      readBrowserDraftTransfer(cwd, sessionId, hostToolTargetKey(hostTarget))?.inputBlocked ??
      false,
  );
  const inputBlockedRef = useRef(inputBlocked);
  const [uncertainDelivery, setUncertainDelivery] = useState(
    () =>
      readBrowserDraftTransfer(cwd, sessionId, hostToolTargetKey(hostTarget))?.uncertainDelivery ??
      false,
  );
  const savedDraft = readBrowserDraftTransfer(cwd, sessionId, hostToolTargetKey(hostTarget));
  const [selecting, setSelecting] = useState(Boolean(savedDraft?.annotation));
  const [selection, setSelection] = useState<BrowserAnnotationCapture>();
  const [selectionOpen, setSelectionOpen] = useState(false);
  const selectionTrigger = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState<BrowserElementTarget>();
  const draftTarget = hostToolTargetKey(hostTarget);
  const [comment, setComment] = useState(
    () => readBrowserDraftTransfer(cwd, sessionId, draftTarget)?.comment ?? "",
  );
  const [captures, setCaptures] = useState<{ id: string; comment: string }[]>([
    ...(savedDraft?.captures ?? []),
    ...(savedDraft?.current ? [savedDraft.current] : []),
  ]);
  const [limitation, setLimitation] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(false);
  const pending = useRef(false);
  const latest = useRef<BrowserState | undefined>(undefined);
  const generation = useRef(0);
  const frameSequence = useRef(0);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const inputQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedInputs = useRef(0);
  const inputFrameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastInputFrameAt = useRef(0);
  const coalescedInput = useRef<
    | {
        params: Record<string, unknown>;
        document: string | undefined;
        lease: string | undefined;
        epoch: number;
      }
    | undefined
  >(undefined);
  const inputEpoch = useRef(0);
  const pressedPointer = useRef<{ x: number; y: number; button: string } | undefined>(undefined);
  const inputReceiver = useRef<HTMLTextAreaElement>(null);
  const previewImage = useRef<HTMLImageElement>(null);
  const wheelHandler = useRef<(event: WheelEvent) => void>(() => {});
  const completedComposition = useRef("");
  const suppressClick = useRef(false);
  const scopePromise = useRef<Promise<string> | undefined>(undefined);
  const mode = useRef<{ id: string; navigationId: string } | undefined>(savedDraft?.annotation);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverReading = useRef(false);
  const hoverActive = useRef(false);
  const liveReading = useRef(false);
  const pointer = useRef({ x: 640, y: 360 });
  const hoverVersion = useRef(0);
  const displayFrame = async (next: Frame) => {
    const sequence = ++frameSequence.current;
    const version = generation.current;
    const image = new Image();
    image.src = next.src;
    if (typeof image.decode === "function") await image.decode();
    if (alive.current && version === generation.current && sequence === frameSequence.current)
      setFrame(next);
  };
  useEffect(
    () =>
      subscribeBrowserDraftTransfer(cwd, sessionId, draftTarget, (draft) => {
        setComment(draft.comment);
        setUncertainDelivery(draft.uncertainDelivery ?? false);
        inputBlockedRef.current = draft.inputBlocked ?? false;
        setInputBlocked(inputBlockedRef.current);
        setCaptures([...(draft.captures ?? []), ...(draft.current ? [draft.current] : [])]);
        if (draft.annotation) {
          mode.current = draft.annotation;
          setSelecting(true);
        }
      }),
    [cwd, sessionId, draftTarget],
  );
  useEffect(() => {
    writeBrowserDraftTransfer(cwd, sessionId, draftTarget, {
      comment,
      captures,
      annotation: mode.current,
      current: selection ? { id: selection.id, comment } : undefined,
      uncertainDelivery,
      inputBlocked,
    });
  }, [
    cwd,
    sessionId,
    draftTarget,
    comment,
    captures,
    selecting,
    selection,
    uncertainDelivery,
    inputBlocked,
  ]);

  const resetPick = () => {
    hoverActive.current = false;
    mode.current = undefined;
    setSelecting(false);
    setSelection(undefined);
    setSelectionOpen(false);
    setHover(undefined);
    setLimitation("");
    hoverVersion.current++;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = undefined;
  };

  const request = (
    method: string,
    params: Record<string, unknown> = {},
    beside = false,
  ): Promise<BrowserState | undefined> => {
    const version = generation.current;
    const annotation = mode.current;
    // A live read runs beside the serialized requests instead of holding input behind it.
    const call = (beside ? Promise.resolve() : serial.current.catch(() => {})).then(async () => {
      if (
        !alive.current ||
        version !== generation.current ||
        (!activeRef.current &&
          method !== "browser.annotation.cancel" &&
          !(method === "browser.input" && params.kind === "pointer" && params.action === "up"))
      )
        return;
      const annotationMethod = method.startsWith("browser.annotation.");
      if (annotationMethod && !annotationsAllowed)
        throw new Error(
          t("Browser selections can be attached only on this conversation's project host."),
        );
      const capability = annotationMethod
        ? "browser.annotation"
        : method === "browser.setup"
          ? "browser.shared.setup"
          : sessionId && hostTarget.kind !== "project" && !annotationsAllowed
            ? "browser.ownerPresentationScopes.v1"
            : sessionId
              ? "browser.sessionScopes.v1"
              : "browser.shared";
      if (
        sessionId &&
        hostTarget.kind !== "project" &&
        !annotationsAllowed &&
        !scopePromise.current
      ) {
        scopePromise.current = crypto.subtle
          .digest("SHA-256", new TextEncoder().encode(toolsSessionKey({ cwd, sessionId })))
          .then((bytes) =>
            Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
              "",
            ),
          );
      }
      const ownerPresentationScope = scopePromise.current ? await scopePromise.current : undefined;
      const parameters = {
        ...(annotationMethod
          ? { sessionId, annotationId: annotation?.id, navigationId: annotation?.navigationId }
          : sessionId
            ? { sessionId }
            : {}),
        ...params,
        ...(method === "browser.annotation.select" && selection
          ? { replaceCaptureId: selection.id }
          : {}),
        ...(ownerPresentationScope ? { ownerPresentationScope } : {}),
        leaseId:
          method === "browser.input"
            ? (params.leaseId ?? latest.current?.leaseId)
            : latest.current?.leaseId,
      };
      if (
        method === "browser.input" &&
        params.leaseId &&
        (latest.current?.leaseId !== params.leaseId ||
          !latest.current.controlling ||
          (params.documentId && latest.current.documentId !== params.documentId))
      )
        throw new Error(t("Browser input was not sent because the page or control changed."));
      if (roomSubject && !roomSubject.valid())
        throw new Error("Room browser source is unavailable.");
      const result = roomSubject
        ? await invoke<BrowserState>("control_room_browser_panel_request", {
            environmentId: roomSubject.environmentId,
            projectId: roomSubject.projectId,
            threadId: roomSubject.threadId,
            projectCwd: roomSubject.cwd,
            action: method,
            input: parameters,
          })
        : annotationMethod || hostTarget.kind === "project"
          ? await hostFeatureRequest<BrowserState>(cwd, capability, method, parameters)
          : await hostToolRequest<BrowserState>(cwd, capability, method, parameters, hostTarget);
      if (roomSubject && !roomSubject.valid()) throw new Error("Room browser source changed.");
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
      if (result.viewport)
        pointer.current = {
          x: Math.min(pointer.current.x, result.viewport.width - 1),
          y: Math.min(pointer.current.y, result.viewport.height - 1),
        };
      result.runtime ??= latest.current?.runtime;
      if (result.cursor && /^[a-z-]+$/.test(result.cursor)) setCursor(result.cursor);
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
        if (method !== "browser.annotation.read") {
          setSelection(result.selection);
          setSelectionOpen(true);
          setHover(undefined);
          setLimitation("");
          await displayFrame({
            src: `data:${result.selection.screenshot.mimeType};base64,${result.selection.screenshot.data}`,
            width: result.selection.screenshot.width,
            height: result.selection.screenshot.height,
            navigationId: result.navigationId,
            documentId: result.documentId,
          });
        }
      }
      if (result.data)
        await displayFrame({
          src: `data:${result.mimeType};base64,${result.data}`,
          width: result.width ?? result.viewport?.width ?? 1280,
          height: result.height ?? result.viewport?.height ?? 720,
          navigationId: result.navigationId,
          documentId: result.documentId,
        });
      else if (!result.open) setFrame(undefined);
      return result;
    });
    if (!beside) serial.current = call;
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
    ++hoverVersion.current;
    if (hoverTimer.current || hoverReading.current) return;
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = undefined;
      if (!alive.current || !activeRef.current || !mode.current) return;
      if (pending.current || hoverReading.current) {
        inspectHover(pointer.current);
        return;
      }
      const version = hoverVersion.current;
      hoverReading.current = true;
      void request("browser.annotation.hover", pointer.current)
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
    }, 20);
  };
  const action = async (work: () => Promise<unknown>, _keepSelection?: { current: boolean }) => {
    if (pending.current || !alive.current || !activeRef.current) return;
    pending.current = true;
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      if (alive.current && version === generation.current) {
        setError(
          cause instanceof BrowserDraftDeliveryUncertainError
            ? t(cause.message)
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
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
    return () => {
      alive.current = false;
      generation.current++;
      pending.current = false;
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      if (inputFrameTimer.current) clearTimeout(inputFrameTimer.current);
      // The annotation scope can be transferred to another tools window.
      // Explicit cancel or lease expiry releases it.
    };
    // Scope is keyed by owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    if (active || !pressedPointer.current) return;
    const pressed = pressedPointer.current;
    pressedPointer.current = undefined;
    queueInput({ kind: "pointer", action: "up", ...pressed }, true);
    // Release a pressed remote pointer when presentation is hidden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
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
    if (!active || !selecting) return;
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
  }, [active, selecting]);
  const streaming = useBrowserLiveFrames({
    enabled: active && live && !!state?.open && !selecting,
    read: (after, beside) => request("browser.frame", { after, waitMs: 1000 }, beside),
    idle: () =>
      !pending.current && queuedInputs.current === 0 && !hoverReading.current && !mode.current,
    onError: (cause) => {
      if (!alive.current) return;
      inputBlockedRef.current = true;
      setInputBlocked(true);
      setError(cause instanceof Error ? cause.message : String(cause));
      setLive(false);
    },
  });
  useBrowserLeaseKeepAlive(active && !!state?.controlling, state?.leaseExpiresAt, () => {
    void request("browser.claim").catch(() => {});
  });

  const input = async (params: Record<string, unknown>, onSuccess?: () => void) => {
    if (!latest.current?.open || !latest.current.controlling) return;
    try {
      if (!(await request("browser.input", params))) return;
    } catch (cause) {
      inputBlockedRef.current = true;
      setInputBlocked(true);
      throw cause;
    }
    onSuccess?.();
    try {
      await request("browser.frame");
    } catch (cause) {
      inputBlockedRef.current = true;
      setInputBlocked(true);
      throw new Error(
        `${t("Action completed. Refresh the frame to see the result.")} ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  const scheduleInputFrame = () => {
    // The live stream already delivers the picture after each action.
    if (inputFrameTimer.current || streaming.current) return;
    inputFrameTimer.current = setTimeout(() => {
      inputFrameTimer.current = undefined;
      if (!alive.current || !activeRef.current) return;
      if (
        liveReading.current ||
        (queuedInputs.current && performance.now() - lastInputFrameAt.current < 300)
      ) {
        scheduleInputFrame();
        return;
      }
      liveReading.current = true;
      lastInputFrameAt.current = performance.now();
      void request("browser.frame")
        .catch((cause) => {
          inputBlockedRef.current = true;
          setInputBlocked(true);
          if (alive.current)
            setError(
              `${t("Action completed. Refresh the frame to see the result.")} ${cause instanceof Error ? cause.message : String(cause)}`,
            );
        })
        .finally(() => {
          liveReading.current = false;
        });
    }, 50);
  };
  const queueInput = (params: Record<string, unknown>, allowHidden = false) => {
    if (inputBlockedRef.current && !allowHidden) return;
    const expectedDocument = latest.current?.documentId ?? latest.current?.navigationId;
    const expectedLease = latest.current?.leaseId;
    const coalescible =
      params.kind === "scroll" || (params.kind === "pointer" && params.action === "move");
    const previous = coalescedInput.current;
    if (
      coalescible &&
      previous &&
      previous.document === expectedDocument &&
      previous.lease === expectedLease &&
      previous.epoch === inputEpoch.current &&
      previous.params.kind === params.kind &&
      previous.params.action === params.action
    ) {
      if (params.kind === "scroll") {
        previous.params.x = Math.max(
          -2000,
          Math.min(2000, Number(previous.params.x ?? 0) + Number(params.x ?? 0)),
        );
        previous.params.y = Math.max(
          -2000,
          Math.min(2000, Number(previous.params.y ?? 0) + Number(params.y ?? 0)),
        );
      } else previous.params = params;
      return;
    }
    coalescedInput.current = undefined;
    if (queuedInputs.current >= 32 && !(params.kind === "pointer" && params.action === "up")) {
      setError(t("Browser input queue is full. Wait for pending actions, then try again."));
      return;
    }
    const entry = {
      params,
      document: expectedDocument,
      lease: expectedLease,
      epoch: inputEpoch.current,
    };
    if (coalescible) coalescedInput.current = entry;
    const documentId = latest.current?.documentId;
    const requestId = crypto.randomUUID();
    const epoch = inputEpoch.current;
    queuedInputs.current++;
    scheduleInputFrame();
    inputQueue.current = inputQueue.current
      .catch(() => {})
      .then(async () => {
        if (coalescedInput.current === entry) coalescedInput.current = undefined;
        if (
          (epoch !== inputEpoch.current && !allowHidden) ||
          !alive.current ||
          (!activeRef.current && !allowHidden) ||
          !latest.current?.controlling ||
          !expectedLease ||
          latest.current.leaseId !== expectedLease ||
          (latest.current.documentId ?? latest.current.navigationId) !== expectedDocument
        ) {
          if (alive.current)
            setNotice(t("Browser input was not sent because the page or control changed."));
          return;
        }
        try {
          await request("browser.input", {
            ...entry.params,
            requestId,
            leaseId: expectedLease,
            ...(documentId ? { documentId } : {}),
          });
        } catch (cause) {
          inputEpoch.current++;
          inputBlockedRef.current = true;
          if (alive.current) setInputBlocked(true);
          if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        queuedInputs.current--;
        if (!queuedInputs.current && activeRef.current) scheduleInputFrame();
      });
  };
  const frameCurrent =
    !frame ||
    !state ||
    (frame.documentId && state.documentId
      ? frame.documentId === state.documentId
      : frame.navigationId === state.navigationId);
  const canInput =
    active && !!state?.open && !!state.controlling && !busy && frameCurrent && !inputBlocked;
  const canPageInput = canInput && !selecting;
  wheelHandler.current = (event) => {
    if (
      !canPageInput ||
      (document.activeElement !== previewImage.current &&
        document.activeElement !== inputReceiver.current)
    )
      return;
    event.preventDefault();
    queueInput({
      kind: "scroll",
      x: Math.max(-2000, Math.min(2000, event.deltaX)),
      y: Math.max(-2000, Math.min(2000, event.deltaY)),
    });
  };
  useEffect(() => {
    const element = previewImage.current;
    if (!element) return;
    const handle = (event: WheelEvent) => wheelHandler.current(event);
    element.addEventListener("wheel", handle, { passive: false });
    return () => element.removeEventListener("wheel", handle);
  }, [Boolean(frame)]);
  const setupRequired = state?.runtime?.installed === false;
  const validUrl = (() => {
    try {
      const parsed = new URL(url.trim());
      return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  })();

  const openWebsite = async (target = url.trim()) => {
    if ((target === url.trim() && !validUrl) || selecting) return;
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
    if (await request("browser.open", { url: target })) {
      rememberBrowserUrl(target);
      const result = await request("browser.frame");
      if (result?.data) {
        inputBlockedRef.current = false;
        setInputBlocked(false);
      }
    }
  };

  const { browserStatus, errorSummary, statusTone, statusLabel, statusDetails } =
    browserStatusPresentation({ state, error, notice, busy, setupRequired });

  return (
    <section
      className="host-tool-panel host-browser-panel"
      aria-label={t("Shared host browser")}
      aria-busy={busy}
      onKeyDownCapture={(event) => {
        if (
          event.key === "Escape" &&
          selecting &&
          !(event.target instanceof Element && event.target.closest("[data-dialog-popover]"))
        ) {
          event.preventDefault();
          event.stopPropagation();
          cancelSelection();
        }
      }}
    >
      <Heading size="item" className="sr-only">
        {t("Shared host browser")}
        {hostLabel ? ` · ${hostLabel}` : ""}
      </Heading>
      <div className="host-browser-bar">
        <form
          className="host-browser-toolbar"
          aria-label={t("Open a website")}
          onSubmit={(event) => {
            event.preventDefault();
            void action(openWebsite);
          }}
        >
          <Button
            ref={statusTrigger}
            motion="none"
            type="button"
            variant="ghost"
            iconOnly
            className="host-browser-status"
            label={statusLabel}
            tooltip={statusLabel}
            tooltipDetails={statusDetails}
            aria-haspopup="dialog"
            aria-expanded={controlsOpen && controlsFromStatus}
            onClick={() => {
              setSelectionOpen(false);
              setControlsOpen((open) => !open || !controlsFromStatus);
              setControlsFromStatus(true);
            }}
          >
            <StatusDot data-browser-status-dot="" tone={statusTone} appearance="solid" size="md" />
          </Button>
          <TextField
            fieldClassName="host-browser-url"
            label={t("Website address")}
            hideLabel
            value={url}
            maxLength={4096}
            disabled={busy || selecting}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://localhost:3000"
            required
          />
          <Button
            motion="none"
            type="submit"
            variant="ghost"
            iconOnly
            label={t("Open website")}
            disabled={busy || selecting || setupRequired || !validUrl}
          >
            <Globe className="icon-sm" aria-hidden />
          </Button>
          <Button
            motion="none"
            type="button"
            variant="ghost"
            iconOnly
            label={t("Refresh frame")}
            disabled={busy || !state?.open}
            onClick={() =>
              void action(async () => {
                const result = await request("browser.frame");
                if (result?.data) {
                  inputBlockedRef.current = false;
                  setInputBlocked(false);
                }
              })
            }
          >
            <RefreshCw className="icon-sm" aria-hidden />
          </Button>
        </form>
        <div
          className="host-browser-view-actions"
          role="toolbar"
          aria-label={t("Browser controls and setup")}
        >
          <Button
            variant="ghost"
            iconOnly
            label={t("Live view")}
            role="switch"
            aria-checked={live}
            selected={live}
            disabled={busy || !state?.open || selecting}
            onClick={() => setLive((value) => !value)}
          >
            {live ? (
              <Pause className="icon-sm" aria-hidden />
            ) : (
              <Play className="icon-sm" aria-hidden />
            )}
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={actualSize ? t("Fit preview") : t("Actual size")}
            aria-pressed={actualSize}
            selected={actualSize}
            disabled={!frame}
            onClick={() => setActualSize((value) => !value)}
          >
            <Maximize2 className="icon-sm" aria-hidden />
          </Button>
          <Button
            ref={controlsTrigger}
            variant="ghost"
            iconOnly
            label={t("Browser controls and setup")}
            aria-haspopup="dialog"
            aria-expanded={controlsOpen && !controlsFromStatus}
            selected={controlsOpen && !controlsFromStatus}
            onClick={() => {
              setSelectionOpen(false);
              setControlsOpen((open) => !open || controlsFromStatus);
              setControlsFromStatus(false);
            }}
          >
            <SlidersHorizontal className="icon-sm" aria-hidden />
          </Button>
          <Button
            motion="none"
            type="button"
            variant="ghost"
            iconOnly
            label={t("Select element and add to composer")}
            tooltip={
              !annotationsAllowed
                ? t("Browser selections can be attached only on this conversation's project host.")
                : t("Select element and add to composer")
            }
            aria-pressed={selecting}
            selected={selecting}
            disabled={
              !canInput || !sessionId || !frame?.navigationId || selecting || !annotationsAllowed
            }
            onClick={() =>
              void action(async () => {
                await inputQueue.current.catch(() => {});
                if (inputFrameTimer.current) {
                  clearTimeout(inputFrameTimer.current);
                  inputFrameTimer.current = undefined;
                }
                const fresh = await request("browser.frame");
                if (!fresh?.navigationId) return;
                const result = await request("browser.annotation.start", {
                  navigationId: fresh.navigationId,
                });
                if (!result?.annotationId || !result.navigationId) return;
                mode.current = { id: result.annotationId, navigationId: result.navigationId };
                setSelecting(true);
                setNotice("");
                setSelection(undefined);
                setControlsOpen(false);
              })
            }
          >
            <CursorMagicSelection className="icon-sm" aria-hidden />
          </Button>
          {selecting ? (
            <Button
              type="button"
              variant="ghost"
              iconOnly
              label={t("Cancel selection")}
              onClick={cancelSelection}
            >
              <X className="icon-sm" aria-hidden />
            </Button>
          ) : null}
          {selection || captures.length ? (
            <Button
              ref={selectionTrigger}
              type="button"
              variant="ghost"
              iconOnly
              label={t("Selected browser element")}
              aria-haspopup="dialog"
              aria-expanded={selectionOpen}
              selected={selectionOpen}
              onClick={() => {
                setControlsOpen(false);
                setSelectionOpen((value) => !value);
              }}
            >
              <MessageSquarePlus className="icon-sm" aria-hidden />
            </Button>
          ) : null}
          {state?.open ? (
            <BrowserControlToggle
              controlling={state.controlling}
              busy={busy}
              action={action}
              request={request}
            />
          ) : null}
        </div>
        {busy ? (
          <Progress
            compact
            tone="neutral"
            className="host-browser-progress"
            aria-label={t("Working on the host…")}
          />
        ) : null}
      </div>
      {/* State, failures and notices are shown by the status dot's tooltip and
          the controls popover; screen readers still hear them here. */}
      <span className="sr-only" role="status">
        {statusLabel}
        {notice ? ` · ${notice}` : ""}
      </span>
      {error && !selectionOpen ? <InlineError icon={null}>{errorSummary}</InlineError> : null}
      {setupRequired ? (
        <Text
          as="section"
          size="caption"
          tone="inherit"
          leading="inherit"
          className="host-browser-setup"
          aria-label={t("Browser setup required")}
        >
          <Text size="inherit" tone="inherit" weight="medium" leading="inherit" as="strong">
            {t("Browser setup required")}
          </Text>
          <Button
            motion="none"
            type="button"
            variant="primary"
            disabled={busy || state?.runtime?.installing}
            onClick={() => void action(() => request("browser.setup"))}
          >
            {state?.runtime?.installing ? t("Installing browser…") : t("Set up host browser")}
          </Button>
        </Text>
      ) : null}
      <div className="host-browser-workspace" data-has-selection={Boolean(selection)}>
        <div className="host-browser-stage">
          {selecting ? (
            <Text
              size="micro"
              tone="inherit"
              leading="inherit"
              as="div"
              {...surfaceAttributes(
                { variant: "raised", radius: "popup" },
                "host-browser-selection-mode",
              )}
            >
              <span>{t("Select element")}</span>
              <InfoPopover>
                <p>
                  {t(
                    "Point at an element and click to select. Page actions are blocked. Use arrow keys and Enter on the preview; Escape cancels.",
                  )}
                </p>
              </InfoPopover>
            </Text>
          ) : null}
          {limitation ? <Alert tone="info">{limitation}</Alert> : null}
          {!frameCurrent ? (
            <Alert tone="info">{t("Action completed. Refresh the frame to see the result.")}</Alert>
          ) : null}
          {frame ? (
            <div
              className="host-tool-preview host-browser-preview"
              data-actual-size={actualSize}
              style={
                {
                  "--host-browser-aspect": frame.width / frame.height,
                  "--host-browser-width": `${frame.width}px`,
                } as CSSProperties
              }
            >
              <div className="host-browser-surface" data-selecting={selecting}>
                <img
                  ref={previewImage}
                  src={frame.src}
                  alt={t("Shared host browser screenshot; click to interact when controlling")}
                  className={
                    canInput ? "host-browser-frame host-frame-interactive" : "host-browser-frame"
                  }
                  style={canPageInput && cursor ? { cursor } : undefined}
                  draggable={false}
                  tabIndex={canInput ? 0 : -1}
                  role={selecting ? "button" : undefined}
                  aria-label={
                    selecting ? t("Select an element in the host browser preview") : undefined
                  }
                  onKeyDown={(event) => {
                    if (!canInput) return;
                    if (!selecting) {
                      const key = browserKeyInput(event);
                      if (key) {
                        event.preventDefault();
                        queueInput(key);
                      } else if (
                        event.key.length === 1 &&
                        !event.ctrlKey &&
                        !event.altKey &&
                        !event.metaKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        queueInput({ kind: "text", text: event.key });
                      }
                      return;
                    }
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
                  onPaste={(event) => {
                    if (!canPageInput) return;
                    const text = event.clipboardData.getData("text/plain");
                    if (text && text.length <= 4096) {
                      event.preventDefault();
                      queueInput({ kind: "text", text });
                    }
                  }}
                  onCompositionEnd={(event) => {
                    if (canPageInput && event.data) queueInput({ kind: "text", text: event.data });
                  }}
                  onPointerDown={(event) => {
                    if (!canPageInput || event.button > 2) return;
                    const box = event.currentTarget.getBoundingClientRect();
                    if (!box.width || !box.height) return;
                    const x = Math.max(
                      0,
                      Math.min(
                        frame.width - 1,
                        ((event.clientX - box.left) * frame.width) / box.width,
                      ),
                    );
                    const y = Math.max(
                      0,
                      Math.min(
                        frame.height - 1,
                        ((event.clientY - box.top) * frame.height) / box.height,
                      ),
                    );
                    const button = ["left", "middle", "right"][event.button];
                    event.currentTarget.focus();
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    pressedPointer.current = { x, y, button };
                    suppressClick.current = event.button === 0;
                    queueInput({ kind: "pointer", action: "down", x, y, button });
                  }}
                  onPointerMove={(event) => {
                    if (canPageInput) {
                      const box = event.currentTarget.getBoundingClientRect();
                      if (!box.width || !box.height) return;
                      const x = Math.max(
                        0,
                        Math.min(
                          frame.width - 1,
                          ((event.clientX - box.left) * frame.width) / box.width,
                        ),
                      );
                      const y = Math.max(
                        0,
                        Math.min(
                          frame.height - 1,
                          ((event.clientY - box.top) * frame.height) / box.height,
                        ),
                      );
                      if (pressedPointer.current)
                        pressedPointer.current = { ...pressedPointer.current, x, y };
                      queueInput({ kind: "pointer", action: "move", x, y });
                      return;
                    }
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
                  onPointerUp={(event) => {
                    const pressed = pressedPointer.current;
                    pressedPointer.current = undefined;
                    if (pressed) {
                      const box = event.currentTarget.getBoundingClientRect();
                      const x = box.width
                        ? Math.max(
                            0,
                            Math.min(
                              frame.width - 1,
                              ((event.clientX - box.left) * frame.width) / box.width,
                            ),
                          )
                        : pressed.x;
                      const y = box.height
                        ? Math.max(
                            0,
                            Math.min(
                              frame.height - 1,
                              ((event.clientY - box.top) * frame.height) / box.height,
                            ),
                          )
                        : pressed.y;
                      queueInput({ kind: "pointer", action: "up", ...pressed, x, y }, true);
                      if (event.currentTarget.hasPointerCapture?.(event.pointerId))
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      inputReceiver.current?.focus();
                    }
                  }}
                  onPointerCancel={() => {
                    const pressed = pressedPointer.current;
                    pressedPointer.current = undefined;
                    if (pressed) queueInput({ kind: "pointer", action: "up", ...pressed }, true);
                  }}
                  onLostPointerCapture={() => {
                    const pressed = pressedPointer.current;
                    pressedPointer.current = undefined;
                    if (pressed) queueInput({ kind: "pointer", action: "up", ...pressed }, true);
                  }}
                  onBlur={() => {
                    const pressed = pressedPointer.current;
                    pressedPointer.current = undefined;
                    if (pressed) queueInput({ kind: "pointer", action: "up", ...pressed }, true);
                  }}
                  onPointerLeave={() => {
                    hoverActive.current = false;
                    hoverVersion.current++;
                    setHover(undefined);
                  }}
                  onClick={(event) => {
                    if (suppressClick.current) {
                      suppressClick.current = false;
                      return;
                    }
                    if (!canInput) return;
                    if (selecting && captures.length >= 8) {
                      setError(t("Remove a selection before capturing another element."));
                      return;
                    }
                    const box = event.currentTarget.getBoundingClientRect();
                    if (!box.width || !box.height) return;
                    const x = Math.max(
                      0,
                      Math.min(
                        frame.width - 1,
                        ((event.clientX - box.left) * frame.width) / box.width,
                      ),
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
                    if (selecting)
                      void action(() => request("browser.annotation.select", { x, y }));
                    else queueInput({ kind: "click", x, y });
                  }}
                />
                <TextareaField
                  ref={inputReceiver}
                  fieldClassName="host-browser-input-receiver"
                  label={t("Direct browser input")}
                  hideLabel
                  tabIndex={-1}
                  onKeyDown={(event) => {
                    if (!canPageInput || event.nativeEvent.isComposing) return;
                    const key = browserKeyInput(event);
                    if (!key) return;
                    event.preventDefault();
                    queueInput(key);
                  }}
                  onInput={(event) => {
                    const target = event.currentTarget;
                    if (
                      !canPageInput ||
                      (event.nativeEvent as InputEvent).isComposing ||
                      !target.value
                    )
                      return;
                    if (completedComposition.current === target.value) {
                      completedComposition.current = "";
                      target.value = "";
                      return;
                    }
                    if (target.value.length > 4096) {
                      setError(t("Browser unavailable"));
                      return;
                    }
                    queueInput({ kind: "text", text: target.value });
                    target.value = "";
                  }}
                  onCompositionEnd={(event) => {
                    if (canPageInput && event.data) {
                      completedComposition.current = event.data;
                      queueInput({ kind: "text", text: event.data });
                      setTimeout(() => {
                        completedComposition.current = "";
                      }, 0);
                    }
                    event.currentTarget.value = "";
                  }}
                />
                {selecting && (hover ?? selection?.element)?.boxModel
                  ? Object.entries((hover ?? selection!.element).boxModel!).map(
                      ([part, bounds]) => (
                        <span
                          key={part}
                          className="host-browser-box-model"
                          data-part={part}
                          aria-hidden
                          style={{
                            insetInlineStart: `${(bounds.x / frame.width) * 100}%`,
                            insetBlockStart: `${(bounds.y / frame.height) * 100}%`,
                            inlineSize: `${(bounds.width / frame.width) * 100}%`,
                            blockSize: `${(bounds.height / frame.height) * 100}%`,
                          }}
                        />
                      ),
                    )
                  : null}
                {selecting &&
                  (hover ?? selection?.element)?.layout?.childBounds?.map((bounds, index) => (
                    <span
                      key={`child-${index}`}
                      className="host-browser-box-model host-browser-child-bound"
                      aria-hidden
                      style={{
                        insetInlineStart: `${(bounds.x / frame.width) * 100}%`,
                        insetBlockStart: `${(bounds.y / frame.height) * 100}%`,
                        inlineSize: `${(bounds.width / frame.width) * 100}%`,
                        blockSize: `${(bounds.height / frame.height) * 100}%`,
                      }}
                    />
                  ))}
                {selecting
                  ? [selection?.element, hover].map((element, index) =>
                      element ? (
                        <span
                          key={index}
                          className="host-browser-highlight"
                          data-selected={index === 0}
                          style={{
                            insetInlineStart: `${(element.bounds.x / frame.width) * 100}%`,
                            insetBlockStart: `${(element.bounds.y / frame.height) * 100}%`,
                            inlineSize: `${(element.bounds.width / frame.width) * 100}%`,
                            blockSize: `${(element.bounds.height / frame.height) * 100}%`,
                          }}
                        >
                          {index === 1 ? (
                            <Text
                              as="span"
                              size="micro"
                              tone="primary"
                              leading="snug"
                              truncate
                              className="host-browser-highlight-label"
                              data-align={element.bounds.x > frame.width / 2 ? "end" : "start"}
                            >
                              {element.tag}
                              {element.text ? ` · ${element.text}` : ""} ·{" "}
                              {Math.round(element.bounds.width)} ×{" "}
                              {Math.round(element.bounds.height)}
                              {element.layout?.display === "flex" ||
                              element.layout?.display === "grid"
                                ? ` · ${element.layout.display}`
                                : ""}
                            </Text>
                          ) : null}
                        </span>
                      ) : null,
                    )
                  : null}
              </div>
            </div>
          ) : (
            <BrowserStartPage
              disabled={busy || selecting || setupRequired}
              onOpen={(target) => {
                setUrl(target);
                void action(() => openWebsite(target));
              }}
              description={
                state?.open
                  ? t("Refresh the frame to view this page.")
                  : setupRequired
                    ? t("Set up the browser above to start previewing websites.")
                    : t("Open a website above to see its preview here.")
              }
            />
          )}
        </div>
      </div>
      {(selection || captures.length > 0) && selectionOpen ? (
        <Popover
          anchor={selectionTrigger}
          side="top"
          align="end"
          width={360}
          role="dialog"
          aria-label={t("Selected browser element")}
          data-dialog-popover
          autoFocus
          solid
          className="host-browser-selection-popover bycoda-arc"
          onDismiss={() => setSelectionOpen(false)}
        >
          <section
            className="host-browser-side-section host-browser-selection"
            aria-label={t("Selected browser element")}
          >
            {selection ? (
              <>
                <OverflowTooltip
                  label={`${selection.element.tag}${selection.element.text ? ` · ${selection.element.text}` : ""}`}
                >
                  <Text as="p" leading="inherit" className="host-browser-target">
                    {selection.element.tag}
                    {selection.element.text ? ` · ${selection.element.text}` : ""}
                    {` · ${Math.round(selection.element.bounds.width)} × ${Math.round(selection.element.bounds.height)}`}
                    {selection.element.role ? ` · ${selection.element.role}` : ""}
                  </Text>
                </OverflowTooltip>
                <TextareaField
                  label={t("Explain the selected element")}
                  value={comment}
                  maxLength={4000}
                  onChange={(event) => setComment(event.target.value)}
                  disabled={busy}
                />
              </>
            ) : null}
            {captures.map((capture, index) => (
              <div key={capture.id} className="host-tool-actions">
                <TextareaField
                  label={`${t("Selection")} ${index + 1}`}
                  value={capture.comment}
                  maxLength={4000}
                  onChange={(event) =>
                    setCaptures((items) =>
                      items.map((item) =>
                        item.id === capture.id ? { ...item, comment: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      async () => {
                        if (mode.current)
                          await request("browser.annotation.clear", { captureId: capture.id });
                        setCaptures((items) => items.filter((item) => item.id !== capture.id));
                      },
                      { current: true },
                    ).catch(() => {})
                  }
                >
                  {t("Remove selection")}
                </Button>
              </div>
            ))}
            {selection ? (
              <BrowserInspectorNavigation
                element={selection.element}
                disabled={!canInput}
                onTraverse={(direction, ancestorIndex) =>
                  void action(() =>
                    request("browser.annotation.traverse", {
                      nodeId: selection.element.nodeId,
                      direction,
                      ...(ancestorIndex === undefined ? {} : { ancestorIndex }),
                      replaceCaptureId: selection.id,
                    }),
                  ).catch(() => {})
                }
              />
            ) : null}
            <div className="host-tool-actions">
              {selection && captures.length < 8 ? (
                <Button
                  disabled={!canInput}
                  onClick={() => {
                    setCaptures((items) => [
                      ...items.filter((item) => item.id !== selection.id),
                      { id: selection.id, comment },
                    ]);
                    setSelection(undefined);
                    setComment("");
                    setSelectionOpen(false);
                  }}
                >
                  {t("Keep selection and select another")}
                </Button>
              ) : null}
              <Button
                motion="none"
                type="button"
                variant="primary"
                disabled={!canInput || uncertainDelivery}
                onClick={() => {
                  const deliveryFailed = { current: false };
                  if (selection) {
                    setCaptures((items) => [
                      ...items.filter((item) => item.id !== selection.id),
                      { id: selection.id, comment },
                    ]);
                    setSelection(undefined);
                  }
                  void action(async () => {
                    if (!composerSessionId || !sessionId) return;
                    const items = [
                      ...captures,
                      ...(selection ? [{ id: selection.id, comment }] : []),
                    ];
                    for (const item of items) {
                      const result = await request("browser.annotation.read", {
                        captureId: item.id,
                      });
                      if (!result?.selection || result.selection.id !== item.id)
                        throw new Error(
                          t("Selection expired. Refresh the frame and select the element again."),
                        );
                      try {
                        await attachBrowserSelectionAcrossWindows(
                          cwd,
                          composerSessionId,
                          sessionId,
                          result.selection,
                          item.comment,
                          composerWindow,
                        );
                      } catch (cause) {
                        deliveryFailed.current = true;
                        if (cause instanceof BrowserDraftDeliveryUncertainError)
                          setUncertainDelivery(true);
                        throw cause;
                      }
                      setCaptures((current) => current.filter((capture) => capture.id !== item.id));
                      if (selection?.id === item.id) {
                        setSelection(undefined);
                        setComment("");
                      }
                    }
                    cancelSelection();
                    setNotice(t("Added to composer. Review the attachment and send when ready."));
                  }, deliveryFailed);
                }}
              >
                {error ? t("Retry adding selection") : t("Add selection to composer")}
              </Button>
              {selection ? (
                <Button
                  motion="none"
                  type="button"
                  variant="ghost"
                  disabled={!canInput}
                  onClick={() =>
                    void action(async () => {
                      await request("browser.annotation.clear", { captureId: selection.id });
                      setSelection(undefined);
                      setSelectionOpen(false);
                      setHover(undefined);
                      setComment("");
                    })
                  }
                >
                  {t("Remove selection")}
                </Button>
              ) : null}
            </div>
            {error ? (
              <Text as="div" size="caption" tone="inherit" leading="inherit">
                <DetailedInlineError className="host-browser-target" error={error} />
              </Text>
            ) : null}
            {uncertainDelivery ? (
              <Button variant="ghost" onClick={() => setUncertainDelivery(false)}>
                {t("I checked the target composer")}
              </Button>
            ) : null}
            {selection ? (
              <Disclosure summary={t("Details")} size="sm">
                <BrowserAnnotationDetails annotation={selection} />
              </Disclosure>
            ) : null}
          </section>
        </Popover>
      ) : null}
      {controlsOpen ? (
        <BrowserControlsPopover
          anchor={controlsFromStatus ? statusTrigger : controlsTrigger}
          align={controlsFromStatus ? "start" : "end"}
          onDismiss={(reason) => {
            setControlsOpen(false);
            if (reason === "escape")
              (controlsFromStatus ? statusTrigger : controlsTrigger).current?.focus();
          }}
          state={state}
          busy={busy}
          selecting={selecting}
          canInput={canInput}
          canPageInput={canPageInput}
          setupRequired={setupRequired}
          annotationsAllowed={annotationsAllowed}
          text={text}
          setText={setText}
          browserStatus={browserStatus}
          notice={notice}
          error={error}
          errorSummary={errorSummary}
          action={action}
          request={request}
          input={input}
        />
      ) : null}
    </section>
  );
}
