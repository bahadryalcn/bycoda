import { Text } from "../../../shared/ui/Text";
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
import { Check, Copy } from "../../../shared/ui/icons";
import type { BuildIdentity } from "../../workspaces/model/contracts";
import { SettingsFeedback } from "./settingsControls";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";

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
  const comparison = compareBuildIdentity(buildIdentity, native);
  return (
    <Disclosure
      summary={t("Build details")}
      size="sm"
      className="min-w-0"
      data-testid="build-identity-details"
    >
      <DescriptionList size="sm" className="py-2">
        {comparison === "exact" && readState !== "failed" ? (
          /* Both stamps are the same: say so once and show the identity once. */
          <DescriptionItem term={t("Source")}>
            {t(buildIdentityLabel())}{" "}
            <Text size="inherit" tone="secondary">
              · {t("Same source")}
            </Text>
          </DescriptionItem>
        ) : (
          <>
            <DescriptionItem term={t("App source")}>{t(buildIdentityLabel())}</DescriptionItem>
            <DescriptionItem term={t("Native source")}>
              {readState === "failed" && !native
                ? t("Unavailable: the native build stamp could not be read.")
                : t(buildIdentityLabel(native))}
              {readState === "failed" && native ? (
                <Text size="inherit" tone="secondary">
                  {" "}
                  {t("(last successful read; the latest read failed)")}
                </Text>
              ) : null}
            </DescriptionItem>
            <DescriptionItem term={t("Source comparison")}>
              {t(
                {
                  exact: "Same source",
                  included: "Source included",
                  different: "Different source",
                  unknown: "Unknown",
                }[comparison],
              )}
            </DescriptionItem>
          </>
        )}
      </DescriptionList>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          label={t("Copy build details")}
          tooltip={copied ? t("Copied") : t("Copy build details")}
          loading={copying}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check aria-hidden className="icon-xs" strokeWidth={1.75} />
          ) : (
            <Copy aria-hidden className="icon-xs" strokeWidth={1.75} />
          )}
        </Button>
        <Text role="status" size="inherit" tone="secondary" className="empty:hidden">
          {copied ? t("Copied") : ""}
        </Text>
        {readState === "failed" ? (
          <Button onClick={() => setAttempt((value) => value + 1)}>{t("Retry native read")}</Button>
        ) : null}
      </div>
      {error && <SettingsFeedback state="error">{error}</SettingsFeedback>}
    </Disclosure>
  );
}
