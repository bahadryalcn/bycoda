import { useEffect, useState, useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { t, useLocale } from "../../../shared/i18n";
import {
  loadUpdateChannel,
  saveUpdateChannel,
  subscribeUpdateChannel,
} from "../model/updateChannel";
import { Row, Toggle } from "../../../shared/ui/settings";

/** Opt-in to the preview feed; the updater re-checks as soon as the choice changes. */
export function UpdateChannelRow() {
  useLocale();
  const [version, setVersion] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((value) => {
        if (!cancelled) setVersion(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const channel = useSyncExternalStore(subscribeUpdateChannel, () => loadUpdateChannel(version));
  const label = t("Preview updates");
  return (
    <Row
      id="update-channel"
      label={label}
      description={t(
        "Signed preview builds may include unfinished features. Switch off to wait for the next stable release.",
      )}
    >
      <Toggle
        label={label}
        on={channel === "preview"}
        onChange={(next) => saveUpdateChannel(next ? "preview" : "stable")}
      />
    </Row>
  );
}
