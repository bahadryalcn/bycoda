import { NumberField } from "../../shared/ui/NumberField";
import { TextField } from "../../shared/ui/TextField";
import { TextareaField } from "../../shared/ui/TextareaField";
import { t, useLocale } from "../../shared/i18n/technical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { Button } from "../../shared/ui/Button";
import { InfoPopover } from "../../shared/ui/InfoPopover";
import { Progress } from "../../shared/ui/Progress";
import { Popover } from "../../shared/ui/Popover";
import {
  ImageAnnotationCanvas,
  rasterizeImageAnnotations,
  type ImageAnnotationDocument,
} from "../../shared/ui/ImageAnnotationCanvas";
import {
  AppWindow,
  ArrowUp,
  Check,
  CursorMagicSelection,
  Home,
  ImagePlus,
  Keyboard,
  MessageSquarePlus,
  MoreHorizontal,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  Minus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
  X,
} from "../../shared/ui/icons";
import "./DevicePanel.css";
import type {
  DeviceAction,
  DeviceFrame,
  DeviceHostStatus,
  DevicePanelApi,
  DeviceSummary,
} from "./types";

type DeviceOperation =
  | "status"
  | "connect"
  | "refresh"
  | "capture"
  | "add"
  | "addImage"
  | "boot"
  | "setup"
  | "setupControl"
  | "start"
  | "stop"
  | DeviceAction["type"];

type AnnotationDraft = {
  frame: DeviceFrame;
  document: ImageAnnotationDocument;
  undo: ImageAnnotationDocument[];
  redo: ImageAnnotationDocument[];
  comment: string;
};
// Layout/tool switches unmount the surface. Keep unfinished image edits in the
// source conversation and machine scope, without retaining a device permission.
const annotationDraftCache = new Map<string, Record<string, AnnotationDraft>>();
const unavailableTransport = (cause: unknown) =>
  /RPC_HOST_UNAVAILABLE|host unavailable|host connection.*(?:closed|refused)/i.test(String(cause));

/** RPC only: opening this panel starts viewing; control remains opt-in. */
export function DevicePanel({
  api,
  hostLabel,
  onAddDevice,
  onAddImage,
  draftScope,
}: {
  api: DevicePanelApi;
  hostLabel?: string;
  onAddDevice?: (device: DeviceSummary) => Promise<void>;
  onAddImage?: (device: DeviceSummary, frame: DeviceFrame, comment: string) => Promise<void>;
  draftScope?: string;
}) {
  useLocale();
  const [status, setStatus] = useState<DeviceHostStatus>();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [frame, setFrame] = useState<DeviceFrame>();
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<DeviceOperation>();
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string>();
  const [errorOperation, setErrorOperationState] = useState<DeviceOperation>("status");
  const errorOperationRef = useRef<DeviceOperation>("status");
  const setErrorOperation = useCallback((name: DeviceOperation) => {
    errorOperationRef.current = name;
    setErrorOperationState(name);
  }, []);
  const [control, setControl] = useState(false);
  const [app, setApp] = useState("");
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");
  const [deviceNotice, setDeviceNotice] = useState<{
    text: string;
    error: boolean;
  }>();
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [surface, setSurface] = useState<
    "menu" | "app" | "text" | "coordinates" | "note" | "setup" | "output"
  >();
  const [surfaceAnchor, setSurfaceAnchor] = useState<HTMLElement | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [annotationTool, setAnnotationTool] = useState<"box" | "arrow" | "pen" | "pin">("box");
  const [zoom, setZoom] = useState(1);
  const [annotations, setAnnotationState] = useState<Record<string, AnnotationDraft>>(() =>
    draftScope ? (annotationDraftCache.get(draftScope) ?? {}) : {},
  );
  const setAnnotations = (
    change:
      | Record<string, AnnotationDraft>
      | ((value: Record<string, AnnotationDraft>) => Record<string, AnnotationDraft>),
  ) => {
    setAnnotationState((current) => {
      const next = typeof change === "function" ? change(current) : change;
      if (draftScope) {
        annotationDraftCache.delete(draftScope);
        if (Object.keys(next).length) annotationDraftCache.set(draftScope, next);
      }
      return next;
    });
  };
  const gesture = useRef<{
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);
  const scope = useMemo(() => ({}), [api]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const pending = useRef<object | null>(null);
  const capturePending = useRef<Promise<DeviceFrame> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    pending.current = null;
    capturePending.current = null;
    setBusy(false);
    setOperation(undefined);
    setLoadingDevices(false);
    setError(undefined);
    setErrorOperation("status");
    setStatus(undefined);
    setDevices([]);
    setSelected("");
    setFrame(undefined);
    setLive(false);
    setControl(false);
    setApp("");
    setText("");
    setOutput("");
    setDeviceNotice(undefined);
    setX(0);
    setY(0);
    setSurface(undefined);
    setAnnotating(false);
    setAnnotationState(draftScope ? (annotationDraftCache.get(draftScope) ?? {}) : {});
    setConnectionUnavailable(false);
    setZoom(1);
    setBusy(true);
    void (async () => {
      try {
        let value = await api.status();
        if (!active) return;
        // Reuse an installed runtime. SDK/tool downloads remain an explicit action.
        if (!value.running && value.installed && value.platforms.some((item) => item.available))
          value = await api.start();
        if (active) setStatus(value);
      } catch (cause) {
        if (active) setError(String(cause));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);
  const execute = useCallback(
    async <T,>(
      name: DeviceOperation,
      work: (isCurrent: () => boolean) => Promise<T>,
      commit: (value: T) => void,
    ) => {
      if (pending.current) return;
      const token = {};
      const requestScope = scope;
      pending.current = token;
      const current = () => mounted.current && currentScope.current === requestScope;
      setBusy(true);
      setOperation(name);
      setError(undefined);
      setErrorOperation(name);
      try {
        // A live capture must finish before boot/stop/input or another capture.
        await capturePending.current?.catch(() => {});
        if (!current()) return;
        const value = await work(current);
        if (current()) commit(value);
      } catch (cause) {
        if (current()) {
          setError(String(cause));
          if (unavailableTransport(cause)) setConnectionUnavailable(true);
        }
      } finally {
        if (current() && pending.current === token) {
          pending.current = null;
          setBusy(false);
          setOperation(undefined);
        }
      }
    },
    [scope],
  );
  const capture = useCallback(
    (deviceId: string) => {
      const requestScope = scope;
      const operation = api.capture(deviceId).then(
        (value) => {
          if (mounted.current && currentScope.current === requestScope)
            setConnectionUnavailable(false);
          return value;
        },
        (cause: unknown) => {
          if (
            mounted.current &&
            currentScope.current === requestScope &&
            unavailableTransport(cause)
          )
            setConnectionUnavailable(true);
          throw cause;
        },
      );
      capturePending.current = operation;
      void operation
        .finally(() => {
          if (capturePending.current === operation) capturePending.current = null;
        })
        .catch(() => {});
      return operation;
    },
    [api, scope],
  );
  const selectDevice = useCallback(
    (deviceId: string, booted = false, preserveDiscoveryError = false) => {
      setSelected(deviceId);
      setApp("");
      setFrame(undefined);
      setLive(booted);
      setControl(false);
      setText("");
      setOutput("");
      setDeviceNotice(undefined);
      setConnectionUnavailable(false);
      setAnnotating(false);
      setSurface(undefined);
      setZoom(1);
      // Host/discovery failures remain relevant across selections. Device action
      // and capture failures belong only to the device that produced them.
      if (
        !preserveDiscoveryError &&
        errorOperationRef.current !== "status" &&
        errorOperationRef.current !== "refresh"
      )
        setError(undefined);
    },
    [],
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const applyDevices = useCallback(
    (value: Awaited<ReturnType<DevicePanelApi["list"]>>) => {
      setDevices(value.devices);
      setErrorOperation("refresh");
      setError(value.errors.length ? value.errors.join("\n") : undefined);
      const current = value.devices.find((device) => device.id === selectedRef.current);
      if (!current) {
        // Prefer a connected phone. Opening the panel starts viewing, never input or boot.
        const preferred =
          value.devices.find((device) => device.booted && device.physical) ??
          value.devices.find((device) => device.booted) ??
          value.devices[0];
        selectDevice(preferred?.id ?? "", !!preferred?.booted, true);
      } else if (!current.booted) {
        setApp("");
        setFrame(undefined);
        setLive(false);
        setOutput("");
      }
    },
    [selectDevice],
  );
  useEffect(() => {
    if (!status?.running) {
      setLoadingDevices(false);
      setLive(false);
      setSelected("");
      setApp("");
      setFrame(undefined);
      setDevices([]);
      return;
    }
    let active = true;
    setLoadingDevices(true);
    void api
      .list()
      .then(
        (value) => {
          if (!active) return;
          applyDevices(value);
        },
        (cause: unknown) => {
          if (active) setError(String(cause));
        },
      )
      .finally(() => {
        if (active) setLoadingDevices(false);
      });
    return () => {
      active = false;
    };
  }, [api, status?.running, applyDevices]);
  useEffect(() => {
    if (!live || !selected || !status?.running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) return;
      if (!document.hidden && !pending.current && !capturePending.current) {
        try {
          const value = await capture(selected);
          if (!cancelled) {
            setFrame(value);
            if (errorOperationRef.current === "capture") setError(undefined);
          }
        } catch (cause) {
          if (!cancelled) {
            setErrorOperation("capture");
            setError(String(cause));
            setLive(false);
          }
          return;
        }
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [live, selected, capture, status?.running]);
  const action = (command: DeviceAction) =>
    void execute(
      command.type,
      async (isCurrent) => {
        const output = await api.action(selected, command);
        if (!isCurrent()) return { output, frame: undefined, error: undefined };
        try {
          return { output, frame: await capture(selected), error: undefined };
        } catch (cause) {
          return {
            output,
            frame: undefined,
            error: `${t("Action completed. Refresh the frame to see the result.")} ${String(cause)}`,
          };
        }
      },
      (value) => {
        setOutput(value.output);
        if (command.type === "openApp") setApp(command.app);
        else if (command.type === "home" && device?.platform === "ios")
          setApp("com.apple.springboard");
        setFrame(value.frame);
        if (value.error) {
          setErrorOperation("capture");
          setError(value.error);
        }
      },
    );
  const device = devices.find((item) => item.id === selected);
  const canViewDevice = !!device?.booted && !loadingDevices;
  const canControlDevice =
    canViewDevice && control && !!status?.agentInstalled && !connectionUnavailable;
  const canView = canViewDevice && !busy;
  const canControl = canControlDevice && !busy;
  const unavailable = (name: DeviceOperation, enabled = true) =>
    !enabled || (busy && operation !== name);
  const windowsAndroid = status?.platform === "win32" && device?.platform === "android";
  const coordinatesValid =
    Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= 20000 && y <= 20000;
  const platformLabel = (platform: DeviceSummary["platform"]) =>
    platform === "ios" ? t("iOS") : t("Android");
  const kindLabel = (item: DeviceSummary) =>
    item.physical ? t("Physical device") : item.platform === "ios" ? t("Simulator") : t("Emulator");
  const sdkAvailable = !!status?.platforms.some((item) => item.available);
  const refreshDevices = () => void execute("refresh", api.list, applyDevices);
  const discoveryError = errorOperation === "status" || errorOperation === "refresh";
  const draft = annotations[selected];
  const updateDraft = (change: (value: AnnotationDraft) => AnnotationDraft) =>
    setAnnotations((values) =>
      values[selected] ? { ...values, [selected]: change(values[selected]) } : values,
    );
  const changeDocument = (document: ImageAnnotationDocument) =>
    updateDraft((value) => ({
      ...value,
      undo: [...value.undo.slice(-49), value.document],
      document,
      redo: [],
    }));
  const beginAnnotation = () => {
    if (!frame || busy) return;
    setLive(false);
    setAnnotations((values) =>
      values[selected]
        ? values
        : {
            ...values,
            [selected]: { frame, document: { marks: [] }, undo: [], redo: [], comment: "" },
          },
    );
    setAnnotating(true);
    setSurface(undefined);
  };
  const openSurface = (name: NonNullable<typeof surface>, anchor: HTMLElement) => {
    setSurfaceAnchor(anchor);
    setSurface((current) => (current === name ? undefined : name));
  };
  const imageSource = (value: DeviceFrame) => `data:${value.mime};base64,${value.base64}`;
  const addImage = () => {
    if (!device || !onAddImage || !draft) return;
    const currentDevice = device;
    const currentDraft = draft;
    void execute(
      "addImage",
      async (isCurrent) => {
        const image = await rasterizeImageAnnotations(
          imageSource(currentDraft.frame),
          currentDraft.document,
        );
        if (!isCurrent()) return;
        await onAddImage(
          currentDevice,
          { mime: image.mime, base64: image.base64, capturedAt: currentDraft.frame.capturedAt },
          currentDraft.comment,
        );
      },
      () => {
        setSurface(undefined);
        setDeviceNotice({ text: t("Image added to draft."), error: false });
      },
    );
  };
  const controlEnabled = canControl && !annotating;
  const captureFailed = !!error && errorOperation === "capture";
  return (
    <section
      className="host-tool-panel device-panel bycoda-arc"
      aria-label={t("Devices")}
      aria-busy={busy || loadingDevices}
    >
      {error && (
        <details className="device-panel-error" role="alert">
          <summary>
            {discoveryError
              ? t("Could not load devices")
              : captureFailed
                ? t("Device screen unavailable")
                : t("Device action failed")}
          </summary>
          <pre>{error}</pre>
        </details>
      )}
      {!status && !error && (
        <p role="status" className="device-panel-state">
          {t("Checking device support…")}
        </p>
      )}
      {!status && (error || operation === "status") && (
        <Button
          loading={operation === "status"}
          disabled={unavailable("status")}
          onClick={() => void execute("status", api.status, setStatus)}
        >
          {t("Retry")}
        </Button>
      )}
      {status && !status.running && (
        <div className="device-panel-state device-panel-connect">
          <p className="device-panel-state-title">{t("Connect a device")}</p>
          <p className="host-tool-muted">
            {t(
              "Connect an Android phone with USB debugging, or use an emulator. iOS simulators require a Mac with Xcode.",
            )}
          </p>
          <Button
            variant="primary"
            loading={operation === "connect"}
            disabled={unavailable("connect", sdkAvailable)}
            onClick={() =>
              void execute(
                "connect",
                async (isCurrent) => {
                  if (!status.installed) await api.setup(false);
                  return isCurrent() ? api.start() : status;
                },
                setStatus,
              )
            }
          >
            {status.installed ? t("Connect devices") : t("Set up and connect")}
          </Button>
          <Button variant="ghost" aria-haspopup="dialog" aria-expanded={surface === "setup"} onClick={(event) => openSurface("setup", event.currentTarget)}>{t("Setup and access")}</Button>
        </div>
      )}
      {status?.running && (
        <>
          <div className="device-panel-bar">
            {devices.length ? (
              <div
                className="device-panel-choice"
                title={
                  device
                    ? `${hostLabel ?? ""} · ${kindLabel(device)} · ${platformLabel(device.platform)} ${device.version} · ${device.id}`
                    : undefined
                }
              >
                <SearchableSelect
                  label={t("Selected device")}
                  value={selected}
                  disabled={busy || loadingDevices}
                  placeholder={t("Select a device")}
                  searchPlaceholder={t("Search devices by name or ID")}
                  emptyLabel={t("No matching devices")}
                  onChange={(id) => {
                    if (id !== selected)
                      selectDevice(id, !!devices.find((item) => item.id === id)?.booted);
                  }}
                  options={devices.map((item) => ({
                    value: item.id,
                    label: item.name,
                    description: `${platformLabel(item.platform)} ${item.version} · ${item.booted ? t("Running") : t("Stopped")} · ${kindLabel(item)}`,
                    keywords: `${item.id} ${kindLabel(item)} ${item.version}`,
                  }))}
                />
              </div>
            ) : (
              <p className="host-tool-muted device-panel-bar-text" role="status">
                {loadingDevices
                  ? t("Loading devices…")
                  : t(
                      "No devices found. Connect an Android phone with USB debugging enabled, or create an emulator or simulator, then refresh.",
                    )}
              </p>
            )}
            {device && !device.booted && (
              <Button
                variant="primary"
                loading={operation === "boot"}
                hidden={device.physical}
                disabled={unavailable("boot", !loadingDevices && !device.physical)}
                onClick={() =>
                  void execute(
                    "boot",
                    () => api.boot(selected),
                    (value) => {
                      setSelected(value.id);
                      setLive(value.booted);
                      setDevices((items) =>
                        items.map((item) => (item.id === selected ? value : item)),
                      );
                    },
                  )
                }
              >
                {t("Boot")}
              </Button>
            )}
            <Button
              variant="ghost"
              iconOnly
              label={t("Refresh devices")}
              tooltip={t("Refresh devices")}
              loading={operation === "refresh" || loadingDevices}
              disabled={unavailable("refresh", !loadingDevices)}
              onClick={refreshDevices}
            >
              <RefreshCw className="icon-md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={t("Device options")}
              tooltip={t("Device options")}
              aria-haspopup="dialog"
              aria-expanded={surface === "menu"}
              onClick={(event) => openSurface("menu", event.currentTarget)}
            >
              <MoreHorizontal className="icon-md" aria-hidden />
            </Button>
          </div>
          <div className="device-panel-stage">
            <div className="device-panel-viewport">
              <div
                className="device-panel-canvas"
                style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
              >
                {annotating && draft ? (
                  <ImageAnnotationCanvas
                    src={imageSource(draft.frame)}
                    alt={t("Current device screen")}
                    document={draft.document}
                    onChange={changeDocument}
                    tool={annotationTool}
                    disabled={busy}
                    className="device-panel-annotation"
                  />
                ) : frame ? (
                  <img
                    alt={t("Current device screen")}
                    className={
                      controlEnabled && device?.platform === "android"
                        ? "host-frame-interactive"
                        : undefined
                    }
                    src={imageSource(frame)}
                    draggable={false}
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      if (image.naturalHeight)
                        image.style.setProperty(
                          "--device-aspect",
                          String(image.naturalWidth / image.naturalHeight),
                        );
                    }}
                    onPointerDown={(event) => {
                      if (
                        !controlEnabled ||
                        device?.platform !== "android" ||
                        event.button !== 0 ||
                        captureFailed
                      )
                        return;
                      const image = event.currentTarget,
                        bounds = image.getBoundingClientRect();
                      if (
                        !bounds.width ||
                        !bounds.height ||
                        !image.naturalWidth ||
                        !image.naturalHeight
                      )
                        return;
                      image.setPointerCapture(event.pointerId);
                      gesture.current = {
                        x: Math.round(
                          ((event.clientX - bounds.left) * image.naturalWidth) / bounds.width,
                        ),
                        y: Math.round(
                          ((event.clientY - bounds.top) * image.naturalHeight) / bounds.height,
                        ),
                        clientX: event.clientX,
                        clientY: event.clientY,
                        pointerId: event.pointerId,
                      };
                    }}
                    onPointerUp={(event) => {
                      const start = gesture.current;
                      gesture.current = null;
                      if (
                        !start ||
                        start.pointerId !== event.pointerId ||
                        !controlEnabled ||
                        captureFailed
                      )
                        return;
                      const image = event.currentTarget,
                        bounds = image.getBoundingClientRect();
                      const x = Math.max(
                        0,
                        Math.min(
                          image.naturalWidth - 1,
                          Math.round(
                            ((event.clientX - bounds.left) * image.naturalWidth) / bounds.width,
                          ),
                        ),
                      );
                      const y = Math.max(
                        0,
                        Math.min(
                          image.naturalHeight - 1,
                          Math.round(
                            ((event.clientY - bounds.top) * image.naturalHeight) / bounds.height,
                          ),
                        ),
                      );
                      if (
                        Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 6
                      )
                        action({ type: "press", x: start.x, y: start.y });
                      else action({ type: "swipe", x: start.x, y: start.y, endX: x, endY: y });
                    }}
                    onPointerCancel={() => {
                      gesture.current = null;
                    }}
                  />
                ) : (
                  <div className="device-panel-waiting" role="status">
                    {loadingDevices
                      ? t("Loading devices…")
                      : device && !device.booted
                        ? t("Boot the selected device before viewing or controlling it.")
                        : device?.booted && !error
                          ? live
                            ? t("Loading device screen…")
                            : t("Resume live view to follow the device screen.")
                          : devices.length && !selected
                            ? t("Select a device to view its screen.")
                            : null}
                  </div>
                )}
              </div>
            </div>
            {frame && (!live || annotating) && (
              <span
                className="device-panel-frame-state"
                title={(annotating ? draft?.frame : frame)?.capturedAt}
              >
                {annotating
                  ? t("Marking · Frozen frame")
                  : captureFailed || connectionUnavailable
                    ? t("Last frame · Not live")
                    : t("Paused")}
              </span>
            )}
            {annotating && draft && (
              <div
                className="device-panel-mark-tools"
                role="toolbar"
                aria-label={t("Image annotation tools")}
              >
                {(
                  [
                    { value: "box", label: "Draw rectangle", icon: Square },
                    { value: "arrow", label: "Draw arrow", icon: ArrowUp },
                    { value: "pen", label: "Draw freehand", icon: Pencil },
                    { value: "pin", label: "Add numbered pin", icon: Pin },
                  ] as const
                ).map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant="ghost"
                    iconOnly
                    label={t(label)}
                    tooltip={t(label)}
                    selected={annotationTool === value}
                    aria-pressed={annotationTool === value}
                    disabled={busy}
                    onClick={() => setAnnotationTool(value)}
                  >
                    <Icon className="icon-md" aria-hidden />
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Undo annotation")}
                  tooltip={t("Undo annotation")}
                  disabled={busy || !draft.undo.length}
                  onClick={() =>
                    updateDraft((value) => ({
                      ...value,
                      document: value.undo[value.undo.length - 1],
                      undo: value.undo.slice(0, -1),
                      redo: [...value.redo, value.document],
                    }))
                  }
                >
                  <Undo2 className="icon-md" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Redo annotation")}
                  tooltip={t("Redo annotation")}
                  disabled={busy || !draft.redo.length}
                  onClick={() =>
                    updateDraft((value) => ({
                      ...value,
                      document: value.redo[value.redo.length - 1],
                      redo: value.redo.slice(0, -1),
                      undo: [...value.undo, value.document],
                    }))
                  }
                >
                  <RotateCcw className="icon-md device-panel-redo" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Annotation note")}
                  tooltip={t("Annotation note")}
                  disabled={busy}
                  aria-haspopup="dialog"
                  aria-expanded={surface === "note"}
                  onClick={(event) => openSurface("note", event.currentTarget)}
                >
                  <MessageSquarePlus className="icon-md" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Finish marking")}
                  tooltip={t("Finish marking")}
                  disabled={busy}
                  onClick={() => setAnnotating(false)}
                >
                  <Check className="icon-md" aria-hidden />
                </Button>
              </div>
            )}
          </div>
          <div className="device-panel-toolbar" role="toolbar" aria-label={t("Device actions")}>
            <Button
              variant="ghost"
              iconOnly
              label={t("Allow device control")}
              tooltip={t("Allow device control")}
              role="switch"
              aria-checked={control}
              selected={control && !annotating}
              disabled={busy || !device?.booted}
              onClick={() => {
                setControl(annotating ? true : !control);
                setAnnotating(false);
              }}
            >
              <CursorMagicSelection className="icon-md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={t("Mark device screen")}
              tooltip={t("Mark device screen")}
              selected={annotating}
              aria-pressed={annotating}
              disabled={!frame || busy}
              onClick={beginAnnotation}
            >
              <Pencil className="icon-md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={t("Home")}
              tooltip={t("Home")}
              loading={operation === "home"}
              disabled={unavailable("home", canControlDevice && !annotating)}
              onClick={() => action({ type: "home" })}
            >
              <Home className="icon-md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={t("Device text input")}
              tooltip={t("Device text input")}
              disabled={!controlEnabled}
              aria-haspopup="dialog"
              aria-expanded={surface === "text"}
              onClick={(event) => openSurface("text", event.currentTarget)}
            >
              <Keyboard className="icon-md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={t("Choose app to open")}
              tooltip={t("Choose app to open")}
              disabled={!controlEnabled}
              aria-haspopup="dialog"
              aria-expanded={surface === "app"}
              onClick={(event) => openSurface("app", event.currentTarget)}
            >
              <AppWindow className="icon-md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              iconOnly
              label={t("Capture")}
              tooltip={t("Capture")}
              loading={operation === "capture"}
              disabled={unavailable("capture", canViewDevice && !annotating)}
              onClick={() => void execute("capture", () => capture(selected), setFrame)}
            >
              <ImagePlus className="icon-md" aria-hidden />
            </Button>
            <span className="device-panel-toolbar-spacer" />
            {annotating && draft && onAddImage ? (
              <Button
                variant="ghost"
                iconOnly
                label={t("Add marked image to draft")}
                tooltip={t("Add marked image to draft")}
                loading={operation === "addImage"}
                disabled={unavailable("addImage")}
                onClick={addImage}
              >
                <MessageSquarePlus className="icon-md" aria-hidden />
              </Button>
            ) : (
              <Button
                variant="ghost"
                iconOnly
                label={t("Live view")}
                tooltip={t("Live view")}
                role="switch"
                aria-checked={live}
                disabled={!canView}
                onClick={() => {
                  setAnnotating(false);
                  setLive(!live);
                }}
              >
                {live ? (
                  <Pause className="icon-md" aria-hidden />
                ) : (
                  <Play className="icon-md" aria-hidden />
                )}
              </Button>
            )}
          </div>
          {control && !status.agentInstalled && (
            <div className="device-panel-setup-control">
              <span>{t("Run setup with control enabled to install the control tools.")}</span>
              <Button
                variant="primary"
                loading={operation === "setupControl"}
                disabled={unavailable("setupControl", sdkAvailable)}
                onClick={() => void execute("setupControl", () => api.setup(true), setStatus)}
              >
                {t("Set up device control")}
              </Button>
            </div>
          )}
          {operation === "press" || operation === "swipe" ? (
            <Progress compact tone="neutral" aria-label={t("Working on the host…")} />
          ) : null}
          {deviceNotice && (
            <p className="device-panel-notice" role={deviceNotice.error ? "alert" : "status"}>
              {deviceNotice.text}
              <Button
                variant="ghost"
                iconOnly
                label={t("Dismiss")}
                onClick={() => setDeviceNotice(undefined)}
              >
                <X className="icon-sm" aria-hidden />
              </Button>
            </p>
          )}
        </>
      )}
      {surface && (
        <Popover
          anchor={surfaceAnchor}
          side="top"
          align="end"
          width={360}
          solid
          autoFocus
          onDismiss={() => setSurface(undefined)}
          className="device-panel-popover bycoda-arc"
          role="dialog"
          aria-label={t(
            {
              menu: "Device options",
              app: "Open app",
              text: "Text to type on device",
              coordinates: "Coordinate controls",
              note: "Annotation note",
              setup: "Setup and access",
              output: "Device action result",
            }[surface],
          )}
        >
          {surface === "menu" && (
            <>
              <div className="device-panel-menu-actions">
                <Button
                  variant="item"
                  disabled={unavailable("snapshot", canControlDevice && !annotating)}
                  loading={operation === "snapshot"}
                  onClick={() => action({ type: "snapshot" })}
                >
                  {t("Accessibility snapshot")}
                </Button>
                <Button
                  variant="item"
                  disabled={!canControlDevice || annotating}
                  onClick={() => setSurface("coordinates")}
                >
                  {t("Coordinate controls")}
                </Button>
                {onAddDevice && (
                  <Button
                    variant="item"
                    loading={operation === "add"}
                    disabled={unavailable("add", !loadingDevices && !!device)}
                    onClick={() => {
                      if (!device) return;
                      setDeviceNotice(undefined);
                      void execute(
                        "add",
                        () => onAddDevice(device),
                        () => setDeviceNotice({ text: t("Device added to draft."), error: false }),
                      );
                    }}
                  >
                    {t("Add device to conversation")}
                  </Button>
                )}
                {output && (
                  <Button variant="item" onClick={() => setSurface("output")}>
                    {t("Device action result")}
                  </Button>
                )}
                <Button variant="item" onClick={() => setSurface("setup")}>
                  {t("Setup and access")}
                </Button>
              </div>
              <div className="device-panel-zoom">
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Zoom out")}
                  disabled={zoom <= 1}
                  onClick={() => setZoom((v) => Math.max(1, v - 0.25))}
                >
                  <Minus className="icon-md" aria-hidden />
                </Button>
                <Button variant="ghost" onClick={() => setZoom(1)}>
                  {t("Fit to panel")}
                </Button>
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Zoom in")}
                  disabled={zoom >= 3}
                  onClick={() => setZoom((v) => Math.min(3, v + 0.25))}
                >
                  <Plus className="icon-md" aria-hidden />
                </Button>
              </div>
              {device && (
                <p className="host-tool-muted">
                  {hostLabel ? `${hostLabel} · ` : ""}
                  {platformLabel(device.platform)} {device.version} · {kindLabel(device)}
                </p>
              )}
              {(device?.platform === "ios" || windowsAndroid) && (
                <InfoPopover>
                  <p>
                    {device?.platform === "ios"
                      ? t(
                          "iOS: open the target app before interacting with it, or use logical point coordinates from the accessibility snapshot.",
                        )
                      : t(
                          "For Android, enter Settings or an app package ID. Android text input supports printable ASCII characters.",
                        )}
                  </p>
                </InfoPopover>
              )}
            </>
          )}
          {surface === "app" && (
            <div className="device-panel-command">
              <TextField
                label={t("App name or bundle ID")}
                disabled={!controlEnabled}
                value={app}
                maxLength={256}
                onChange={(event) => setApp(event.target.value)}
              />
              <Button
                disabled={unavailable("openApp", canControlDevice && !annotating && !!app.trim())}
                loading={operation === "openApp"}
                onClick={() => action({ type: "openApp", app: app.trim() })}
              >
                {t("Open app")}
              </Button>
            </div>
          )}
          {surface === "text" && (
            <div className="device-panel-command">
              <TextareaField
                label={t("Text to type on device")}
                disabled={!controlEnabled}
                value={text}
                maxLength={4096}
                onChange={(event) => setText(event.target.value)}
              />
              <Button
                disabled={unavailable("type", canControlDevice && !annotating && !!text)}
                loading={operation === "type"}
                onClick={() => action({ type: "type", text })}
              >
                {t("Type text")}
              </Button>
            </div>
          )}
          {surface === "coordinates" && (
            <div className="device-panel-command">
              <NumberField
                label={t("Device X coordinate")}
                disabled={!controlEnabled}
                min={0}
                max={20000}
                value={x}
                onChange={(event) => setX(Number(event.target.value))}
              />
              <NumberField
                label={t("Device Y coordinate")}
                disabled={!controlEnabled}
                min={0}
                max={20000}
                value={y}
                onChange={(event) => setY(Number(event.target.value))}
              />
              <Button
                disabled={unavailable("press", canControlDevice && !annotating && coordinatesValid)}
                loading={operation === "press"}
                onClick={() => action({ type: "press", x, y })}
              >
                {t("Press coordinate")}
              </Button>
              <p>
                {t(
                  "Android: click the screen to press at that pixel. iOS: use logical point coordinates from the accessibility snapshot.",
                )}
              </p>
            </div>
          )}
          {surface === "note" && draft && (
            <div className="device-panel-command">
              <TextareaField
                label={t("Annotation note")}
                value={draft.comment}
                maxLength={4000}
                disabled={busy}
                onChange={(event) =>
                  updateDraft((value) => ({ ...value, comment: event.target.value }))
                }
              />
              {onAddImage && (
                <Button
                  variant="primary"
                  loading={operation === "addImage"}
                  disabled={unavailable("addImage")}
                  onClick={addImage}
                >
                  {t("Add marked image to draft")}
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={busy || !draft.document.marks.length}
                onClick={() => changeDocument({ marks: [] })}
              >
                <Trash2 className="icon-sm" aria-hidden />
                {t("Clear annotations")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setAnnotations((values) => {
                    const next = { ...values };
                    delete next[selected];
                    return next;
                  });
                  setAnnotating(false);
                  setSurface(undefined);
                }}
              >
                {t("Discard annotation")}
              </Button>
            </div>
          )}
          {surface === "output" && <pre className="device-panel-output">{output}</pre>}
          {surface === "setup" && status && (
            <details open className="host-tool-help device-panel-setup">
              <summary>
                {t("Setup and access")}
                <span className="host-tool-muted device-panel-setup-summary">
                  {hostLabel ? `${hostLabel} · ` : ""}
                  {status.running ? t("Device host running") : t("Device host stopped")}
                  {" · "}
                  {t("{p0} devices found", { p0: devices.length })}
                </span>
              </summary>
              <div className="device-panel-setup-body">
                <p className="host-tool-muted">
                  {status.platforms
                    .map(
                      (item) =>
                        `${item.platform === "ios" ? t("iOS") : t("Android")}: ${item.available ? t("SDK detected") : item.reason}`,
                    )
                    .join(" · ")}
                </p>
                {status.lastError && !error ? (
                  <pre className="device-panel-output">{status.lastError}</pre>
                ) : null}
                <div className="host-tool-actions">
                  <Button
                    disabled={unavailable("status", !loadingDevices)}
                    loading={operation === "status"}
                    onClick={() => void execute("status", api.status, setStatus)}
                  >
                    {t("Status")}
                  </Button>
                  <Button
                    disabled={unavailable("setup", sdkAvailable)}
                    loading={operation === "setup"}
                    onClick={() => void execute("setup", () => api.setup(control), setStatus)}
                  >
                    {status.installed ? t("Update setup") : t("Set up device tools")}
                  </Button>
                  <Button
                    disabled={unavailable("start", status.installed && !status.running)}
                    loading={operation === "start"}
                    onClick={() => void execute("start", api.start, setStatus)}
                  >
                    {t("Start device host")}
                  </Button>
                  <Button
                    disabled={unavailable("stop", status.running)}
                    loading={operation === "stop"}
                    onClick={() => {
                      setLive(false);
                      void execute("stop", api.stop, (value) => {
                        setStatus(value);
                        setFrame(undefined);
                        setSelected("");
                        setApp("");
                        setDevices([]);
                        setOutput("");
                      });
                    }}
                  >
                    {t("Stop device host")}
                  </Button>
                </div>
                <p className="host-tool-muted">
                  {t(
                    "Viewing never enables control. Live view refreshes once per second while this panel is visible; closing it pauses viewing. Setup downloads pinned expo-device-hub 0.12.0 and optional control tools into the host cache, and Stop ends the owned tool processes.",
                  )}
                </p>
              </div>
            </details>
          )}
        </Popover>
      )}
    </section>
  );
}
