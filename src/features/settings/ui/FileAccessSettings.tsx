import { SettingsFeedback } from "./settingsControls";
import { useCallback, useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  configureFileAccess,
  getFileAccessMode,
  type FileAccessMode,
} from "../../../platform/tauri/fileAccess";
import { Group, Row } from "./settingsControls";
import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { RefreshCw } from "../../../shared/ui/icons";

export function FileAccessSettings({ embedded = false }: { embedded?: boolean }) {
  useLocale();
  const [mode, setMode] = useState<FileAccessMode | null>(null);
  const [pending, setPending] = useState<"read" | "configure" | null>(null);
  const [error, setError] = useState("");
  const [errorOperation, setErrorOperation] = useState<"read" | "configure">("read");
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const active = useRef(false);
  const operation = useRef(false);
  const refresh = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    setPending("read");
    try {
      const value = await getFileAccessMode();
      if (active.current) {
        setMode(value);
        setError("");
        setStatusUnavailable(false);
      }
    } catch (reason) {
      if (active.current) {
        setError(String(reason));
        setErrorOperation("read");
        setStatusUnavailable(true);
      }
    } finally {
      operation.current = false;
      if (active.current) setPending(null);
    }
  }, []);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- reads native access on mount and focus, and drops read results after this surface unmounts
  useEffect(() => {
    active.current = true;
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      active.current = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const review = async () => {
    if (operation.current) return;
    operation.current = true;
    setPending("configure");
    setError("");
    try {
      const value = await configureFileAccess(true);
      if (active.current) {
        setMode(value);
        setStatusUnavailable(false);
      }
    } catch (reason) {
      // Native consent may have persisted before a later step failed. Read back
      // independently; rejection must not imply that access stayed unchanged.
      try {
        const value = await getFileAccessMode();
        if (active.current) {
          setMode(value);
          setStatusUnavailable(false);
        }
      } catch {
        if (active.current) setStatusUnavailable(true);
      }
      if (active.current) {
        setError(String(reason));
        setErrorOperation("configure");
      }
    } finally {
      operation.current = false;
      if (active.current) setPending(null);
    }
  };
  const modeLabel =
    mode === "all-files"
      ? t("All files allowed")
      : mode === "selected-folders"
        ? t("Selected folders only")
        : t("Not configured");
  const content = (
    <>
      <Row
        id="file-access"
        label={t("Current access")}
        description={t("Agent approval rules still control commands and tools.")}
        info={
          <InfoPopover className="shrink-0" label={t("About file access")}>
            <p>
              {t(
                "All files access allows reading and editing files on this computer. Selected-folder grants may be read-only. Change file access opens the native consent flow.",
              )}
            </p>
          </InfoPopover>
        }
        scope={
          <>
            <LiveText
              size="caption"
              tone="secondary"
              leading="inherit"
              text={
                statusUnavailable
                  ? t("Status unavailable")
                  : mode === null
                    ? error
                      ? t("Status unavailable")
                      : t("Loading…")
                    : modeLabel
              }
            />
            {statusUnavailable && mode !== null ? (
              <Text as="span" size="caption" tone="secondary" leading="inherit">
                {" · "}
                {t("Last known access: {p0}", { p0: modeLabel })}
              </Text>
            ) : null}
          </>
        }
        feedback={
          error ? (
            <SettingsFeedback
              state="error"
              action={
                <Button onClick={() => void refresh()} disabled={pending !== null}>
                  {t("Retry")}
                </Button>
              }
            >
              <p>
                {errorOperation === "read"
                  ? t("Could not read file access status. Retry to check current access.")
                  : t(
                      "Could not confirm the file access operation. Refresh the status before trying again.",
                    )}
              </p>
              {error}
            </SettingsFeedback>
          ) : pending ? (
            <SettingsFeedback state="loading" immediate={pending === "configure"}>
              {pending === "configure" ? t("Waiting for approval…") : t("Loading…")}
            </SettingsFeedback>
          ) : null
        }
      >
        <div className="flex flex-nowrap items-center gap-1">
          <Button
            loading={pending === "configure"}
            disabled={pending !== null || mode === null || statusUnavailable}
            onClick={() => void review()}
          >
            {t("Change file access…")}
          </Button>
          <Button
            variant="ghost"
            iconOnly
            label={t("Refresh")}
            loading={pending === "read"}
            disabled={pending !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" className="icon-sm" strokeWidth={1.75} />
          </Button>
        </div>
      </Row>
    </>
  );
  return embedded ? (
    content
  ) : (
    <Group
      id="file-access-permissions"
      title={t("File access")}
      description={t("Remote hosts manage their own file access.")}
    >
      {content}
    </Group>
  );
}
