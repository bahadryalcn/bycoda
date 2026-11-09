import type { Device } from "@bycoda/account-contracts";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { errorText } from "../../../shared/lib/errors";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { InlineEdit } from "../../../shared/ui/InlineEdit";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { useDevices } from "../hooks/useAccountData";
import styles from "./account.module.css";

function platformLabel(device: Device): string {
  const names = {
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
    ios: "iOS",
    android: "Android",
    web: "Web",
  } as const;
  return `${names[device.platform]} · ${device.osVersion} · bycoda ${device.appVersion}`;
}

/** The devices signed in to this account. This computer is marked; others can be signed out remotely. */
export function AccountDevices({
  currentDeviceId,
  onSignOutThisDevice,
}: {
  currentDeviceId: string | null;
  onSignOutThisDevice: () => Promise<void>;
}) {
  useLocale();
  const { query, rename, revoke, revokeOthers } = useDevices();
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState("");

  const signOutRemotely = async (device: Device) => {
    const isThis = device.id === currentDeviceId;
    const ok = await confirm({
      title: isThis ? t("Sign out this computer?") : t("Sign out {p0}?", { p0: device.name }),
      message: isThis
        ? t("This computer will be signed out of your bycoda account. Your local data stays.")
        : t("{p0} will be signed out of your bycoda account the next time it connects.", {
            p0: device.name,
          }),
      confirmLabel: t("Sign out"),
      pendingLabel: t("Signing out…"),
    });
    if (!ok) return;
    setError("");
    try {
      await revoke.mutateAsync(device.id);
      if (isThis) await onSignOutThisDevice();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const signOutOthers = async () => {
    const ok = await confirm({
      title: t("Sign out of all other devices?"),
      message: t(
        "Every device except this computer will be signed out of your bycoda account the next time it connects.",
      ),
      confirmLabel: t("Sign out others"),
      pendingLabel: t("Signing out…"),
    });
    if (!ok) return;
    setError("");
    try {
      await revokeOthers.mutateAsync();
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const devices = query.data?.filter((device) => !device.revokedAt) ?? [];
  return (
    <section className={styles.section} aria-labelledby="account-devices">
      <SectionLabel labelId="account-devices" count={query.data ? devices.length : null}>
        {t("My devices")}
      </SectionLabel>
      {query.isPending ? <LoadingText>{t("Loading devices…")}</LoadingText> : null}
      {query.isError ? (
        <InlineError retry={{ onRetry: () => query.refetch(), pending: query.isFetching }}>
          {t("Could not load your devices.")}
        </InlineError>
      ) : null}
      <ul className={styles.rows}>
        {devices.map((device) => {
          const isThis = device.id === currentDeviceId || device.current === true;
          return (
            <li key={device.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  <InlineEdit
                    label={t("Device name")}
                    value={device.name}
                    validate={(next) => (next.trim() ? null : t("Enter a name."))}
                    onSave={(next) => rename.mutateAsync({ id: device.id, name: next.trim() })}
                  />
                  {isThis ? <Badge tone="accent">{t("This computer")}</Badge> : null}
                </span>
                <span className={styles.meta}>
                  {platformLabel(device)}
                  {isThis
                    ? ""
                    : ` · ${t("Last active {p0}", { p0: formatRelativeTime(Date.parse(device.lastSeenAt)) })}`}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => signOutRemotely(device).catch(() => undefined)}
              >
                {t("Sign out")}
              </Button>
            </li>
          );
        })}
      </ul>
      {devices.length > 1 ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={revokeOthers.isPending || revoke.isPending}
          onClick={() => signOutOthers().catch(() => undefined)}
        >
          {t("Sign out of all other devices")}
        </Button>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {dialog}
    </section>
  );
}
