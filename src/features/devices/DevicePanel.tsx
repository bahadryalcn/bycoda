import type { CSSProperties } from "react";
import { EmptyState } from "../../shared/ui/EmptyState";
import { Tooltip } from "../../shared/ui/Tooltip";
import { surfaceAttributes } from "../../shared/ui/Surface";
import { OutputBlock } from "../../shared/ui/OutputBlock";
import { Text } from "../../shared/ui/Text";
import { ScrollArea } from "../../shared/ui/ScrollArea";
import { NumberField } from "../../shared/ui/NumberField";
import { DeviceBar } from "./ui/DeviceBar";
import { DeviceSetupPanel } from "./ui/DeviceSetupPanel";
import { DeviceConnectState, DeviceWaitingState } from "./ui/DeviceStageStates";
import { DeviceOptionsMenu } from "./ui/DeviceOptionsMenu";
import { useDeviceStatus } from "./hooks/useDeviceStatus";
import { useDeviceLiveStream } from "./hooks/useDeviceLiveStream";
import { kindLabel, platformVersionLabel, stateLabel } from "./model/deviceLabels";
import {
  peekToolsDraftPart,
  subscribeToolsDraftTransfer,
  writeToolsDraftPart,
  holdToolsDraftTransfer,
  type ToolsDraftScope,
} from "../host-tools/toolsDraftTransfer";
import { TextField } from "../../shared/ui/TextField";
import { TextareaField } from "../../shared/ui/TextareaField";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as technicalI18n from "../../shared/i18n/technical";
import { Alert } from "../../shared/ui/Alert";
import { InlineMessage } from "../../shared/ui/InlineError";
import { LoadingText } from "../../shared/ui/LoadingText";
import { Button } from "../../shared/ui/Button";
import { Disclosure } from "../../shared/ui/Disclosure";
import { Progress } from "../../shared/ui/Progress";
import { Popover } from "../../shared/ui/Popover";
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
  Eye,
  Home,
  ImagePlus,
  Keyboard,
  Lock,
  MessageSquarePlus,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
  X,
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
const { dateTimeFormat, getLocale, relativeTimeFormat, t, useLocale } = technicalI18n;
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
  | "claim"
  | "release"
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
const annotationDraftCache = new Map<string, Record<string, AnnotationDraft>>();
type DeviceInputs = Record<string, { app: string; text: string }>;
const inputDraftCache = new Map<string, DeviceInputs>();
/** Readable capture time and age for a retained frame; undefined when the Host sent no real timestamp. */
function capturedLabel(capturedAt: string, now: number): string | undefined {
  const at = Date.parse(capturedAt);
  if (!Number.isFinite(at)) return undefined;
  let locale: string | undefined;
  try {
    locale = getLocale();
    dateTimeFormat(locale);
  } catch {
    locale = undefined;
  }
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const relative = relativeTimeFormat(locale, {
    numeric: "auto",
    style: "short",
  });
  const age =
    seconds < 2
      ? relative.format(0, "second")
      : seconds < 60
        ? relative.format(-seconds, "second")
        : seconds < 3600
          ? relative.format(-Math.round(seconds / 60), "minute")
          : relative.format(-Math.round(seconds / 3600), "hour");
  const time = new Date(at).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return t("Captured {p0} · {p1}", { p0: time, p1: age });
}
const unavailableTransport = (cause: unknown) =>
  /RPC_HOST_UNAVAILABLE|host unavailable|host connection.*(?:closed|refused)/i.test(String(cause));

type DevicePanelProps = {
  transferScope?: ToolsDraftScope;
  active?: boolean;
  api: DevicePanelApi;
  hostLabel?: string;
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

/** RPC only: opening this panel starts viewing; control remains opt-in. */
export function DevicePanel(props: DevicePanelProps) {
  // A new Host API (conversation or machine switch) starts a fresh surface.
  return <DevicePanelSurface key={apiKeyFor(props.api)} {...props} />;
}

function DevicePanelSurface({
  active: visible = true,
  api,
  hostLabel,
  onAddDevice,
  onAddImage,
  draftScope,
  transferScope,
}: DevicePanelProps) {
  useLocale();
  const ownershipDescriptionId = useId();
  const saved = transferScope ? peekToolsDraftPart(transferScope, "device") : undefined;
  const [status, setStatus] = useState<DeviceHostStatus>();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selected, setSelected] = useState(saved?.selected ?? "");
  const [frame, setFrame] = useState<DeviceFrame | undefined>(
    saved?.annotations[saved.selected]?.frame,
  );
  function readableDeviceError(error: string): string | undefined {
    if (/DEVICE_CONTROL_BUSY/.test(error)) return t("Device control held by another controller");
    if (/DEVICE_CONTROL_LEASE_INVALID/.test(error))
      return t("Device control expired. Claim control again to send input.");
    if (/DEVICE_INSPECTION_STALE/.test(error))
      return t("The device screen changed. Refresh inspection before selecting a node.");
    if (/DEVICE_INSPECTION_UNSUPPORTED/.test(error))
      return t("This device does not provide a structured accessibility tree.");
    return undefined;
  }
  const [connectionUnavailable, setConnectionUnavailable] = useState(false);
  const [discoveryUnavailable, setDiscoveryUnavailable] = useState(false);
  const [live, setLive] = useState(false);
  // The surface starts by reading the Host status in the effect below.
  const [busy, setBusy] = useState(true);
  const [operation, setOperation] = useState<DeviceOperation>();
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string | undefined>(saved?.error);
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
  const [now, setNow] = useState(() => Date.now());
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
  const [zoom, setZoom] = useState(saved?.zoom ?? 1);
  const [annotations, setAnnotationState] = useState<Record<string, AnnotationDraft>>(
    () => saved?.annotations ?? (draftScope ? (annotationDraftCache.get(draftScope) ?? {}) : {}),
  );
  const annotationsRef = useRef(annotations);
  useEffect(() => {
    if (!transferScope) return;
    return subscribeToolsDraftTransfer(transferScope, ({ device }) => {
      if (!device) return;
      setSelected(device.selected);
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
    if (draftScope) {
      annotationDraftCache.delete(draftScope);
      if (Object.keys(next).length) annotationDraftCache.set(draftScope, next);
    }
    setAnnotationState(next);
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
  const pendingDone = useRef<Promise<void>>(Promise.resolve());
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
  useDeviceStatus(api, visible, setStatus, setError, setBusy);
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
        // A live capture must finish before boot/stop/input or another capture.
        await capturePending.current?.catch(() => {});
        if (!current()) return;
        const value = await work(current);
        if (current()) commit(value);
      } catch (cause) {
        if (current()) {
          setError(String(cause));
          if (name === "status") setStatus(undefined);
          if (name === "refresh") setDiscoveryUnavailable(true);
          if (/DEVICE_CONTROL_BUSY/.test(String(cause)) && name === "claim")
            setControlStatus({ deviceId: selectedRef.current, busy: true });
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
      setLive(booted);
      setControl(false);
      setControlStatus(undefined);
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
      setDiscoveryUnavailable(value.errors.length > 0);
      setDevices(value.devices);
      if (!retainedOutcome.current) {
        setErrorOperation("refresh");
        setError(value.errors.length ? value.errors.join("\n") : undefined);
      }
      const current = value.devices.find((device) => device.id === selectedRef.current);
      if (!current) {
        if (selectedRef.current && transferScope && peekToolsDraftPart(transferScope, "device"))
          return;
        // Prefer a connected phone. Opening the panel starts viewing, never input or boot.
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
    if (!status?.running) {
      setLoadingDevices(false);
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
            setError(String(cause));
          }
        },
      )
      .finally(() => {
        if (active) setLoadingDevices(false);
      });
    return () => {
      active = false;
    };
  }, [api, status?.running, applyDevices, visible]);
  // Video when the Host can stream this device; the still captures below are the fallback.
  const liveStream = useDeviceLiveStream({
    stream: api.stream,
    deviceId: selected,
    enabled: visible && live && !!selected && !!status?.running,
    onFrame: useCallback((value: DeviceFrame, deviceId: string) => {
      if (selectedRef.current !== deviceId) return;
      setFrame(value);
      setFrameStale(false);
      setActionCompleted(false);
      if (errorOperationRef.current === "capture") setError(undefined);
    }, []),
  });
  const streaming = liveStream.active;
  useEffect(() => {
    if (!visible || !live || !selected || !status?.running || streaming) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      if (cancelled) return;
      const started = performance.now();
      if (!document.hidden && !pending.current && !capturePending.current) {
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
            setError(String(cause));
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
            : Math.max(100, 250 - (performance.now() - started)),
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
          throw new Error(t("Claim device control before sending input."));
        setInspection(undefined);
        setSelectedNode("");
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
  const device = devices.find((item) => item.id === selected);
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
        setDeviceNotice({
          text: t("Device control expired. Claim control again to send input."),
          error: false,
        });
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
  useEffect(() => {
    if (!visible) {
      if (controlLeaseRef.current) delete claimRequests.current[controlLeaseRef.current.deviceId];
      setControl(false);
      setControlLease(undefined);
      setInspection(undefined);
    }
  }, [visible]);
  useEffect(() => {
    if (!visible || !selected || status?.controlProtocol !== 1 || !api.controlStatus) return;
    let current = true;
    let reading = false;
    const refresh = () => {
      if (document.hidden || pending.current || reading) return;
      reading = true;
      const leaseAtRead = controlLeaseRef.current;
      void api.controlStatus!(selected)
        .then(
          (value) => {
            if (!current) return;
            setControlStatus(value);
            if (controlLeaseRef.current === leaseAtRead) {
              if (!value.busy) {
                setControl(false);
                setControlLease(undefined);
                delete claimRequests.current[selected];
              } else if (leaseAtRead && leaseAtRead.expiresAt > Date.now()) setControl(true);
            }
          },
          () => {
            if (current) {
              setControl(false);
              setControlStatus(undefined);
            }
          },
        )
        .finally(() => {
          reading = false;
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [api, selected, visible, status?.controlProtocol]);
  const canViewDevice = !!device?.booted && !loadingDevices;
  const ownershipSupported =
    status?.controlProtocol === 1 && !!api.claimControl && !!api.releaseControl;
  const canControlDevice =
    canViewDevice &&
    ownershipSupported &&
    control &&
    !!controlLease?.leaseId &&
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
    const current = liveStream.snapshot() ?? frame;
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
  const node = inspection?.nodes.find((value) => value.id === selectedNode);
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
  const filteredNodes =
    inspection?.nodes.filter((value) =>
      `${value.label} ${value.role} ${value.id}`
        .toLocaleLowerCase()
        .includes(inspectionSearch.toLocaleLowerCase()),
    ) ?? [];
  const directionalSwipe = (direction: "up" | "down" | "left" | "right") => {
    if (!imageSize.width || !imageSize.height) return;
    const width = imageSize.width - 1,
      height = imageSize.height - 1;
    const starts = {
      up: [0.5, 0.75, 0.5, 0.25],
      down: [0.5, 0.25, 0.5, 0.75],
      left: [0.75, 0.5, 0.25, 0.5],
      right: [0.25, 0.5, 0.75, 0.5],
    } as const;
    const [x, y, endX, endY] = starts[direction];
    action({
      type: "swipe",
      x: Math.round(x * width),
      y: Math.round(y * height),
      endX: Math.round(endX * width),
      endY: Math.round(endY * height),
    });
  };
  const captureFailed = !!error && errorOperation === "capture";
  const bootDevice = () =>
    void execute(
      "boot",
      () => api.boot(selected),
      (value) => {
        setSelected(value.id);
        setLive(value.booted);
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
  const liveFrameDelayed =
    !!frame &&
    live &&
    !streaming &&
    Number.isFinite(Date.parse(frame.capturedAt)) &&
    now - Date.parse(frame.capturedAt) >= 3000;
  const frameStateVisible =
    !!frame &&
    (!live ||
      annotating ||
      frameStale ||
      captureFailed ||
      connectionUnavailable ||
      liveFrameDelayed);
  useEffect(() => {
    if (!visible || !frame || streaming) return;
    setNow(Date.now());
    const timer = setInterval(
      () => {
        if (!document.hidden) setNow(Date.now());
      },
      live ? 1000 : 5000,
    );
    return () => clearInterval(timer);
  }, [!!frame, live, visible, streaming]);
  const frameCaptured = shownFrame ? capturedLabel(shownFrame.capturedAt, now) : undefined;
  const ownershipLabel = control
    ? t("Device control claimed by this controller")
    : controlStatus?.busy
      ? t("Device control held by another controller")
      : t("Viewing only · Device control not claimed");
  const toolbarReason = connectionUnavailable
    ? t("The device connection is unavailable. Refresh devices to reconnect.")
    : undefined;
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
      {error && (
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
      {!status && !error && (
        <LoadingText size="caption" leading="inherit" className="px-4 py-5">
          {t("Checking device support…")}
        </LoadingText>
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
          {actionCompleted && (
            <Alert
              inline
              tone="warning"
              title={t("Action completed")}
              action={
                <Button
                  loading={operation === "capture"}
                  disabled={unavailable("capture", canViewDevice && !annotating)}
                  onClick={refreshFrame}
                >
                  {t("Refresh frame")}
                </Button>
              }
            >
              {t("The screen could not be refreshed. Refresh the frame; do not repeat the action.")}
            </Alert>
          )}
          {toolbarReason && (
            <Text
              as="p"
              size="caption"
              tone="secondary"
              leading="inherit"
              {...surfaceAttributes({ frame: "pane", edge: "block-end" }, "device-panel-reason")}
            >
              {toolbarReason}
            </Text>
          )}
          {control && !status.agentInstalled && (
            <Text
              as="div"
              size="caption"
              tone="inherit"
              leading="inherit"
              {...surfaceAttributes(
                { frame: "pane", edge: "block-end" },
                "device-panel-setup-control",
              )}
            >
              <span>{t("Run setup with control enabled to install the control tools.")}</span>
              <Button
                variant="primary"
                loading={operation === "setupControl"}
                disabled={unavailable("setupControl", sdkAvailable)}
                onClick={() => void execute("setupControl", () => api.setup(true), setStatus)}
              >
                {t("Set up device control")}
              </Button>
            </Text>
          )}
          {operation === "press" || operation === "swipe" ? (
            <Progress compact tone="neutral" aria-label={t("Working on the host…")} />
          ) : null}
          {deviceNotice && (
            <InlineMessage
              tone={deviceNotice.error ? "danger" : "info"}
              className="shrink-0"
              action={
                <Button
                  variant="ghost"
                  iconOnly
                  label={t("Dismiss")}
                  onClick={() => setDeviceNotice(undefined)}
                >
                  <X className="icon-sm" aria-hidden />
                </Button>
              }
            >
              {readableDeviceError(deviceNotice.text) ?? deviceNotice.text}
            </InlineMessage>
          )}
          <div
            {...surfaceAttributes({ variant: "canvas-surface" }, "device-panel-stage")}
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
                ) : frame ? (
                  <Button
                    variant="ghost"
                    motion="none"
                    layout="media"
                    className="device-panel-preview-control"
                    aria-disabled={!controlEnabled && !previewInspection}
                    label={t(
                      "Device screen. Use arrow keys to swipe; use coordinate controls to press.",
                    )}
                    onClick={(event) => {
                      if (
                        event.detail === 0 &&
                        controlEnabled &&
                        !inspection &&
                        device?.platform === "android" &&
                        imageSize.width &&
                        imageSize.height
                      )
                        action({
                          type: "press",
                          x: Math.round(imageSize.width / 2),
                          y: Math.round(imageSize.height / 2),
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
                      if (!controlEnabled || device?.platform !== "android" || captureFailed)
                        return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (!imageSize.width || !imageSize.height) return;
                        action({
                          type: "press",
                          x: Math.round(imageSize.width / 2),
                          y: Math.round(imageSize.height / 2),
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
                      const image = event.currentTarget.querySelector("img");
                      if (!image) return;
                      const imageBounds = image.getBoundingClientRect();
                      if (
                        event.clientX < imageBounds.left ||
                        event.clientX > imageBounds.right ||
                        event.clientY < imageBounds.top ||
                        event.clientY > imageBounds.bottom
                      )
                        return;
                      if (inspection) {
                        gesture.current = null;
                        if (event.button === 0) {
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
                        captureFailed
                      )
                        return;
                      const bounds = image.getBoundingClientRect();
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
                      if (inspection) {
                        gesture.current = null;
                        return;
                      }
                      const start = gesture.current;
                      gesture.current = null;
                      if (
                        !start ||
                        start.pointerId !== event.pointerId ||
                        !controlEnabled ||
                        captureFailed
                      )
                        return;
                      const image = event.currentTarget.querySelector("img");
                      if (!image) return;
                      const bounds = image.getBoundingClientRect();
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
                      else
                        action({
                          type: "swipe",
                          x: start.x,
                          y: start.y,
                          endX: x,
                          endY: y,
                        });
                    }}
                    onPointerCancel={() => {
                      gesture.current = null;
                    }}
                    onPointerMove={(event) => {
                      const image = event.currentTarget.querySelector("img");
                      if (!image) return;
                      if (previewInspection)
                        setHoveredNode(pointNode(image, event.clientX, event.clientY)?.id ?? "");
                    }}
                    onPointerLeave={() => setHoveredNode("")}
                  >
                    <img
                      key={inspection?.inspectionId ?? "device-live-frame"}
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
                        setImageSize({
                          width: image.naturalWidth,
                          height: image.naturalHeight,
                        });
                        if (image.naturalHeight)
                          image.style.setProperty(
                            "--device-aspect",
                            String(image.naturalWidth / image.naturalHeight),
                          );
                      }}
                    />
                    {streaming && !inspection && (
                      <canvas
                        ref={liveStream.canvasRef}
                        className="device-panel-live"
                        aria-hidden
                      />
                    )}
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
                      `${platformVersionLabel(item)} · ${kindLabel(item)} · ${stateLabel(item)}`
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
                        { radius: "popup", variant: "raised" },
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
                    label={t("Allow device control")}
                    tooltip={control ? t("Release device control") : t("Claim device control")}
                    tooltipDetails={[ownershipLabel]}
                    aria-describedby={ownershipDescriptionId}
                    tone={control ? "success" : controlStatus?.busy ? "warning" : "info"}
                    role="switch"
                    aria-checked={control}
                    selected={control && !annotating}
                    loading={operation === "claim" || operation === "release"}
                    disabled={busy || !device?.booted || !ownershipSupported}
                    disabledReason={
                      !ownershipSupported
                        ? t(
                            "This Host does not support device control ownership. Update the Host to control this device.",
                          )
                        : undefined
                    }
                    onClick={() => {
                      setAnnotating(false);
                      if (annotating && control) return;
                      if (control && controlLease?.leaseId && api.releaseControl) {
                        void execute(
                          "release",
                          () => api.releaseControl!(selected, controlLease.leaseId),
                          () => {
                            setControlStatus({
                              deviceId: selected,
                              busy: false,
                            });
                            setControl(false);
                            setControlLease(undefined);
                            delete claimRequests.current[selected];
                            setInspection(undefined);
                          },
                        ).catch((cause: unknown) => setError(String(cause)));
                      } else if (api.claimControl) {
                        claimRequests.current[selected] ??= crypto.randomUUID();
                        void execute(
                          "claim",
                          () => api.claimControl!(selected, claimRequests.current[selected]),
                          (value) => {
                            setControlLease(value);
                            setControlStatus({
                              deviceId: value.deviceId,
                              busy: true,
                            });
                            setControl(!!value.leaseId);
                          },
                        ).catch((cause: unknown) => setError(String(cause)));
                      }
                    }}
                  >
                    {control ? (
                      <CursorMagicSelection className="icon-sm" aria-hidden />
                    ) : controlStatus?.busy ? (
                      <Lock className="icon-sm" aria-hidden />
                    ) : (
                      <Eye className="icon-sm" aria-hidden />
                    )}
                  </Button>
                  <span id={ownershipDescriptionId} className="sr-only">
                    {ownershipLabel}
                  </span>
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Home")}
                    loading={operation === "home"}
                    disabled={unavailable("home", canControlDevice && !annotating)}
                    onClick={() => action({ type: "home" })}
                  >
                    <Home className="icon-sm" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Device text input")}
                    disabled={!controlEnabled}
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
                    disabled={!controlEnabled}
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
                  tone="info"
                  selected={!!inspection}
                  loading={operation === "inspect"}
                  disabled={!controlEnabled || !api.inspect}
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
                    selected={annotating}
                    aria-pressed={annotating}
                    disabled={!frame || busy}
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
                    loading={operation === "capture"}
                    disabled={unavailable("capture", canViewDevice && !annotating)}
                    onClick={refreshFrame}
                  >
                    <ImagePlus className="icon-sm" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    iconOnly
                    tooltipSide="left"
                    label={t("Live view")}
                    role="switch"
                    aria-checked={live}
                    disabled={!canView}
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
            {frameStateVisible && (
              <Tooltip label={shownFrame?.capturedAt} asChild>
                <Text
                  truncate
                  size="micro"
                  tone="primary"
                  leading="inherit"
                  {...surfaceAttributes(
                    { variant: "floating", frame: "pane", radius: "pill", elevation: "floating" },
                    "device-panel-frame-state",
                  )}
                >
                  {annotating
                    ? t("Marking · Frozen frame")
                    : captureFailed || connectionUnavailable || frameStale
                      ? t("Last frame · Not live")
                      : liveFrameDelayed
                        ? t("Last frame · Refreshing")
                        : t("Paused")}
                  {frameCaptured ? ` · ${frameCaptured}` : ""}
                </Text>
              </Tooltip>
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
      {surface && (
        <Popover
          anchor={surfaceAnchor}
          side={surfaceAnchor?.closest(".device-panel-rail") ? "left" : "top"}
          align="end"
          width={360}
          solid
          autoFocus
          ignore={surface === "inspector" ? ".device-panel-canvas" : undefined}
          onDismiss={(reason) => {
            setSurface(undefined);
            if (surface === "inspector" && reason === "escape") {
              setInspection(undefined);
              setSelectedNode("");
              setHoveredNode("");
            }
          }}
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
              inspector: "Device accessibility inspector",
            }[surface],
          )}
        >
          {surface === "menu" && (
            <DeviceOptionsMenu
              inspect={{
                loading: operation === "inspect",
                disabled: unavailable("inspect", canControlDevice && !annotating && !!api.inspect),
                onClick: inspectDevice,
              }}
              coordinates={{
                disabled: !canControlDevice || annotating,
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
                <Text
                  as="p"
                  size="caption"
                  tone="inherit"
                  leading="inherit"
                  className="host-tool-muted"
                >
                  {t(
                    "iOS: enter the app name or bundle ID. Open the app before interacting with it.",
                  )}
                </Text>
              ) : device?.platform === "android" ? (
                <Text
                  as="p"
                  size="caption"
                  tone="inherit"
                  leading="inherit"
                  className="host-tool-muted"
                >
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
                <Text
                  as="p"
                  size="caption"
                  tone="inherit"
                  leading="inherit"
                  className="host-tool-muted"
                >
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
                      disabled={!controlEnabled || !imageSize.width || captureFailed}
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
              <Text
                as="p"
                size="caption"
                tone="inherit"
                leading="inherit"
                className="host-tool-muted"
              >
                {t(
                  "Android: click the screen to press at that pixel. iOS: use logical point coordinates from the accessibility snapshot.",
                )}
              </Text>
            </div>
          )}
          {surface === "inspector" && (
            <div className="device-panel-inspector">
              <TextField
                label={t("Search accessibility nodes")}
                value={inspectionSearch}
                onChange={(event) => setInspectionSearch(event.target.value)}
              />
              <p className="host-tool-muted">
                {device?.platform === "android"
                  ? t(
                      "Native accessibility snapshot · Point at the preview to inspect. Select a node, then press it explicitly.",
                    )
                  : t(
                      "Native accessibility snapshot · Preview bounds unavailable for this coordinate space.",
                    )}
              </p>
              {!inspection || inspection.supported === false ? (
                <p>{t("This device does not provide a structured accessibility tree.")}</p>
              ) : (
                <div
                  {...surfaceAttributes({ frame: "stroke", edge: "block" }, "device-panel-nodes")}
                  aria-label={t("Accessibility nodes")}
                >
                  {filteredNodes.length ? (
                    filteredNodes.slice(0, 500).map((value, index) => (
                      <Button
                        key={value.id}
                        variant="item"
                        selected={selectedNode === value.id}
                        aria-pressed={selectedNode === value.id}
                        onClick={() => setSelectedNode(value.id)}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                          event.preventDefault();
                          const next =
                            filteredNodes[
                              Math.max(
                                0,
                                Math.min(
                                  499,
                                  filteredNodes.length - 1,
                                  index + (event.key === "ArrowDown" ? 1 : -1),
                                ),
                              )
                            ];
                          if (next) {
                            setSelectedNode(next.id);
                            const buttons =
                              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                "button",
                              );
                            buttons?.[filteredNodes.indexOf(next)]?.focus();
                          }
                        }}
                      >
                        <span className="device-panel-node-label">
                          {value.label || value.role || value.id}
                          <Text
                            size="micro"
                            tone="secondary"
                            leading="inherit"
                            className="device-panel-node-role"
                          >
                            {value.role} · {value.id}
                          </Text>
                        </span>
                      </Button>
                    ))
                  ) : (
                    <EmptyState
                      size="inline"
                      kind="filtered"
                      description={t("No matching accessibility nodes")}
                    />
                  )}
                </div>
              )}
              {node && (
                <Text
                  as="div"
                  size="caption"
                  tone="inherit"
                  leading="inherit"
                  className="device-panel-node-detail"
                >
                  <strong>{node.label || node.role}</strong>
                  <span>
                    {node.role} · {node.enabled ? t("Enabled") : t("Disabled")}
                  </span>
                  <span>
                    {t("Bounds")}: {node.bounds.x}, {node.bounds.y} · {node.bounds.width} ×{" "}
                    {node.bounds.height}
                  </span>
                  <Button
                    disabled={!controlEnabled || !node.enabled || !node.clickable}
                    onClick={() => {
                      action({
                        type: "pressNode",
                        inspectionId: inspection!.inspectionId,
                        nodeId: node.id,
                      });
                    }}
                  >
                    {t("Press selected node")}
                  </Button>
                </Text>
              )}
              <Button
                variant="ghost"
                loading={operation === "inspect"}
                disabled={!controlEnabled || !api.inspect}
                onClick={inspectDevice}
              >
                {t("Refresh inspection")}
              </Button>
              {inspection?.raw && (
                <Disclosure size="sm" summary={t("Raw accessibility output")}>
                  <OutputBlock
                    size="micro"
                    tone="primary"
                    leading="inherit"
                    className="device-panel-output"
                  >
                    {inspection.raw}
                  </OutputBlock>
                </Disclosure>
              )}
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
                      ).catch((cause: unknown) => setError(String(cause)));
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
              unknown={connectionUnavailable || discoveryUnavailable}
              deviceCount={devices.length}
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
