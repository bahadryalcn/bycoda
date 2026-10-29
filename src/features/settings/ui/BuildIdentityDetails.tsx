import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { t, useLocale } from "../../../shared/i18n";
import {
  buildIdentity,
  buildIdentityLabel,
  compareBuildIdentity,
} from "../../../shared/model/build-info";
import { Button } from "../../../shared/ui/Button";
import type { BuildIdentity } from "../../workspaces/model/contracts";
import { SettingsFeedback } from "./settingsControls";

/** The native and renderer stamps are separate evidence, including when either is unknown. */
export function BuildIdentityDetails() {
  useLocale();
  const [native, setNative] = useState<BuildIdentity | null>(null);
  // "failed" is a read error; a successful read of nothing stays "ready" with null (honestly unknown).
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    setReadState("loading");
    void invoke<BuildIdentity | null>("build_identity").then(
      (value) => {
        if (!active) return;
        setNative(value);
        setReadState("ready");
      },
      () => {
        // Keep any earlier stamp as retained evidence; only the read itself failed.
        if (active) setReadState("failed");
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const copy = async () => {
    if (pending.current) return;
    pending.current = true;
    setCopying(true);
    setCopied(false);
    setError(undefined);
    try {
      await copyText(JSON.stringify({ renderer: buildIdentity, native }, null, 2));
      setCopied(true);
    } catch (cause) {
      setError(String(cause));
    } finally {
      pending.current = false;
      setCopying(false);
    }
  };
  return (
    <details
      className="min-w-0 text-ui-caption text-(--ui-text-secondary)"
      data-testid="build-identity-details"
    >
      <summary>{t("Build details")}</summary>
      <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 py-2">
        <dt>{t("App source")}</dt>
        <dd className="break-all text-content">{t(buildIdentityLabel())}</dd>
        <dt>{t("Native source")}</dt>
        <dd className="break-all text-content">
          {readState === "failed" && !native
            ? t("Unavailable: the native build stamp could not be read.")
            : t(buildIdentityLabel(native))}
          {readState === "failed" && native ? (
            <span className="text-(--ui-text-secondary)">
              {" "}
              {t("(last successful read; the latest read failed)")}
            </span>
          ) : null}
        </dd>
        <dt>{t("Source comparison")}</dt>
        <dd className="text-content">
          {t(
            {
              exact: "Same source",
              included: "Source included",
              different: "Different source",
              unknown: "Unknown",
            }[compareBuildIdentity(buildIdentity, native)],
          )}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void copy()} loading={copying} loadingLabel={t("Copying…")}>
          {copied ? t("Copied") : t("Copy build details")}
        </Button>
        {readState === "failed" ? (
          <Button onClick={() => setAttempt((value) => value + 1)}>{t("Retry native read")}</Button>
        ) : null}
      </div>
      {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
    </details>
  );
}
