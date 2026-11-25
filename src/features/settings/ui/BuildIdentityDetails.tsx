import { Text } from "../../../shared/ui/Text";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import {
  buildIdentity,
  buildIdentityLabel,
  compareBuildIdentity,
} from "../../../shared/model/build-info";
import { Button } from "../../../shared/ui/Button";
import { CopyButton } from "../../../shared/ui/CopyButton";
import type { BuildIdentity } from "../../workspaces/model/contracts";
import { DescriptionItem, DescriptionList } from "../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../shared/ui/Disclosure";

/** The build id, branch and head, or a translated note when the identity is unknown. */
function identityLabel(identity: BuildIdentity | null): string {
  return identity ? buildIdentityLabel(identity) : t("source identity unknown");
}

/** The native and renderer stamps are separate evidence, including when either is unknown. */
export function BuildIdentityDetails() {
  useLocale();
  const [native, setNative] = useState<BuildIdentity | null>(null);
  // "failed" is a read error; a successful read of nothing stays "ready" with null (honestly unknown).
  const [readState, setReadState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
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
  const comparison = compareBuildIdentity(buildIdentity, native);
  return (
    <Disclosure
      summary={t("Build details")}
      size="sm"
      className="min-w-0"
      data-testid="build-identity-details"
      summaryActions={
        <CopyButton
          iconOnly
          size="sm"
          label={t("Copy build details")}
          text={() => JSON.stringify({ renderer: buildIdentity, native }, null, 2)}
          resetKeys={[native]}
        />
      }
    >
      <DescriptionList size="sm">
        {comparison === "exact" && readState !== "failed" ? (
          /* Both stamps are the same: say so once and show the identity once. */
          <DescriptionItem term={t("Source")}>
            {identityLabel(buildIdentity)}{" "}
            <Text size="inherit" tone="secondary">
              · {t("Same source")}
            </Text>
          </DescriptionItem>
        ) : (
          <>
            <DescriptionItem term={t("App source")}>{identityLabel(buildIdentity)}</DescriptionItem>
            <DescriptionItem term={t("Native source")}>
              {readState === "failed" && !native
                ? t("Unavailable: the native build stamp could not be read.")
                : identityLabel(native)}
              {readState === "failed" && native ? (
                <Text size="inherit" tone="secondary">
                  {" "}
                  {t("(last successful read; the latest read failed)")}
                </Text>
              ) : null}
            </DescriptionItem>
            <DescriptionItem term={t("Source comparison")}>
              {
                {
                  exact: t("Same source"),
                  included: t("Source included"),
                  different: t("Different source"),
                  unknown: t("Unknown"),
                }[comparison]
              }
            </DescriptionItem>
          </>
        )}
      </DescriptionList>
      {readState === "failed" ? (
        <div className="mt-2">
          <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {t("Retry native read")}
          </Button>
        </div>
      ) : null}
    </Disclosure>
  );
}
