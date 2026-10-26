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
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    void invoke<BuildIdentity | null>("build_identity").then(
      (value) => {
        if (active) setNative(value);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);
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
      <dl className="grid min-w-0 gap-2 py-2">
        <dt>{t("App source")}</dt>
        <dd className="break-all">{t(buildIdentityLabel())}</dd>
        <dt>{t("Native source")}</dt>
        <dd className="break-all">{t(buildIdentityLabel(native))}</dd>
        <dt>{t("Source comparison")}</dt>
        <dd>
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
      <Button onClick={() => void copy()} loading={copying} loadingLabel={t("Copying…")}>
        {copied ? t("Copied") : t("Copy build details")}
      </Button>
      {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
    </details>
  );
}
