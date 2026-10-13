import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";

type BundledHostStatus = {
  state: string;
  message?: string | null;
  bundled?: string | null;
  installed?: string | null;
};

/** Explains a host update the app could not apply yet; silent when current. */
export function LocalHostUpdateNotice() {
  useLocale();
  const [status, setStatus] = useState<BundledHostStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      invoke<BundledHostStatus | null>("local_host_bundle_status").then(
        (value) => {
          if (!cancelled) setStatus(value);
        },
        () => undefined,
      );
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  if (!status || (status.state !== "deferred" && status.state !== "failed")) return null;
  const versions =
    status.installed && status.bundled
      ? t("This computer's host is {p0}; this app includes {p1}.", {
          p0: status.installed,
          p1: status.bundled,
        })
      : null;
  return (
    <div
      role="status"
      className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-[12px] leading-relaxed text-content/75"
    >
      <span className="font-medium text-content">
        {status.state === "failed"
          ? t("The host on this computer could not be updated.")
          : t("The host on this computer will update soon.")}
      </span>{" "}
      {versions} {status.message ? t(status.message) : null}
    </div>
  );
}
