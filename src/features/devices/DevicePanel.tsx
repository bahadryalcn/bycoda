import { toolPreferences } from "../host-tools/public/toolPreferences";
import type { CSSProperties, ReactNode } from "react";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { OutputBlock } from "../../shared/ui/OutputBlock";
import { Text } from "../../shared/ui/Text";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { NumberField } from "../../shared/ui/NumberField";
import { DeviceBar } from "./ui/DeviceBar";
import { DeviceSetupPanel } from "./ui/DeviceSetupPanel";
import { DeviceConnectState, DeviceWaitingState } from "./ui/DeviceStageStates";
import { DeviceFrameState } from "./ui/DeviceFrameState";
import { DeviceOptionsMenu } from "./ui/DeviceOptionsMenu";
import { DeviceInspector } from "./ui/DeviceInspector";
import { presentRemoteError } from "../connections/public/remoteFailure";
import { useDeviceStatus } from "./hooks/useDeviceStatus";
import { useDeviceLiveStream } from "./hooks/useDeviceLiveStream";
import { kindLabel, platformVersionLabel, stateLabel } from "./model/deviceLabels";
import { createAnnotationDraftCache } from "./model/annotationDraftCache";
import { createTouchSession, type TouchPoint, type TouchSession } from "./model/touchSession";
import {
  peekToolsDraftPart,
  subscribeToolsDraftTransfer,
  writeToolsDraftPart,
  holdToolsDraftTransfer,
  type ToolsDraftScope,
} from "../host-tools/toolsDraftTransfer";
import { TextField } from "../../shared/ui/TextField";
import { TextareaField } from "../../shared/ui/TextareaField";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as technicalI18n from "../../shared/i18n/technical";
import { DeviceNotices } from "./ui/DeviceNotices";
import { LoadingText } from "../../shared/ui/LoadingText";
import { Button } from "../../shared/ui/Button";
import { Disclosure } from "../../shared/ui/Disclosure";
import { FailureState } from "../../shared/ui/FailureState";
import { useConnectionErrorShownCentrally } from "../../shared/ui/connectionErrorGate";
import { Progress } from "../../shared/ui/Progress";
import { Popover } from "../../shared/ui/Popover";
import { PanelHeader } from "../../shared/ui/PanelHeader";
import { MediaToolbarButton } from "../../shared/ui/MediaToolbar";
import {
  ImageAnnotationCanvas,
  ImageAnnotationToolbar,
  rasterizeImageAnnotations,
  type ImageAnnotationDocument,
} from "../../shared/ui/ImageAnnotationCanvas";
import {
  AppWindow,
  Check,
  CursorMagicSelection,
  Home,
  ImagePlus,
  Keyboard,
  MessageSquarePlus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
} from "../../shared/ui/icons";
import "./DevicePanel.css";
import { hitTestDeviceNodes } from "./deviceInspector";
import {
  DeviceImageDraftChangedError,
  DeviceImageDraftDeliveryUncertainError,
  DeviceImageDraftRejectedError,
  reconcileDeviceImageTransfer,
  type DeviceImageTransferOperation,
} from "./deviceImageComposer";
import type {
  DeviceAction,
  DeviceFrame,
  DeviceHostStatus,
  DevicePanelApi,
  DeviceSummary,
  DeviceControlStatus,
  DeviceControlLease,
  DeviceInspection,
} from "./types";
const { t, useLocale } = technicalI18n;
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
  | "inspect"
  | DeviceAction["type"];
type AnnotationDraft = {
  frame: DeviceFrame;
  document: ImageAnnotationDocument;
  undo: ImageAnnotationDocument[];
  redo: ImageAnnotationDocument[];
  comment: string;
  transferOperation?: DeviceImageTransferOperation;
};
// Layout/tool switches unmount the surface. Keep unfinished image edits in the
// source conversation and machine scope, without retaining a device permission.
/** Consecutive failed control-status reads before the UI treats control as lost (10 s apart). */
const CONTROL_STATUS_MAX_FAILURES = 3;
/** Pointer position as a 0 to 1 fraction of the preview, clamped so a drag past the edge stays on screen. */
const touchPoint = (
  event: { clientX: number; clientY: number },
  bounds: { left: number; top: number; width: number; height: number },
): TouchPoint => ({
  x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
  y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
});

const annotationDraftCache = createAnnotationDraftCache<AnnotationDraft>();
type DeviceInputs = Record<string, { app: string; text: string }>;
const inputDraftCache = new Map<string, DeviceInputs>();
const unavailableTransport = (cause: unknown) =>
  /RPC_HOST_UNAVAILABLE|host unavailable|host connection.*(?:closed|refused)/i.test(String(cause));

type DevicePanelProps = {
  transferScope?: ToolsDraftScope;
  active?: boolean;
  api: DevicePanelApi;
  hostLabel?: string;
  machinePicker?: ReactNode;
  onAddDevice?: (device: DeviceSummary) => Promise<void>;
  onAddImage?: (
    device: DeviceSummary,
    frame: DeviceFrame,
    comment: string,
    operation?: DeviceImageTransferOperation,
  ) => Promise<void>;
  draftScope?: string;
};

const apiKeys = new WeakMap<object, number>();
let nextApiKey = 0;
function apiKeyFor(api: DevicePanelApi): number {
  let key = apiKeys.get(api);
  if (key === undefined) {
    key = nextApiKey++;
    apiKeys.set(api, key);
  }
  return key;
}

/** A visible panel follows the selected device and acquires its control lease. */
export function DevicePanel(props: DevicePanelProps) {
  // A new Host API (conversation or machine switch) starts a fresh surface.
  return <DevicePanelSurface key={apiKeyFor(props.api)} {...props} />;
}

function DevicePanelSurface({
  active: visible = true,
  api,
  hostLabel,
  machinePicker,
  onAddDevice,
  onAddImage,
  draftScope,
  transferScope,
}: DevicePanelProps) {
  useLocale();
  const saved = transferScope ? peekToolsDraftPart(transferScope, "device") : undefined;
  const [status, setStatus] = useState<DeviceHostStatus>();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [selected, setSelected] = useState(saved?.selected ?? "");
  const [frame, setFrame] = useState<DeviceFrame | undefined>(
    saved?.annotations[saved.selected]?.frame,
  );
  function readableDeviceError(error: string): string | undefined {
    if (/DEVICE_CONTROL_BUSY/.test(error)) return t("Device control held by another controller");
    if (/DEVICE_CONTROL_LEASE_INVALID/.test(error)) return t("Device control expired.");
    if (/DEVICE_INSPECTION_STALE/.test(error))
      return t("The device screen changed. Refresh inspection before selecting a node.");
    if (/DEVICE_INSPECTION_UNSUPPORTED/.test(error))
      return t("This device does not provide a structured accessibility tree.");
    return undefined;
  }
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [discoveryUnavailable, setDiscoveryUnavailable] = useState(false);
  const [autoLive] = useState(() => toolPreferences.deviceAutoLive.load());
  // A panel restored from a retained draft (for example after moving the dock) keeps viewing that
  // device like a freshly opened one; a frozen annotation frame stays paused. An unbooted device
  // is corrected to paused when the device list loads.
  const [live, setLive] = useState(() => autoLive && !!saved?.selected && !saved.annotating);
  // The surface starts by reading the Host status in the effect below.
  const [busy, setBusy] = useState(true);
  const [operation, setOperation] = useState<DeviceOperation>();
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | undefined>(saved?.error);
  const showActionError = (cause: unknown) =>
    setError(presentRemoteError(cause, { explicit: true }));
  const [errorOperation, setErrorOperationState] = useState<DeviceOperation>(
    (saved?.errorOperation as DeviceOperation) ?? "status",
  );
  const errorOperationRef = useRef<DeviceOperation>(
    (saved?.errorOperation as DeviceOperation) ?? "status",
  );
  const retainedOutcome = useRef(Boolean(saved?.error || saved?.notice || saved?.actionCompleted));
  const setErrorOperation = useCallback((name: DeviceOperation) => {
    errorOperationRef.current = name;
    setErrorOperationState(name);
  }, []);
  const [control, setControl] = useState(false);
  const [controlStatus, setControlStatus] = useState<DeviceControlStatus>();
  const [controlError, setControlError] = useState<string>();
  const [controlLease, setControlLease] = useState<DeviceControlLease>();
  const controlLeaseRef = useRef(controlLease);
  controlLeaseRef.current = controlLease;
  const claimRequests = useRef<Record<string, string>>({});
  const [inspection, setInspection] = useState<DeviceInspection>();
  const [inspectionSearch, setInspectionSearch] = useState("");
  const [selectedNode, setSelectedNode] = useState("");
  const [hoveredNode, setHoveredNode] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [frameStale, setFrameStale] = useState(false);
  const inputDrafts = useRef<DeviceInputs>(
    saved?.inputs ?? (draftScope ? inputDraftCache.get(draftScope) : undefined) ?? {},
  );
  const [app, setApp] = useState(saved?.app ?? "");
  const [text, setText] = useState(saved?.text ?? "");
  const [output, setOutput] = useState(saved?.output ?? "");
  const [deviceNotice, setDeviceNotice] = useState<
    | {
        text: string;
        error: boolean;
      }
    | undefined
  >(saved?.notice);
  // Set when the device action itself succeeded but the follow-up frame read failed.
  const [actionCompleted, setActionCompleted] = useState(saved?.actionCompleted ?? false);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [endX, setEndX] = useState(0);
  const [endY, setEndY] = useState(0);
  const [surface, setSurface] = useState<
    "menu" | "app" | "text" | "coordinates" | "note" | "setup" | "output" | "inspector"
  >();
  const [surfaceAnchor, setSurfaceAnchor] = useState<HTMLElement | null>(null);
  const [annotating, setAnnotating] = useState(saved?.annotating ?? false);
  const [annotationTool, setAnnotationTool] = useState<"box" | "arrow" | "pen" | "pin">(
    saved?.annotationTool ?? "box",
  );
  const [zoom, setZoom] = useState(saved?.zoom ?? toolPreferences.devicePreviewScale.load());
  const [annotations, setAnnotationState] = useState<Record<string, AnnotationDraft>>(
    () => saved?.annotations ?? (draftScope ? (annotationDraftCache.get(draftScope) ?? {}) : {}),
  );
  const annotationsRef = useRef(annotations);
  // Pins this scope while the panel is mounted so the bounded draft cache never evicts a draft the user is editing.
  useEffect(() => (draftScope ? annotationDraftCache.pin(draftScope) : undefined), [draftScope]);
  useEffect(() => {
    if (!transferScope) return;
    return subscribeToolsDraftTransfer(transferScope, ({ device }) => {
      if (!device) return;
      setSelected(device.selected);
      // A moved panel keeps viewing the retained device like a freshly opened one; a frozen
      // annotation frame stays paused.
      setLive(autoLive && !!device.selected && !device.annotating);
      setApp(device.app);
      setText(device.text);
      inputDrafts.current = device.inputs ?? {};
      setZoom(device.zoom);
      setAnnotating(device.annotating ?? false);
      setAnnotationTool(device.annotationTool ?? "box");
      setFrame(device.annotations[device.selected]?.frame);
      setControl(false);
      setControlStatus(undefined);
      setControlLease(undefined);
      setInspection(undefined);
      setError(device.error);
      retainedOutcome.current = Boolean(device.error || device.notice || device.actionCompleted);
      setErrorOperationState((device.errorOperation as DeviceOperation) ?? "status");
      errorOperationRef.current = (device.errorOperation as DeviceOperation) ?? "status";
      setOutput(device.output ?? "");
      setDeviceNotice(device.notice);
      setActionCompleted(device.actionCompleted ?? false);
      annotationsRef.current = device.annotations;
      setAnnotationState(device.annotations);
      if (draftScope) annotationDraftCache.set(draftScope, device.annotations);
    });
  }, [transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue, draftScope]);
  // Draft text is scoped to its actual device. A draft never carries a control lease.
  useLayoutEffect(() => {
    if (!selected) return;
    const previous = inputDrafts.current[selected];
    if ((!previous && !app && !text) || (previous?.app === app && previous.text === text)) return;
    inputDrafts.current = { ...inputDrafts.current, [selected]: { app, text } };
    // Retain every unfinished device draft. Transfer's UTF-8 budget rejects an
    // oversized snapshot instead of silently evicting user-authored text.
    if (!app && !text) delete inputDrafts.current[selected];
    if (draftScope) {
      if (inputDraftCache.has(draftScope)) inputDraftCache.delete(draftScope);
      if (Object.keys(inputDrafts.current).length)
        inputDraftCache.set(draftScope, inputDrafts.current);
      while (inputDraftCache.size > 64)
        inputDraftCache.delete(inputDraftCache.keys().next().value!);
    }
  }, [selected, app, text, draftScope]);
  useEffect(() => {
    if (visible && transferScope)
      writeToolsDraftPart(transferScope, "device", {
        selected,
        app,
        text,
        inputs: inputDrafts.current,
        zoom,
        annotating,
        annotationTool,
        annotations,
        error,
        errorOperation,
        output,
        notice: deviceNotice,
        actionCompleted,
      });
  }, [
    visible,
    transferScope?.cwd,
    transferScope?.sessionId,
    transferScope?.targetValue,
    selected,
    app,
    text,
    zoom,
    annotating,
    annotationTool,
    annotations,
    error,
    errorOperation,
    output,
    deviceNotice,
    actionCompleted,
  ]);
  useLayoutEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);
  const setAnnotations = (
    change:
      | Record<string, AnnotationDraft>
      | ((value: Record<string, AnnotationDraft>) => Record<string, AnnotationDraft>),
  ) => {
    // Compute from the latest drafts and retain them in the module cache here,
    // not inside a state updater that React may repeat or discard.
    const next = typeof change === "function" ? change(annotationsRef.current) : change;
    annotationsRef.current = next;
    if (draftScope) annotationDraftCache.set(draftScope, next);
    setAnnotationState(next);
  };
  const gesture = useRef<{
    x: number;
    y: number;
    clientX: number;
    clientY: number;
    pointerId: number;
    deviceId: string;
    leaseId: string | undefined;
    width: number;
    height: number;
  } | null>(null);
  // The one live touch in progress; it owns a pointer, a target and a lease until it ends.
  const liveTouch = useRef<{ session: TouchSession; pointerId: number } | null>(null);
  const scope = useMemo(() => ({}), [api]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const pending = useRef<object | null>(null);
  const pendingDone = useRef<Promise<void>>(Promise.resolve());
  const inputQueue = useRef<Promise<void>>(Promise.resolve());
  const queuedGestures = useRef(0);
  const capturePending = useRef<Promise<DeviceFrame> | null>(null);
  const mounted = useRef(true);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useDeviceStatus(api, visible, setStatus, setError, setBusy, connectionUnavailable);
  const execute = useCallback(
    async <T,>(
      name: DeviceOperation,
      work: (isCurrent: () => boolean) => Promise<T>,
      commit: (value: T) => void,
    ) => {
      if (pending.current || !visibleRef.current) return;
      const token = {};
      let finishPending!: () => void;
      pendingDone.current = new Promise<void>((resolve) => {
        finishPending = resolve;
      });
      retainedOutcome.current = false;
      const requestScope = scope;
      pending.current = token;
      const releaseTransfer = transferScope ? holdToolsDraftTransfer(transferScope) : undefined;
      const current = () => mounted.current && currentScope.current === requestScope;
      setBusy(true);
      setOperation(name);
      setError(undefined);
      setErrorOperation(name);
      if (name !== "addImage" && name !== "capture") setActionCompleted(false);
      try {
        // A live capture and sent gestures must finish before boot/stop/input or another capture.
        await capturePending.current?.catch(() => {});
        await inputQueue.current;
        if (!current()) return;
        const value = await work(current);
        if (current()) commit(value);
      } catch (cause) {
        if (current()) {
          setError(
            presentRemoteError(cause, { explicit: name !== "status" && name !== "capture" }),
          );
          if (name === "status") setStatus(undefined);
          if (name === "refresh") setDiscoveryUnavailable(true);
          if (/DEVICE_CONTROL_LEASE_INVALID/.test(String(cause))) {
            setControl(false);
            setControlLease(undefined);
            delete claimRequests.current[selectedRef.current];
          }
          if (/DEVICE_INSPECTION_STALE/.test(String(cause))) {
            setInspection(undefined);
            setSelectedNode("");
            setHoveredNode("");
          }
          if (
            name === "capture" ||
            name === "press" ||
            name === "swipe" ||
            name === "home" ||
            name === "type" ||
            name === "openApp"
          ) {
            setFrameStale(true);
            setInspection(undefined);
            setSelectedNode("");
          }
          if (unavailableTransport(cause)) setConnectionUnavailable(true);
        }
      } finally {
        finishPending();
        releaseTransfer?.();
        if (current() && pending.current === token) {
          pending.current = null;
          setBusy(false);
          setOperation(undefined);
        }
      }
    },
    [scope, transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue],
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
      if (controlLeaseRef.current) delete claimRequests.current[controlLeaseRef.current.deviceId];
      setSelected(deviceId);
      setApp(inputDrafts.current[deviceId]?.app ?? "");
      setFrame(undefined);
      setLive(booted && autoLive);
      setControl(false);
      setControlStatus(undefined);
      setControlError(undefined);
      setControlLease(undefined);
      setInspection(undefined);
      setSelectedNode("");
      setFrameStale(false);
      setText(inputDrafts.current[deviceId]?.text ?? "");
      setOutput("");
      setDeviceNotice(undefined);
      setActionCompleted(false);
      setConnectionUnavailable(false);
      setAnnotating(false);
      setSurface(undefined);
      // Host/discovery failures remain relevant across selections. Device action
      // and capture failures belong only to the device that produced them.
      if (
        !preserveDiscoveryError &&
        errorOperationRef.current !== "status" &&
        errorOperationRef.current !== "refresh"
      )
        setError(undefined);
    },
    [autoLive],
  );
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const applyDevices = useCallback(
    (value: Awaited<ReturnType<DevicePanelApi["list"]>>) => {
      setDiscoveryUnavailable(value.errors.length > 0);
      setDevicesLoaded(true);
      setDevices(value.devices);
      if (!retainedOutcome.current) {
        setErrorOperation("refresh");
        setError(value.errors.length ? value.errors.join("\n") : undefined);
      }
      const current = value.devices.find((device) => device.id === selectedRef.current);
      if (!current) {
        if (selectedRef.current && transferScope && peekToolsDraftPart(transferScope, "device"))
          return;
        // Prefer a connected phone. Opening the panel does not send input or boot a device.
        const preferred =
          value.devices.find((device) => device.booted && device.physical) ??
          value.devices.find((device) => device.booted) ??
          value.devices[0];
        selectDevice(preferred?.id ?? "", !!preferred?.booted, true);
      } else if (!current.booted) {
        setFrame(undefined);
        setLive(false);
        setOutput("");
      }
    },
    [selectDevice, transferScope?.cwd, transferScope?.sessionId, transferScope?.targetValue],
  );
  useEffect(() => {
    if (!visible) return;
    // An unread/failed status is not a confirmed stop; keep the retained target and frame.
    if (!status) return;
    if (!status.running) {
      setLoadingDevices(false);
      setDevicesLoaded(false);
      setLive(false);
      setSelected("");
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
          if (active) {
            setDiscoveryUnavailable(true);
            setConnectionUnavailable(true);
            setError(presentRemoteError(cause, { explicit: true }));
          }
        },
      )
      .finally(() => {
        if (active) setLoadingDevices(false);
      });
    return () => {
      active = false;
    };
  }, [api, status?.running, applyDevices, visible, reload]);
  // Video when the Host can stream this device; the still captures below are the fallback.
  const liveStream = useDeviceLiveStream({
    stream: api.stream,
    subscribeStream: api.subscribeStream,
    deviceId: selected,
    enabled: visible && live && !!selected && !!status?.running,
    onFrame: useCallback((deviceId: string) => {
      if (selectedRef.current !== deviceId) return;
      setFrameStale(false);
      setActionCompleted(false);
      if (errorOperationRef.current === "capture") setError(undefined);
    }, []),
  });
  const streaming = !!liveStream.picture;
  const screenSize = liveStream.picture ?? imageSize;
  useEffect(() => {
    if (!visible || !live || !selected || !status?.running || streaming) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      if (cancelled) return;
      const started = performance.now();
      if (
        !document.hidden &&
        !pending.current &&
        !capturePending.current &&
        !queuedGestures.current
      ) {
        try {
          const value = await capture(selected);
          if (!cancelled) {
            setFrame(value);
            setFrameStale(false);
            setInspection(undefined);
            setSelectedNode("");
            failures = 0;
            if (errorOperationRef.current === "capture") setError(undefined);
            setActionCompleted(false);
          }
        } catch (cause) {
          if (!cancelled) {
            setErrorOperation("capture");
            setError(presentRemoteError(cause));
            setFrameStale(true);
            failures++;
          }
        }
      }
      if (!cancelled)
        timer = setTimeout(
          () => {
            void poll();
          },
          failures
            ? Math.min(8000, 1000 * 2 ** failures)
            : Math.max(100, 1000 - (performance.now() - started)),
        );
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [live, selected, capture, status?.running, visible, streaming, setErrorOperation]);
  const action = (command: DeviceAction) =>
    void execute(
      command.type,
      async (isCurrent) => {
        if (
          !controlLease?.leaseId ||
          controlLease.deviceId !== selected ||
          controlLease.expiresAt <= Date.now()
        )
          throw new Error("DEVICE_CONTROL_LEASE_INVALID");
        setInspection(undefined);
        setSelectedNode("");
        if (command.type === "fold") {
          setFrameStale(true);
          setImageSize({ width: 0, height: 0 });
        }
        const output = await api.action(selected, command, controlLease.leaseId);
        // The video stream already shows the result; a still capture would only delay input.
        if (!isCurrent() || streaming) return { output, frame: undefined, error: undefined };
        try {
          return { output, frame: await capture(selected), error: undefined };
        } catch (cause) {
          return {
            output,
            frame: undefined,
            error: String(cause),
          };
        }
      },
      (value) => {
        setOutput(value.output);
        if (command.type === "openApp") setApp(command.app);
        else if (command.type === "home" && device?.platform === "ios")
          setApp("com.apple.springboard");
        if (value.frame) {
          setFrame(value.frame);
          setFrameStale(false);
        }
        if (value.error) {
          setFrameStale(true);
          setErrorOperation("capture");
          setError(value.error);
          setActionCompleted(true);
        }
      },
    );
  // Screen gestures reach the device like a remote screen: they never put the panel in its busy
  // state, so the stage, device bar and following taps stay live while earlier input is sent.
  // Gestures run one after another in the order the user made them.
  const reportGestureFailure = (
    cause: unknown,
    operation: "press" | "swipe",
    deviceId: string,
    current: () => boolean,
  ) => {
    if (!current()) return;
    setErrorOperation(operation);
    setError(presentRemoteError(cause, { explicit: true }));
    if (/DEVICE_CONTROL_LEASE_INVALID/.test(String(cause))) {
      setControl(false);
      setControlLease(undefined);
      delete claimRequests.current[deviceId];
    }
    if (unavailableTransport(cause)) setConnectionUnavailable(true);
  };
  // Video and live stills already show the result; a paused screen reads one still.
  const refreshPausedStill = async (deviceId: string, current: () => boolean) => {
    try {
      const value = await capture(deviceId);
      if (!current()) return;
      setFrame(value);
      setFrameStale(false);
    } catch (cause) {
      if (!current()) return;
      setFrameStale(true);
      setErrorOperation("capture");
      setError(String(cause));
      setActionCompleted(true);
    }
  };
  // Queues input behind earlier gestures; releasing control waits for all of it.
  const enqueueInput = (run: () => Promise<void>) => {
    queuedGestures.current++;
    const next = inputQueue.current
      .then(run)
      .finally(() => {
        queuedGestures.current--;
      })
      .catch(() => {});
    inputQueue.current = next;
    pendingDone.current = Promise.all([pendingDone.current, next]).then(() => {});
  };
  const sendGesture = (command: Extract<DeviceAction, { type: "press" | "swipe" }>) => {
    const deviceId = selected;
    const requestScope = scope;
    const leaseId = controlLeaseRef.current?.leaseId;
    if (!leaseId) return;
    const refreshStill = !streaming && !live;
    const current = () =>
      mounted.current && currentScope.current === requestScope && selectedRef.current === deviceId;
    setInspection(undefined);
    setSelectedNode("");
    enqueueInput(async () => {
      await capturePending.current?.catch(() => {});
      const lease = controlLeaseRef.current;
      if (
        !current() ||
        lease?.leaseId !== leaseId ||
        lease.deviceId !== deviceId ||
        lease.expiresAt <= Date.now()
      )
        return;
      try {
        const output = await api.action(deviceId, command, lease.leaseId);
        if (!current()) return;
        setOutput(output);
        if (errorOperationRef.current === "press" || errorOperationRef.current === "swipe")
          setError(undefined);
      } catch (cause) {
        reportGestureFailure(cause, command.type, deviceId, current);
        return;
      }
      if (refreshStill) await refreshPausedStill(deviceId, current);
    });
  };
  // A Host that speaks the touch protocol follows the pointer while it moves, so scrolls and
  // drags track the finger. A failed live touch is reported, never replayed as press or swipe.
  const startLiveTouch = (start: TouchPoint, pointerId: number, leaseId: string) => {
    const touch = api.touch;
    if (!touch) return;
    const deviceId = selected;
    const requestScope = scope;
    const refreshStill = !streaming && !live;
    const current = () =>
      mounted.current && currentScope.current === requestScope && selectedRef.current === deviceId;
    const session = createTouchSession({
      start,
      after: inputQueue.current,
      gate: async () => {
        await capturePending.current?.catch(() => {});
        const lease = controlLeaseRef.current;
        return (
          current() &&
          visibleRef.current &&
          lease?.leaseId === leaseId &&
          lease.deviceId === deviceId &&
          lease.expiresAt > Date.now()
        );
      },
      send: (phase, point) => touch(deviceId, { phase, x: point.x, y: point.y }, leaseId),
      onFailure: (cause) => reportGestureFailure(cause, "press", deviceId, current),
    });
    const entry = { session, pointerId };
    liveTouch.current = entry;
    // The queue holds later input until this touch has ended on the Host.
    enqueueInput(async () => {
      const completed = await session.done;
      if (liveTouch.current === entry) liveTouch.current = null;
      if (!completed || !current()) return;
      if (errorOperationRef.current === "press" || errorOperationRef.current === "swipe")
        setError(undefined);
      if (refreshStill) await refreshPausedStill(deviceId, current);
    });
  };
  const device = devices.find((item) => item.id === selected);
  const ownershipSupported =
    status?.controlProtocol === 1 && !!api.claimControl && !!api.releaseControl;
  const controlReady = visible && !!status?.running && !!device?.booted && ownershipSupported;
  useEffect(() => {
    if (!controlLease) return;
    const expiryTimer = setTimeout(
      () => {
        if (
          controlLeaseRef.current?.leaseId === controlLease.leaseId &&
          controlLeaseRef.current.expiresAt > Date.now()
        )
          return;
        setControl(false);
        setControlLease(undefined);
        setInspection(undefined);
        delete claimRequests.current[controlLease.deviceId];
      },
      Math.min(2_147_483_647, Math.max(0, controlLease.expiresAt - Date.now())),
    );
    return () => clearTimeout(expiryTimer);
  }, [controlLease]);
  useEffect(() => {
    if (!controlLease || !api.releaseControl) return;
    return () => {
      const waitForInput = pendingDone.current;
      const waitForCapture = capturePending.current;
      void Promise.allSettled([waitForInput, waitForCapture])
        .then(() => api.releaseControl!(controlLease.deviceId, controlLease.leaseId))
        .catch(() => {});
    };
  }, [api, controlLease?.leaseId]);
  useEffect(() => {
    if (!visible || !controlLease || !api.renewControl) return;
    const lease = controlLease;
    let current = true,
      renewing = false;
    const renew = () => {
      if (document.hidden) return void (timer = setTimeout(renew, 1000));
      if (renewing) return;
      renewing = true;
      void api.renewControl!(lease.deviceId, lease.leaseId)
        .then(
          (value) => {
            if (current) {
              controlLeaseRef.current = value;
              setControlLease(value);
            }
          },
          (cause: unknown) => {
            if (current) {
              setControl(false);
              setControlLease(undefined);
              setInspection(undefined);
              setDeviceNotice({ text: String(cause), error: true });
            }
          },
        )
        .finally(() => {
          renewing = false;
        })
        .catch(() => {});
    };
    const delay = Math.max(100, Math.min(60000, (lease.expiresAt - Date.now()) / 2));
    let timer = setTimeout(renew, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, visible, controlLease?.leaseId, controlLease?.expiresAt]);
  // Release the lease when the selected target can no longer accept control.
  useEffect(() => {
    if (!controlReady) {
      if (controlLeaseRef.current) delete claimRequests.current[controlLeaseRef.current.deviceId];
      setControl(false);
      setControlStatus(undefined);
      setControlError(undefined);
      setControlLease(undefined);
      setInspection(undefined);
    }
  }, [controlReady]);
  // Claim only the active, booted target and reconcile ownership while it remains visible.
  useEffect(() => {
    const { claimControl, releaseControl, controlStatus: readControl } = api;
    if (!controlReady || !claimControl || !releaseControl) return;
    let current = true;
    let reading = false;
    let claimingRequest: string | undefined;
    // A rejected read is "unknown", not "not held": only a run of failures drops control.
    let failures = 0;
    const refresh = async () => {
      if (document.hidden || pending.current || reading) return;
      reading = true;
      const leaseAtRead = controlLeaseRef.current;
      try {
        const value = await readControl?.(selected);
        if (!current || controlLeaseRef.current !== leaseAtRead) return;
        failures = 0;
        setControlStatus(value);
        if (leaseAtRead) {
          if (!value || value.busy) {
            if (leaseAtRead.expiresAt > Date.now()) setControl(true);
            return;
          }
          setControl(false);
          setControlLease(undefined);
          setInspection(undefined);
          delete claimRequests.current[selected];
        }
        // A previous claim can have reached the Host even if its reply was lost.
        if (annotating || (value?.busy && !claimRequests.current[selected])) return;
        const requestId = (claimRequests.current[selected] ??= crypto.randomUUID());
        claimingRequest = requestId;
        try {
          const lease = await claimControl(selected, requestId);
          if (!current || selectedRef.current !== selected || !visibleRef.current) {
            await releaseControl(selected, lease.leaseId).catch(() => {});
            return;
          }
          controlLeaseRef.current = lease;
          setControlLease(lease);
          setControlStatus({ deviceId: selected, busy: true });
          setControlError(undefined);
          setControl(true);
        } catch (cause) {
          if (!current) return;
          if (/DEVICE_CONTROL_BUSY|DEVICE_CONTROL_LEASE_INVALID/.test(String(cause))) {
            delete claimRequests.current[selected];
            setControlStatus({ deviceId: selected, busy: true });
            setControlError(undefined);
          } else setControlError(presentRemoteError(cause));
        } finally {
          claimingRequest = undefined;
        }
      } catch {
        if (!current || ++failures < CONTROL_STATUS_MAX_FAILURES) return;
        setControl(false);
        setControlStatus(undefined);
      } finally {
        reading = false;
      }
    };
    const poll = () => void refresh().catch(() => {});
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      current = false;
      if (claimingRequest && claimRequests.current[selected] === claimingRequest)
        delete claimRequests.current[selected];
      clearInterval(timer);
    };
  }, [api, selected, controlReady, annotating]);
  const canViewDevice = !!device?.booted && !loadingDevices;
  const canControlDevice =
    canViewDevice &&
    controlReady &&
    control &&
    !!controlLease?.leaseId &&
    controlLease.deviceId === selected &&
    controlLease.expiresAt > Date.now() &&
    !!status?.agentInstalled &&
    !connectionUnavailable;
  const canView = canViewDevice && !busy;
  const canControl = canControlDevice && !busy;
  const unavailable = (name: DeviceOperation, enabled = true) =>
    !enabled || (busy && operation !== name);
  const windowsAndroid = status?.platform === "win32" && device?.platform === "android";
  const textError =
    windowsAndroid && text && (!/^[\x20-\x7e]+$/.test(text) || text.includes("%s"))
      ? t(
          "This device input supports printable ASCII only and cannot send %s. Enter this text on the device; your draft is kept.",
        )
      : undefined;
  const coordinatesValid =
    Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= 20000 && y <= 20000;
  const sdkAvailable = !!status?.platforms.some((item) => item.available);
  const refreshDevices = () => void execute("refresh", api.list, applyDevices);
  const discoveryError = errorOperation === "status" || errorOperation === "refresh";
  // A machine connection failure while loading devices is explained once by the central notice.
  const discoveryShownCentrally = useConnectionErrorShownCentrally(
    discoveryError ? error : undefined,
  );
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
    if (busy) return;
    const current = liveStream.snapshot() ?? frame;
    if (!current) return;
    setFrame(current);
    setLive(false);
    setAnnotations((values) =>
      values[selected]
        ? values
        : {
            ...values,
            [selected]: {
              frame: current,
              document: { marks: [] },
              undo: [],
              redo: [],
              comment: "",
            },
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
        try {
          await onAddImage(
            currentDevice,
            {
              mime: image.mime,
              base64: image.base64,
              capturedAt: currentDraft.frame.capturedAt,
            },
            currentDraft.comment,
            currentDraft.transferOperation,
          );
          if (isCurrent())
            updateDraft((value) => ({
              ...value,
              transferOperation: undefined,
            }));
        } catch (cause) {
          if (
            isCurrent() &&
            (cause instanceof DeviceImageDraftDeliveryUncertainError ||
              cause instanceof DeviceImageDraftChangedError)
          )
            updateDraft((value) => ({
              ...value,
              transferOperation: cause.operation,
            }));
          else if (isCurrent() && cause instanceof DeviceImageDraftRejectedError)
            updateDraft((value) => ({
              ...value,
              transferOperation: undefined,
            }));
          throw cause;
        }
      },
      () => {
        setSurface(undefined);
        setDeviceNotice({ text: t("Image added to draft."), error: false });
      },
    );
  };
  const controlEnabled = canControl && !annotating;
  useEffect(() => {
    if (!inspection) return;
    const timer = setTimeout(() => {
      setInspection(undefined);
      setHoveredNode("");
      setSelectedNode("");
      setDeviceNotice({
        text: t("Accessibility snapshot expired. Refresh inspection before selecting a node."),
        error: false,
      });
    }, 30000);
    return () => clearTimeout(timer);
  }, [inspection]);
  const inspectDevice = () => {
    if (!api.inspect || !controlLease?.leaseId) return;
    setLive(false);
    setInspection(undefined);
    setSelectedNode("");
    setHoveredNode("");
    void execute(
      "inspect",
      () => api.inspect!(selected, controlLease.leaseId),
      (value) => {
        setFrame(value.frame);
        setImageSize({ width: 0, height: 0 });
        setFrameStale(false);
        setInspection(value);
        setSelectedNode("");
        setHoveredNode("");
        setSurface("inspector");
      },
    );
  };
  const highlightedNode = inspection?.nodes.find(
    (value) => value.id === (hoveredNode || selectedNode),
  );
  const previewInspection =
    !!inspection &&
    inspection.coordinateSpace === "pixels" &&
    !!inspection.viewport &&
    frame === inspection.frame &&
    imageSize.width === inspection.viewport.width &&
    imageSize.height === inspection.viewport.height &&
    !annotating &&
    !frameStale;
  const pointNode = (image: HTMLImageElement, clientX: number, clientY: number) => {
    const bounds = image.getBoundingClientRect();
    if (
      !previewInspection ||
      !bounds.width ||
      !bounds.height ||
      !image.naturalWidth ||
      !image.naturalHeight
    )
      return undefined;
    return hitTestDeviceNodes(
      inspection!.nodes,
      ((clientX - bounds.left) * image.naturalWidth) / bounds.width,
      ((clientY - bounds.top) * image.naturalHeight) / bounds.height,
    );
  };
  const directionalSwipe = (direction: "up" | "down" | "left" | "right") => {
    if (!screenSize.width || !screenSize.height) return;
    const width = screenSize.width - 1,
      height = screenSize.height - 1;
    const starts = {
      up: [0.5, 0.75, 0.5, 0.25],
      down: [0.5, 0.25, 0.5, 0.75],
      left: [0.75, 0.5, 0.25, 0.5],
      right: [0.25, 0.5, 0.75, 0.5],
    } as const;
    const [x, y, endX, endY] = starts[direction];
    sendGesture({
      type: "swipe",
      x: Math.round(x * width),
      y: Math.round(y * height),
      endX: Math.round(endX * width),
      endY: Math.round(endY * height),
    });
  };
  const captureFailed = !!error && errorOperation === "capture";
  const liveTouchSupported = status?.touchProtocol === 1 && !!api.touch;
  const hasInspection = !!inspection;
  // A live touch belongs to one target, lease and fresh, controllable screen. Leaving any of them
  // (switch, hide, permission or lease loss, stale frame, annotation, inspection, resize) or
  // unmounting ends it with a cancel; the cancel still goes out under the touch's own lease.
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Release the Android pointer when its view or lease changes.
  useEffect(
    () => () => liveTouch.current?.session.end("cancel"),
    [
      api,
      selected,
      visible,
      controlLease?.leaseId,
      controlEnabled,
      captureFailed,
      frameStale,
      hasInspection,
      liveTouchSupported,
      screenSize.width,
      screenSize.height,
    ],
  );
  const bootDevice = () =>
    void execute(
      "boot",
      () => api.boot(selected),
      (value) => {
        setSelected(value.id);
        setLive(value.booted && autoLive);
        setDevices((items) => items.map((item) => (item.id === selected ? value : item)));
      },
    );
  const refreshFrame = () =>
    void execute(
      "capture",
      () => capture(selected),
      (value) => {
        setFrame(value);
        setFrameStale(false);
        setInspection(undefined);
        setSelectedNode("");
        setActionCompleted(false);
      },
    );
  const shownFrame = annotating ? draft?.frame : frame;
  const toolbarReason = connectionUnavailable
    ? t("The device connection is unavailable. Refresh devices to reconnect.")
    : undefined;
  const controlReason =
    toolbarReason ??
    (annotating
      ? t("Finish marking to use control and capture.")
      : !ownershipSupported
        ? t(
            "This Host does not support device control ownership. Update the Host to control this device.",
          )
        : !status?.agentInstalled
          ? t("Set up device control")
          : !control
            ? (controlError ?? (controlStatus?.busy ? undefined : t("Connecting…")))
            : undefined);
  const surfaceTitle = surface
    ? t(
        {
          menu: "Device options",
          app: "Open app",
          text: "Type text",
          coordinates: "Coordinate controls",
          note: "Annotation note",
          setup: "Setup and access",
          output: "Device action result",
          inspector: "Device accessibility inspector",
        }[surface],
      )
    : "";
  // In the device bar before a device is chosen, then at the end of the screen's control rail.
  const optionsButton = (side: "bottom" | "left") => (
    <Button
      variant="ghost"
      iconOnly
      label={t("Device options")}
      tooltipSide={side}
      aria-haspopup="dialog"
      aria-expanded={surface === "menu"}
      onClick={(event) => openSurface("menu", event.currentTarget)}
    >
      <MoreHorizontal className="icon-sm" aria-hidden />
    </Button>
  );
  return (
    <section
      className="host-tool-panel device-panel bycoda-arc"
      aria-label={t("Devices")}
      aria-busy={busy || loadingDevices}
    >
      {error && !discoveryShownCentrally && status && (
        <Disclosure
          {...surfaceAttributes(
            { frame: "danger", edge: "bottom", tone: "danger" },
            "device-panel-error",
          )}
          role="alert"
          size="sm"
          summary={
            readableDeviceError(error) ??
            (discoveryError
              ? t("Could not load devices")
              : actionCompleted
                ? t("Action completed; screen unavailable")
                : captureFailed
                  ? t("Device screen unavailable")
                  : t("Device action failed"))
          }
        >
          <OutputBlock size="micro" tone="primary" leading="inherit">
            {error}
          </OutputBlock>
        </Disclosure>
      )}
      {!status && !error && operation !== "status" && (
        <LoadingText size="caption" leading="inherit" inset="panel">
          {t("Checking device support…")}
        </LoadingText>
      )}
      {!status && (error || operation === "status") && !discoveryShownCentrally && (
        <FailureState
          title={
            readableDeviceError(error ?? "") ??
            (discoveryError ? t("Could not load devices") : t("Device action failed"))
          }
          description={
            hostLabel
              ? t("The device service on {p0} did not respond.", { p0: hostLabel })
              : t("The device service did not respond.")
          }
          error={error ?? ""}
          retrying={operation === "status"}
          onRetry={
            unavailable("status") ? undefined : () => execute("status", api.status, setStatus)
          }
        />
      )}
      {status && !status.running && (
        <DeviceConnectState
          installed={status.installed}
          connecting={operation === "connect"}
          connectDisabled={unavailable("connect", sdkAvailable)}
          setupOpen={surface === "setup"}
          onSetup={(anchor) => openSurface("setup", anchor)}
          onConnect={() =>
            void execute(
              "connect",
              async (isCurrent) => {
                if (!status.installed) await api.setup(false);
                return isCurrent() ? api.start() : status;
              },
              setStatus,
            )
          }
        />
      )}
      {status?.running && (
        <>
          <DeviceBar
            devices={devices}
            selected={selected}
            hostLabel={hostLabel}
            disabled={busy || loadingDevices}
            loading={loadingDevices}
            refreshing={operation === "refresh" || loadingDevices}
            refreshDisabled={unavailable("refresh", !loadingDevices)}
            onSelect={selectDevice}
            onRefresh={refreshDevices}
          >
            {!device && optionsButton("bottom")}
          </DeviceBar>
          <DeviceNotices
            actionCompleted={!!actionCompleted}
            refreshFrame={{
              pending: operation === "capture",
              disabled: unavailable("capture", canViewDevice && !annotating),
              onClick: refreshFrame,
            }}
            setupControl={
              control && !status.agentInstalled
                ? {
                    pending: operation === "setupControl",
                    disabled: unavailable("setupControl", sdkAvailable),
                    onClick: () => void execute("setupControl", () => api.setup(true), setStatus),
                  }
                : undefined
            }
            notice={
              deviceNotice && {
                error: deviceNotice.error,
                display: readableDeviceError(deviceNotice.text) ?? deviceNotice.text,
                onDismiss: () => setDeviceNotice(undefined),
              }
            }
            reason={toolbarReason || undefined}
          />
          {operation === "press" || operation === "swipe" ? (
            <Progress compact tone="neutral" aria-label={t("Working on the host…")} />
          ) : null}
          <div
            {...surfaceAttributes({ variant: "canvas" }, "device-panel-stage")}
            data-rail={device ? true : undefined}
          >
            <div className="device-panel-viewport">
              <div
                className="device-panel-canvas [width:var(--layout-width)] [height:var(--layout-height)]"
                style={
                  {
                    "--layout-width": `${zoom * 100}%`,
                    "--layout-height": `${zoom * 100}%`,
                  } as CSSProperties
                }
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
                ) : frame || streaming ? (
                  <Button
                    variant="ghost"
                    motion="none"
                    layout="media"
                    className="device-panel-preview-control"
                    style={
                      screenSize.height
                        ? ({
                            "--device-aspect":
                              liveStream.picture?.aspect ?? screenSize.width / screenSize.height,
                          } as CSSProperties)
                        : undefined
                    }
                    data-device-interactive={
                      controlEnabled &&
                      !frameStale &&
                      !captureFailed &&
                      device?.platform === "android"
                        ? true
                        : undefined
                    }
                    aria-disabled={
                      (!controlEnabled || frameStale || captureFailed) && !previewInspection
                    }
                    label={
                      inspection
                        ? t(
                            "Native accessibility snapshot · Point at the preview to inspect. Select a node, then press it explicitly.",
                          )
                        : t(
                            "Device screen. Use arrow keys to swipe; use coordinate controls to press.",
                          )
                    }
                    onClick={(event) => {
                      if (
                        event.detail === 0 &&
                        controlEnabled &&
                        !frameStale &&
                        !captureFailed &&
                        !inspection &&
                        device?.platform === "android" &&
                        screenSize.width &&
                        screenSize.height
                      )
                        sendGesture({
                          type: "press",
                          x: Math.round(screenSize.width / 2),
                          y: Math.round(screenSize.height / 2),
                        });
                    }}
                    onKeyDown={(event) => {
                      if (inspection) {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setInspection(undefined);
                          setHoveredNode("");
                          setSelectedNode("");
                          setSurface(undefined);
                        }
                        return;
                      }
                      if (
                        !controlEnabled ||
                        device?.platform !== "android" ||
                        captureFailed ||
                        frameStale
                      )
                        return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (!screenSize.width || !screenSize.height) return;
                        sendGesture({
                          type: "press",
                          x: Math.round(screenSize.width / 2),
                          y: Math.round(screenSize.height / 2),
                        });
                        return;
                      }
                      const directions = {
                        ArrowUp: "up",
                        ArrowDown: "down",
                        ArrowLeft: "left",
                        ArrowRight: "right",
                      } as const;
                      const direction = directions[event.key as keyof typeof directions];
                      if (direction) {
                        event.preventDefault();
                        directionalSwipe(direction);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (inspection) {
                        gesture.current = null;
                        liveTouch.current?.session.end("cancel");
                        const image = event.currentTarget.querySelector("img");
                        if (event.button === 0 && image) {
                          const target = pointNode(image, event.clientX, event.clientY);
                          setSelectedNode(target?.id ?? "");
                          setHoveredNode("");
                          setSurface("inspector");
                        }
                        return;
                      }
                      if (
                        !controlEnabled ||
                        device?.platform !== "android" ||
                        event.button !== 0 ||
                        captureFailed ||
                        frameStale
                      )
                        return;
                      const target = event.currentTarget;
                      const bounds = target.getBoundingClientRect();
                      if (
                        !bounds.width ||
                        !bounds.height ||
                        !screenSize.width ||
                        !screenSize.height
                      )
                        return;
                      // One touch at a time; a second pointer never disturbs it.
                      if (liveTouch.current && !liveTouch.current.session.closed) return;
                      target.setPointerCapture(event.pointerId);
                      if (liveTouchSupported && controlLease?.leaseId) {
                        gesture.current = null;
                        startLiveTouch(
                          touchPoint(event, bounds),
                          event.pointerId,
                          controlLease.leaseId,
                        );
                        return;
                      }
                      gesture.current = {
                        x: Math.round(
                          ((event.clientX - bounds.left) * screenSize.width) / bounds.width,
                        ),
                        y: Math.round(
                          ((event.clientY - bounds.top) * screenSize.height) / bounds.height,
                        ),
                        clientX: event.clientX,
                        clientY: event.clientY,
                        pointerId: event.pointerId,
                        deviceId: selected,
                        leaseId: controlLease?.leaseId,
                        width: screenSize.width,
                        height: screenSize.height,
                      };
                    }}
                    onPointerUp={(event) => {
                      if (inspection) {
                        gesture.current = null;
                        liveTouch.current?.session.end("cancel");
                        return;
                      }
                      const touching = liveTouch.current;
                      if (
                        touching &&
                        !touching.session.closed &&
                        touching.pointerId === event.pointerId
                      ) {
                        // The live touch owns this gesture; it never falls back to press or swipe.
                        const bounds = event.currentTarget.getBoundingClientRect();
                        if (
                          !controlEnabled ||
                          captureFailed ||
                          frameStale ||
                          !bounds.width ||
                          !bounds.height
                        )
                          touching.session.end("cancel");
                        else touching.session.end("up", touchPoint(event, bounds));
                        return;
                      }
                      const start = gesture.current;
                      gesture.current = null;
                      if (
                        !start ||
                        start.pointerId !== event.pointerId ||
                        start.deviceId !== selected ||
                        start.leaseId !== controlLease?.leaseId ||
                        start.width !== screenSize.width ||
                        start.height !== screenSize.height ||
                        !controlEnabled ||
                        captureFailed ||
                        frameStale
                      )
                        return;
                      const bounds = event.currentTarget.getBoundingClientRect();
                      if (
                        !bounds.width ||
                        !bounds.height ||
                        !screenSize.width ||
                        !screenSize.height
                      )
                        return;
                      const x = Math.max(
                        0,
                        Math.min(
                          screenSize.width - 1,
                          Math.round(
                            ((event.clientX - bounds.left) * screenSize.width) / bounds.width,
                          ),
                        ),
                      );
                      const y = Math.max(
                        0,
                        Math.min(
                          screenSize.height - 1,
                          Math.round(
                            ((event.clientY - bounds.top) * screenSize.height) / bounds.height,
                          ),
                        ),
                      );
                      if (
                        Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 6
                      )
                        sendGesture({ type: "press", x: start.x, y: start.y });
                      else
                        sendGesture({
                          type: "swipe",
                          x: start.x,
                          y: start.y,
                          endX: x,
                          endY: y,
                        });
                    }}
                    onPointerCancel={(event) => {
                      gesture.current = null;
                      if (liveTouch.current?.pointerId === event.pointerId)
                        liveTouch.current.session.end("cancel");
                    }}
                    onLostPointerCapture={(event) => {
                      gesture.current = null;
                      // After a normal pointerup the touch has already ended, so this is a no-op.
                      if (liveTouch.current?.pointerId === event.pointerId)
                        liveTouch.current.session.end("cancel");
                    }}
                    onPointerMove={(event) => {
                      if (liveTouch.current?.pointerId === event.pointerId) {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        if (bounds.width && bounds.height)
                          liveTouch.current.session.move(touchPoint(event, bounds));
                        return;
                      }
                      if (!previewInspection) return;
                      const image = event.currentTarget.querySelector("img");
                      if (image)
                        setHoveredNode(pointNode(image, event.clientX, event.clientY)?.id ?? "");
                    }}
                    onPointerLeave={() => setHoveredNode("")}
                  >
                    {streaming && !inspection ? (
                      <canvas
                        ref={liveStream.canvasRef}
                        className="device-panel-live"
                        role="img"
                        aria-label={t("Current device screen")}
                      />
                    ) : frame ? (
                      <img
                        key={inspection?.inspectionId ?? "device-live-frame"}
                        alt={t("Current device screen")}
                        className={
                          controlEnabled &&
                          !frameStale &&
                          !captureFailed &&
                          device?.platform === "android"
                            ? "host-frame-interactive"
                            : undefined
                        }
                        src={imageSource(frame)}
                        draggable={false}
                        onLoad={(event) => {
                          const image = event.currentTarget;
                          const { naturalWidth: width, naturalHeight: height } = image;
                          setImageSize((current) =>
                            current.width === width && current.height === height
                              ? current
                              : { width, height },
                          );
                        }}
                      />
                    ) : null}
                  </Button>
                ) : (
                  <DeviceWaitingState
                    devices={devices}
                    device={device}
                    selected={selected}
                    loadingDevices={loadingDevices}
                    error={!!error}
                    live={live}
                    facts={(item) =>
                      `${platformVersionLabel(item)}, ${kindLabel(item)}, ${stateLabel(item)}`
                    }
                    booting={operation === "boot"}
                    bootDisabled={unavailable("boot", !device?.physical)}
                    refreshing={operation === "refresh"}
                    refreshDisabled={unavailable("refresh", !loadingDevices)}
                    onBoot={bootDevice}
                    onRefresh={refreshDevices}
                    onSetup={(anchor) => openSurface("setup", anchor)}
                    onSelect={(id, booted) => selectDevice(id, booted)}
                  />
                )}
                {highlightedNode && frame && previewInspection && imageSize.width > 0 && (
                  <div className="device-panel-node-layer" aria-hidden>
                    <svg
                      viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <rect
                        x={highlightedNode.bounds.x}
                        y={highlightedNode.bounds.y}
                        width={highlightedNode.bounds.width}
                        height={highlightedNode.bounds.height}
                      />
                    </svg>
                    <Text
                      truncate
                      size="caption"
                      tone="info"
                      leading="inherit"
                      {...surfaceAttributes(
                        { radius: "popup", variant: "card" },
                        "device-panel-node-caption",
                      )}
                    >
                      {highlightedNode.label || highlightedNode.role}
                    </Text>
                  </div>
                )}
              </div>
            </div>
            {device && (
              <ScrollArea
                axis="both"
                scrollbar="hidden"
                {...surfaceAttributes(
                  {
                    frame: "pane",
                    edge: "all",
                    radius: "pill",
                    variant: "floating",
                    elevation: "floating",
                  },
                  "device-panel-toolbar device-panel-rail",
                )}
                role="toolbar"
                aria-orientation="vertical"
                aria-label={t("Device actions")}
              >
                <div
                  {...surfaceAttributes({ separator: "pane-block" }, "device-panel-group")}
                  role="group"
                  aria-label={t("Control")}
                >
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Home")}
                    tooltipDetails={[t("Send the device to its home screen.")]}
                    loading={operation === "home"}
                    disabled={unavailable("home", canControlDevice && !annotating)}
                    disabledReason={controlReason}
                    onClick={() => action({ type: "home" })}
                  >
                    <Home className="icon-sm" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Device text input")}
                    tooltipDetails={[t("Enter text on the controlled device.")]}
                    disabled={!controlEnabled}
                    disabledReason={controlReason}
                    aria-haspopup="dialog"
                    aria-expanded={surface === "text"}
                    onClick={(event) => openSurface("text", event.currentTarget)}
                  >
                    <Keyboard className="icon-sm" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Choose app to open")}
                    tooltipDetails={[t("Open an app by name or bundle ID.")]}
                    disabled={!controlEnabled}
                    disabledReason={controlReason}
                    aria-haspopup="dialog"
                    aria-expanded={surface === "app"}
                    onClick={(event) => openSurface("app", event.currentTarget)}
                  >
                    <AppWindow className="icon-sm" aria-hidden />
                  </Button>
                </div>
                <Button
                  {...surfaceAttributes({ separator: "pane-block" })}
                  variant="ghost"
                  iconOnly
                  tooltipSide="left"
                  label={t("Inspect device screen")}
                  tooltipDetails={[
                    inspection && surface === "inspector"
                      ? t("Exit inspection and return to the device screen.")
                      : inspection
                        ? t(
                            "Native accessibility snapshot · Point at the preview to inspect. Select a node, then press it explicitly.",
                          )
                        : t(
                            "Pause live view and inspect an accessibility snapshot. Selecting a node does not press it.",
                          ),
                  ]}
                  tone="info"
                  selected={!!inspection}
                  loading={operation === "inspect"}
                  disabled={!controlEnabled || !api.inspect}
                  disabledReason={
                    !api.inspect
                      ? t("This Host does not support device inspection.")
                      : controlReason
                  }
                  onClick={(event) => {
                    setSurfaceAnchor(event.currentTarget);
                    if (inspection && surface !== "inspector") setSurface("inspector");
                    else if (inspection) {
                      setInspection(undefined);
                      setSelectedNode("");
                      setHoveredNode("");
                      setSurface(undefined);
                    } else inspectDevice();
                  }}
                >
                  <CursorMagicSelection className="icon-sm" aria-hidden />
                </Button>
                <div
                  {...surfaceAttributes({ separator: "pane-block" }, "device-panel-group")}
                  role="group"
                  aria-label={t("Mark")}
                >
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Mark device screen")}
                    tooltipDetails={[t("Pause live view and mark a captured frame.")]}
                    pressed={annotating}
                    disabled={(!frame && !streaming) || busy}
                    disabledReason={
                      !frame && !streaming
                        ? t("Marking needs a captured frame.")
                        : t("Wait for the current operation to finish")
                    }
                    onClick={beginAnnotation}
                  >
                    <Pencil className="icon-sm" aria-hidden />
                  </Button>
                  {annotating && draft && onAddImage ? (
                    <Button
                      variant="ghost"
                      iconOnly
                      tooltipSide="left"
                      label={t("Add marked image to draft")}
                      loading={operation === "addImage"}
                      disabled={unavailable("addImage")}
                      onClick={addImage}
                    >
                      <MessageSquarePlus className="icon-sm" aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <div
                  {...surfaceAttributes({ separator: "pane-block" }, "device-panel-group")}
                  role="group"
                  aria-label={t("View")}
                >
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Capture")}
                    tooltipDetails={[t("Capture one fresh frame without changing live view.")]}
                    loading={operation === "capture"}
                    disabled={unavailable("capture", canViewDevice && !annotating)}
                    disabledReason={
                      annotating ? t("Finish marking to use control and capture.") : undefined
                    }
                    onClick={refreshFrame}
                  >
                    <ImagePlus className="icon-sm" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Live view")}
                    tooltipDetails={[
                      live
                        ? t("Pause live updates and keep the current frame.")
                        : t("Resume live updates from the device."),
                    ]}
                    pressed={live}
                    disabled={!canView}
                    disabledReason={
                      busy ? t("Wait for the current operation to finish") : undefined
                    }
                    onClick={() => {
                      // Pausing keeps the picture that was on screen, not an older still.
                      const still = liveStream.snapshot();
                      if (still) setFrame(still);
                      setAnnotating(false);
                      setLive(!live);
                    }}
                  >
                    {live ? (
                      <Pause className="icon-sm" aria-hidden />
                    ) : (
                      <Play className="icon-sm" aria-hidden />
                    )}
                  </Button>
                  {optionsButton("left")}
                </div>
              </ScrollArea>
            )}
            {frame && (
              <DeviceFrameState
                frame={frame}
                shownFrame={shownFrame}
                live={live}
                streaming={streaming}
                visible={visible}
                annotating={annotating}
                frameStale={frameStale}
                captureFailed={captureFailed}
                connectionUnavailable={connectionUnavailable}
              />
            )}
            {annotating && draft && (
              <div
                {...surfaceAttributes(
                  {
                    variant: "floating",
                    frame: "pane",
                    edge: "all",
                    radius: "pill",
                    elevation: "floating",
                  },
                  "device-panel-mark-tools",
                )}
              >
                <ImageAnnotationToolbar
                  tone="surface"
                  tool={annotationTool}
                  onToolChange={setAnnotationTool}
                  disabled={busy}
                  canUndo={draft.undo.length > 0}
                  onUndo={() =>
                    updateDraft((value) => ({
                      ...value,
                      document: value.undo[value.undo.length - 1],
                      undo: value.undo.slice(0, -1),
                      redo: [...value.redo, value.document],
                    }))
                  }
                  labels={{
                    toolbar: t("Image annotation tools"),
                    box: t("Draw rectangle"),
                    arrow: t("Draw arrow"),
                    pen: t("Draw freehand"),
                    pin: t("Add numbered pin"),
                    undo: t("Undo annotation"),
                  }}
                >
                  <MediaToolbarButton
                    tone="surface"
                    label={t("Redo annotation")}
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
                    <RotateCcw className="icon-sm device-panel-redo" aria-hidden />
                  </MediaToolbarButton>
                  <MediaToolbarButton
                    tone="surface"
                    label={t("Annotation note")}
                    disabled={busy}
                    aria-haspopup="dialog"
                    aria-expanded={surface === "note"}
                    onClick={(event) => openSurface("note", event.currentTarget)}
                  >
                    <MessageSquarePlus className="icon-sm" aria-hidden />
                  </MediaToolbarButton>
                  <MediaToolbarButton
                    tone="surface"
                    label={t("Finish marking")}
                    disabled={busy}
                    onClick={() => setAnnotating(false)}
                  >
                    <Check className="icon-sm" aria-hidden />
                  </MediaToolbarButton>
                </ImageAnnotationToolbar>
              </div>
            )}
          </div>
        </>
      )}
      {visible && surface && (
        <Popover
          anchor={surfaceAnchor}
          side={surfaceAnchor?.closest(".device-panel-rail") ? "left" : "top"}
          align="end"
          width={360}
          solid
          autoFocus
          initialFocus={
            surface === "text"
              ? "textarea"
              : surface === "app" || surface === "inspector"
                ? "input"
                : undefined
          }
          ignore={surface === "inspector" ? ".device-panel-canvas" : undefined}
          onDismiss={(reason) => {
            setSurface(undefined);
            if (surface === "inspector" && reason === "escape") {
              setInspection(undefined);
              setSelectedNode("");
              setHoveredNode("");
            }
          }}
          variant="panel"
          className="device-panel-popover bycoda-arc"
          kind="dialog"
          aria-label={surfaceTitle}
        >
          <PanelHeader
            title={surfaceTitle}
            closeLabel={t("Close")}
            onClose={() => {
              setSurface(undefined);
              if (surface === "inspector") {
                setInspection(undefined);
                setSelectedNode("");
                setHoveredNode("");
              }
            }}
          />
          {surface === "menu" && (
            <DeviceOptionsMenu
              fold={
                device?.supportsFold && device.platform === "ios" && !device.physical
                  ? {
                      loading: operation === "fold",
                      disabled: !canControl || annotating,
                      disabledReason: controlReason,
                      onFold: (posture) => action({ type: "fold", posture }),
                    }
                  : undefined
              }
              inspect={{
                loading: operation === "inspect",
                disabled: unavailable("inspect", canControlDevice && !annotating && !!api.inspect),
                disabledReason: controlReason,
                onClick: inspectDevice,
              }}
              coordinates={{
                disabled: !canControlDevice || annotating,
                disabledReason: controlReason,
                onClick: () => setSurface("coordinates"),
              }}
              addDevice={
                onAddDevice && {
                  loading: operation === "add",
                  disabled: unavailable("add", !loadingDevices && !!device),
                  onClick: () => {
                    if (!device) return;
                    setDeviceNotice(undefined);
                    void execute(
                      "add",
                      () => onAddDevice(device),
                      () => setDeviceNotice({ text: t("Device added to draft."), error: false }),
                    );
                  },
                }
              }
              output={output ? () => setSurface("output") : undefined}
              zoom={zoom}
              onZoom={setZoom}
              onSetup={() => setSurface("setup")}
            />
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
              {device?.platform === "ios" ? (
                <Text as="p" size="caption" tone="secondary" leading="inherit">
                  {t(
                    "iOS: enter the app name or bundle ID. Open the app before interacting with it.",
                  )}
                </Text>
              ) : device?.platform === "android" ? (
                <Text as="p" size="caption" tone="secondary" leading="inherit">
                  {t("Android: enter Settings or an app package ID.")}
                </Text>
              ) : null}
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
                error={textError || (errorOperation === "type" ? error : undefined)}
                maxLength={4096}
                onChange={(event) => setText(event.target.value)}
              />
              {windowsAndroid && !textError ? (
                <Text as="p" size="caption" tone="secondary" leading="inherit">
                  {t("Android text input from Windows supports printable ASCII characters only.")}
                </Text>
              ) : null}
              <Button
                disabled={unavailable(
                  "type",
                  canControlDevice && !annotating && !!text && !textError,
                )}
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
              <div className="device-panel-coordinate-pair">
                <NumberField
                  label={t("Swipe end X")}
                  min={0}
                  max={20000}
                  value={endX}
                  disabled={!controlEnabled}
                  onChange={(event) => setEndX(Number(event.target.value))}
                />
                <NumberField
                  label={t("Swipe end Y")}
                  min={0}
                  max={20000}
                  value={endY}
                  disabled={!controlEnabled}
                  onChange={(event) => setEndY(Number(event.target.value))}
                />
              </div>
              <Button
                disabled={unavailable(
                  "swipe",
                  canControlDevice &&
                    !annotating &&
                    coordinatesValid &&
                    Number.isFinite(endX) &&
                    Number.isFinite(endY) &&
                    endX >= 0 &&
                    endY >= 0 &&
                    endX <= 20000 &&
                    endY <= 20000,
                )}
                loading={operation === "swipe"}
                onClick={() => action({ type: "swipe", x, y, endX, endY })}
              >
                {t("Swipe coordinates")}
              </Button>
              {device?.platform === "android" && (
                <div
                  className="device-panel-swipe-actions"
                  role="group"
                  aria-label={t("Swipe device screen")}
                >
                  {(["up", "down", "left", "right"] as const).map((direction) => (
                    <Button
                      key={direction}
                      variant="ghost"
                      disabled={!controlEnabled || !screenSize.width || captureFailed}
                      onClick={() => directionalSwipe(direction)}
                    >
                      {t(
                        {
                          up: "Swipe up",
                          down: "Swipe down",
                          left: "Swipe left",
                          right: "Swipe right",
                        }[direction],
                      )}
                    </Button>
                  ))}
                </div>
              )}
              <Text as="p" size="caption" tone="secondary" leading="inherit">
                {t(
                  "Android: click the screen to press at that pixel. iOS: use logical point coordinates from the accessibility snapshot.",
                )}
              </Text>
            </div>
          )}
          {surface === "inspector" && (
            <DeviceInspector
              inspection={inspection}
              platform={device?.platform}
              inspectionSearch={inspectionSearch}
              selectedNode={selectedNode}
              controlEnabled={controlEnabled}
              canInspect={!!api.inspect}
              loading={operation === "inspect"}
              onSearch={setInspectionSearch}
              onSelect={setSelectedNode}
              onPressNode={(inspectionId, nodeId) =>
                action({ type: "pressNode", inspectionId, nodeId })
              }
              onRefresh={inspectDevice}
            />
          )}
          {surface === "note" && draft && (
            <div className="device-panel-command">
              <TextareaField
                label={t("Annotation note")}
                value={draft.comment}
                maxLength={4000}
                disabled={busy}
                onChange={(event) =>
                  updateDraft((value) => ({
                    ...value,
                    comment: event.target.value,
                  }))
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
              {draft.transferOperation && (
                <>
                  <Text as="p" size="caption" tone="inherit" leading="inherit">
                    {t(
                      "Attachment result is unknown. Check the original attachment before adding this image again.",
                    )}
                  </Text>
                  <Button
                    loading={operation === "addImage"}
                    disabled={unavailable("addImage")}
                    onClick={() => {
                      const attachment = draft.transferOperation!;
                      void execute(
                        "addImage",
                        () => reconcileDeviceImageTransfer(attachment),
                        () => {
                          updateDraft((value) => ({
                            ...value,
                            transferOperation: undefined,
                          }));
                          setDeviceNotice({
                            text: t(
                              "Original image attachment confirmed. Your edited draft is kept.",
                            ),
                            error: false,
                          });
                        },
                      ).catch(showActionError);
                    }}
                  >
                    {t("Check attachment")}
                  </Button>
                </>
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
                disabled={busy || !!draft.transferOperation}
                disabledReason={
                  draft.transferOperation
                    ? t("Check the original attachment before discarding this draft.")
                    : undefined
                }
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
          {surface === "output" && (
            <OutputBlock
              size="micro"
              tone="primary"
              leading="inherit"
              className="device-panel-output"
            >
              {output}
            </OutputBlock>
          )}
          {surface === "setup" && status && (
            <DeviceSetupPanel
              status={status}
              hostLabel={hostLabel}
              machinePicker={machinePicker}
              unknown={connectionUnavailable || discoveryUnavailable}
              deviceCount={
                devicesLoaded && !loadingDevices && !discoveryUnavailable
                  ? devices.length
                  : undefined
              }
              showLastError={!error}
              refresh={{
                loading: operation === "status",
                disabled: unavailable("status", !loadingDevices),
                onClick: () => void execute("status", api.status, setStatus),
              }}
              setup={{
                loading: operation === "setup",
                disabled: unavailable("setup", sdkAvailable),
                onClick: () => void execute("setup", () => api.setup(control), setStatus),
              }}
              start={{
                loading: operation === "start",
                disabled: unavailable("start", status.installed && !status.running),
                onClick: () => void execute("start", api.start, setStatus),
              }}
              stop={{
                loading: operation === "stop",
                disabled: unavailable("stop", status.running),
                onClick: () => {
                  setLive(false);
                  void execute("stop", api.stop, (value) => {
                    setStatus(value);
                    setFrame(undefined);
                    setSelected("");
                    setApp("");
                    setDevices([]);
                    setOutput("");
                  });
                },
              }}
            />
          )}
        </Popover>
      )}
    </section>
  );
}
