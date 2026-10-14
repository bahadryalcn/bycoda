import { t, useLocale } from "../../shared/i18n/technical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect } from "../../shared/ui/SearchableSelect";
import { Button } from "../../shared/ui/arc/button/button";
import { Switch } from "../../shared/ui/arc/switch/switch";
import { ImagePlus, Plus, RefreshCw } from "../../shared/ui/icons";
import "./DevicePanel.css";
import type {
  DeviceAction,
  DeviceFrame,
  DeviceHostStatus,
  DevicePanelApi,
  DeviceSummary,
} from "./types";

/** RPC only: opening this panel starts viewing; control remains opt-in. */
export function DevicePanel({
  api,
  hostLabel,
  onAddDevice,
}: {
  api: DevicePanelApi;
  hostLabel?: string;
  onAddDevice?: (device: DeviceSummary) => Promise<void>;
}) {
  useLocale();
  const [status, setStatus] = useState<DeviceHostStatus>();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [frame, setFrame] = useState<DeviceFrame>();
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [error, setError] = useState<string>();
  const [control, setControl] = useState(false);
  const [app, setApp] = useState("");
  const [text, setText] = useState("");
  const [output, setOutput] = useState("");
  const [deviceNotice, setDeviceNotice] = useState<{ text: string; error: boolean }>();
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
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
    setLoadingDevices(false);
    setError(undefined);
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
    async <T,>(operation: (isCurrent: () => boolean) => Promise<T>, commit: (value: T) => void) => {
      if (pending.current) return;
      const token = {};
      const requestScope = scope;
      pending.current = token;
      const current = () => mounted.current && currentScope.current === requestScope;
      setBusy(true);
      setError(undefined);
      try {
        // A live capture must finish before boot/stop/input or another capture.
        await capturePending.current?.catch(() => {});
        if (!current()) return;
        const value = await operation(current);
        if (current()) commit(value);
      } catch (cause) {
        if (current()) setError(String(cause));
      } finally {
        if (current() && pending.current === token) {
          pending.current = null;
          setBusy(false);
        }
      }
    },
    [scope],
  );
  const capture = useCallback(
    (deviceId: string) => {
      const operation = api.capture(deviceId);
      capturePending.current = operation;
      void operation
        .finally(() => {
          if (capturePending.current === operation) capturePending.current = null;
        })
        .catch(() => {});
      return operation;
    },
    [api],
  );
  const selectDevice = useCallback((deviceId: string, booted = false) => {
    setSelected(deviceId);
    setApp("");
    setFrame(undefined);
    setLive(booted);
    setControl(false);
    setText("");
    setOutput("");
    setDeviceNotice(undefined);
  }, []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const applyDevices = useCallback(
    (value: Awaited<ReturnType<DevicePanelApi["list"]>>) => {
      setDevices(value.devices);
      setError(value.errors.length ? value.errors.join("\n") : undefined);
      const current = value.devices.find((device) => device.id === selectedRef.current);
      if (!current) {
        // Prefer a connected phone. Opening the panel starts viewing, never input or boot.
        const preferred =
          value.devices.find((device) => device.booted && device.physical) ??
          value.devices.find((device) => device.booted) ??
          value.devices[0];
        selectDevice(preferred?.id ?? "", !!preferred?.booted);
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
          if (!cancelled) setFrame(value);
        } catch (cause) {
          if (!cancelled) {
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
        if (value.error) setError(value.error);
      },
    );
  const device = devices.find((item) => item.id === selected);
  const canView = !!device?.booted && !busy && !loadingDevices;
  const canControl = canView && control && !!status?.agentInstalled;
  const windowsAndroid = status?.platform === "win32" && device?.platform === "android";
  const coordinatesValid =
    Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= 20000 && y <= 20000;
  return (
    <section
      className="host-tool-panel device-panel bycoda-arc"
      aria-label={t("Devices")}
      aria-busy={busy || loadingDevices}
    >
      {error && (
        <div role="alert" className="device-panel-error">
          <strong>{t("Could not load devices")}</strong>
          <p>
            {status?.running
              ? t(
                  "Reconnect the device, unlock its screen, and allow USB debugging if prompted. Then refresh devices.",
                )
              : t("Check that the selected computer is connected, then retry.")}
          </p>
          <details>
            <summary>{t("Details")}</summary>
            <pre>{error}</pre>
          </details>
        </div>
      )}
      {!status && !error && <p role="status">{t("Checking device support…")}</p>}
      {!status && error && (
        <button type="button" disabled={busy} onClick={() => void execute(api.status, setStatus)}>
          {t("Retry")}
        </button>
      )}
      {status && (
        <>
          {!status.running && (
            <div className="host-tool-toolbar">
              <span className="host-tool-status">
                {status.running
                  ? t("Device host running")
                  : status.installed
                    ? t("Device host stopped")
                    : t("Setup required")}
              </span>
              <span className="host-tool-muted">
                {loadingDevices
                  ? t("Loading devices…")
                  : t("{p0} devices found", { p0: devices.length })}
              </span>
              <button
                type="button"
                disabled={busy || loadingDevices || !status.running}
                onClick={() => void execute(api.list, applyDevices)}
              >
                {t("Refresh devices")}
              </button>
            </div>
          )}
          {control && !status.agentInstalled ? (
            <div className="host-tool-card host-tool-section">
              {t("Run setup with control enabled to install the control tools.")}
              <button
                type="button"
                className="host-tool-primary"
                disabled={busy || !status.platforms.some((item) => item.available)}
                onClick={() => void execute(() => api.setup(true), setStatus)}
              >
                {t("Set up device control")}
              </button>
            </div>
          ) : null}
          {!status.running ? (
            <div className="host-tool-card host-tool-section">
              <p>{status.installed ? t("Start device host") : t("Set up device tools")}</p>
              <p className="host-tool-muted">
                {t(
                  "Connect an Android phone with USB debugging, or use an emulator. iOS simulators require a Mac with Xcode.",
                )}
              </p>
              <button
                type="button"
                className="host-tool-primary"
                disabled={busy || !status.platforms.some((item) => item.available)}
                onClick={() =>
                  void execute(async (isCurrent) => {
                    if (!status.installed) await api.setup(false);
                    return isCurrent() ? api.start() : status;
                  }, setStatus)
                }
              >
                {status.installed ? t("Connect devices") : t("Set up and connect")}
              </button>
            </div>
          ) : null}
          <details className="host-tool-help device-panel-setup">
            <summary>{t("Setup and access")}</summary>
            <div className="host-tool-section">
              <p>
                {t("Devices")}
                {hostLabel ? ` · ${hostLabel}` : ""}
              </p>
              <p>{t("{p0} devices found", { p0: devices.length })}</p>
              <p>{status.running ? t("Device host running") : t("Device host stopped")}</p>
              <div className="host-tool-toolbar">
                {status.platforms.map((item) => (
                  <span className="host-tool-muted" key={item.platform}>
                    {item.platform === "ios" ? t("iOS") : t("Android")}:{" "}
                    {item.available ? t("SDK detected") : item.reason}
                  </span>
                ))}
              </div>
              {status.lastError && !error ? (
                <pre className="device-panel-output">{status.lastError}</pre>
              ) : null}
              <div className="host-tool-toolbar">
                <button
                  type="button"
                  disabled={busy || loadingDevices}
                  onClick={() => void execute(api.status, setStatus)}
                >
                  {t("Status")}
                </button>
                <button
                  type="button"
                  disabled={busy || !status.platforms.some((item) => item.available)}
                  onClick={() => void execute(() => api.setup(control), setStatus)}
                >
                  {status.installed ? t("Update setup") : t("Set up device tools")}
                </button>
                <button
                  type="button"
                  disabled={busy || !status.installed || status.running}
                  onClick={() =>
                    void execute(api.start, (value) => {
                      setStatus(value);
                    })
                  }
                >
                  {t("Start device host")}
                </button>
                <button
                  type="button"
                  disabled={busy || !status.running}
                  onClick={() => {
                    setLive(false);
                    void execute(api.stop, (value) => {
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
                </button>
              </div>
              <p>
                {t(
                  "Viewing does not enable control. Live view updates once per second while this panel is visible. Closing the panel pauses viewing.",
                )}
              </p>
              <p>
                {t(
                  "Setup downloads pinned expo-device-hub 0.12.0 and optional control tools into the host cache. Closing this panel pauses viewing; Stop ends the owned tool processes.",
                )}
              </p>
            </div>
          </details>
        </>
      )}
      {status?.running && (
        <>
          {loadingDevices ? (
            <p role="status">{t("Loading devices…")}</p>
          ) : !devices.length ? (
            <p className="host-tool-empty">
              {t(
                "No devices found. Connect an Android phone with USB debugging enabled, or create an emulator or simulator, then refresh.",
              )}
            </p>
          ) : null}
          {devices.length ? (
            <div className="device-panel-selection">
              <div className="device-panel-choice">
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
                    label: `${item.name} · ${item.platform === "ios" ? t("iOS") : t("Android")} · ${item.booted ? t("Running") : t("Stopped")}`,
                    keywords: `${item.id} ${item.version} ${item.physical ? t("Physical device") : t("Emulator")}`,
                  }))}
                />
                {device ? (
                  <p className="host-tool-muted" title={device.id}>
                    {device.physical
                      ? t("Physical device")
                      : device.platform === "ios"
                        ? t("Simulator")
                        : t("Emulator")}{" "}
                    · {device.version}
                  </p>
                ) : null}
              </div>
              <Button
                data-device-action
                variant="ghost"
                size="lg"
                aria-label={t("Refresh devices")}
                title={t("Refresh devices")}
                disabled={busy || loadingDevices || !status.running}
                onClick={() => void execute(api.list, applyDevices)}
              >
                <RefreshCw size={16} aria-hidden />
              </Button>
            </div>
          ) : null}
          {!devices.length && !loadingDevices && (
            <Button
              data-device-action
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={() => void execute(api.list, applyDevices)}
            >
              {t("Refresh devices")}
            </Button>
          )}
          <div className="device-panel-toolbar">
            <button
              type="button"
              hidden={!!device?.booted || !!device?.physical}
              className={!device?.booted ? "host-tool-primary" : undefined}
              disabled={busy || loadingDevices || !device || device.booted || device.physical}
              onClick={() =>
                void execute(
                  () => api.boot(selected),
                  (device) => {
                    setSelected(device.id);
                    setLive(device.booted);
                    setDevices((items) =>
                      items.map((item) => (item.id === selected ? device : item)),
                    );
                  },
                )
              }
            >
              {t("Boot")}
            </button>
            <Button
              data-device-action
              variant="secondary"
              size="lg"
              type="button"
              aria-label={t("Capture")}
              title={t("Capture")}
              disabled={!canView}
              onClick={() => void execute(() => capture(selected), setFrame)}
            >
              <ImagePlus size={16} aria-hidden />
            </Button>
            <Switch
              className="device-panel-toggle"
              label={t("Allow device control")}
              disabled={busy || !device?.booted}
              checked={control}
              onCheckedChange={setControl}
            />
            <Switch
              className="device-panel-toggle"
              label={t("Live view")}
              disabled={!canView}
              checked={live}
              onCheckedChange={setLive}
            />
            {onAddDevice ? (
              <Button
                data-device-action
                variant="secondary"
                size="lg"
                type="button"
                className="device-panel-attach"
                aria-label={t("Add device to conversation")}
                title={t("Add device to conversation")}
                disabled={busy || loadingDevices || !device}
                onClick={() => {
                  if (!device) return;
                  setDeviceNotice(undefined);
                  void execute(async () => {
                    try {
                      await onAddDevice(device);
                      return { text: t("Device added to draft."), error: false };
                    } catch (cause) {
                      return {
                        text: cause instanceof Error ? cause.message : String(cause),
                        error: true,
                      };
                    }
                  }, setDeviceNotice);
                }}
              >
                <Plus size={16} aria-hidden />
              </Button>
            ) : null}
          </div>
          {deviceNotice ? (
            <p className="host-tool-muted" role={deviceNotice.error ? "alert" : "status"}>
              {deviceNotice.text}
            </p>
          ) : null}
          {device && !device.booted ? (
            <p className="host-tool-muted">
              {t("Boot the selected device before viewing or controlling it.")}
            </p>
          ) : !selected && devices.length ? (
            <p className="host-tool-empty">{t("Select a device to view its screen.")}</p>
          ) : null}
          {device?.booted && !frame && !error && (
            <div
              className="host-tool-preview device-panel-preview device-panel-waiting"
              role="status"
            >
              {live
                ? t("Loading device screen…")
                : t("Resume live view to follow the device screen.")}
            </div>
          )}
          {frame && (
            <div className="host-tool-preview device-panel-preview">
              <img
                alt={t("Current device screen")}
                src={`data:${frame.mime};base64,${frame.base64}`}
                onClick={(event) => {
                  if (!canControl || device?.platform !== "android") return;
                  const image = event.currentTarget;
                  const bounds = image.getBoundingClientRect();
                  if (!bounds.width || !bounds.height) return;
                  action({
                    type: "press",
                    x: Math.round(
                      ((event.clientX - bounds.left) * image.naturalWidth) / bounds.width,
                    ),
                    y: Math.round(
                      ((event.clientY - bounds.top) * image.naturalHeight) / bounds.height,
                    ),
                  });
                }}
              />
            </div>
          )}
          {control && status.agentInstalled && selected && (
            <details className="host-tool-help device-panel-manual">
              <summary>{t("Manual controls")}</summary>
              <div className="host-tool-controls host-tool-card">
                <div className="host-tool-toolbar">
                  <label className="host-tool-field host-tool-grow">
                    {t("App name or bundle ID")}
                    <input
                      disabled={!canControl}
                      value={app}
                      maxLength={256}
                      onChange={(event) => setApp(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!canControl || !app.trim()}
                    onClick={() => action({ type: "openApp", app: app.trim() })}
                  >
                    {t("Open app")}
                  </button>
                </div>
                {device?.platform === "ios" ? (
                  <p className="host-tool-muted">
                    {t(
                      "iOS: open the target app before interacting with it, or use {p0} to select the Home screen. Controls may bring the selected app to the foreground.",
                      { p0: t("Home") },
                    )}
                  </p>
                ) : null}
                {windowsAndroid ? (
                  <p className="host-tool-muted">
                    {t("For Android, enter Settings or an app package ID such as com.example.app.")}
                  </p>
                ) : null}
                <div className="host-tool-toolbar">
                  <label className="host-tool-field host-tool-grow">
                    {t("Text to type on device")}
                    <input
                      disabled={!canControl}
                      value={text}
                      maxLength={4096}
                      onChange={(event) => setText(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!canControl || !text}
                    onClick={() => action({ type: "type", text })}
                  >
                    {t("Type text")}
                  </button>
                  <button
                    type="button"
                    disabled={!canControl}
                    onClick={() => action({ type: "home" })}
                  >
                    {t("Home")}
                  </button>
                  <button
                    type="button"
                    disabled={!canControl}
                    onClick={() => action({ type: "snapshot" })}
                  >
                    {t("Accessibility snapshot")}
                  </button>
                </div>
                {windowsAndroid ? (
                  <p className="host-tool-muted">
                    {t("Android text input supports printable ASCII characters.")}
                  </p>
                ) : null}
                <details className="host-tool-help">
                  <summary>{t("Coordinate controls")}</summary>
                  <div className="host-tool-toolbar">
                    <label className="host-tool-field">
                      X
                      <input
                        type="number"
                        aria-label={t("Device X coordinate")}
                        disabled={!canControl}
                        min={0}
                        max={20000}
                        className="host-tool-coordinate"
                        value={x}
                        onChange={(event) => setX(Number(event.target.value))}
                      />
                    </label>
                    <label className="host-tool-field">
                      Y
                      <input
                        type="number"
                        aria-label={t("Device Y coordinate")}
                        disabled={!canControl}
                        min={0}
                        max={20000}
                        className="host-tool-coordinate"
                        value={y}
                        onChange={(event) => setY(Number(event.target.value))}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={!canControl || !coordinatesValid}
                      onClick={() => action({ type: "press", x, y })}
                    >
                      {t("Press coordinate")}
                    </button>
                  </div>
                  <p>
                    {t(
                      "Android: click the screen to press at that pixel. iOS: use logical point coordinates from the accessibility snapshot.",
                    )}
                  </p>
                </details>
              </div>
            </details>
          )}
          {output && (
            <details className="host-tool-help">
              <summary>{t("Device action result")}</summary>
              <pre className="device-panel-output">{output}</pre>
            </details>
          )}
        </>
      )}
      {busy && (
        <p role="status" className="text-xs">
          {t("Working on the host…")}
        </p>
      )}
    </section>
  );
}
