import type { Device } from "@bycoda/account-contracts";
import { useState } from "react";
import { dateTimeFormat, getLocale, t, useLocale } from "../../../shared/i18n";
import { formatRelativeTime } from "../../../shared/i18n/format";
import { errorText } from "../../../shared/lib/errors";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { InlineEdit } from "../../../shared/ui/InlineEdit";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Laptop, Smartphone } from "../../../shared/ui/icons";
import { Group, Row } from "../../settings/public/settingsControls";
import { useDevices } from "../hooks/useAccountData";

const PLATFORM_NAMES = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  web: "Web",
} as const;

/** Platform, OS, app version and either "this computer" facts or when it was last seen. */
export function deviceSummary(device: Device, isThis: boolean): string {
  const parts = [
    PLATFORM_NAMES[device.platform],
    device.osVersion,
    `bycoda ${device.appVersion}`,
    isThis
      ? t("Signed in {p0}", {
          p0: dateTimeFormat(getLocale(), { dateStyle: "medium" }).format(
            new Date(device.createdAt),
          ),
        })
      : t("Last active {p0}", { p0: formatRelativeTime(Date.parse(device.lastSeenAt)) }),
  ];
  return parts.filter(Boolean).join(" · ");
}

function channelLabel(channel: Device["channel"]): string | null {
  return channel === "preview" ? t("Preview") : channel === "dev" ? t("Development") : null;
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

  const devices = (query.data?.filter((device) => !device.revokedAt) ?? []).sort(
    (a, b) =>
      Number(b.id === currentDeviceId || b.current === true) -
        Number(a.id === currentDeviceId || a.current === true) ||
      Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
  );
  const desktops = devices.filter((device) => device.kind === "desktop");
  const phones = devices.filter((device) => device.kind === "mobile");

  const rows = (list: Device[]) =>
    list.map((device) => {
      const isThis = device.id === currentDeviceId || device.current === true;
      const channel = channelLabel(device.channel);
      const Icon = device.kind === "mobile" ? Smartphone : Laptop;
      return (
        <Row
          key={device.id}
          label={
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="icon-sm shrink-0 text-muted" aria-hidden />
              <InlineEdit
                label={t("Device name")}
                value={device.name}
                validate={(next) => (next.trim() ? null : t("Enter a name."))}
                onSave={(next) => rename.mutateAsync({ id: device.id, name: next.trim() })}
              />
              {isThis ? <Badge tone="accent">{t("This computer")}</Badge> : null}
              {channel ? <Badge>{channel}</Badge> : null}
            </span>
          }
          description={deviceSummary(device, isThis)}
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={revoke.isPending}
            onClick={() => signOutRemotely(device).catch(() => undefined)}
          >
            {t("Sign out")}
          </Button>
        </Row>
      );
    });

  const status = query.isPending ? (
    <LoadingText>{t("Loading devices…")}</LoadingText>
  ) : query.isError ? (
    <InlineError retry={{ onRetry: () => query.refetch(), pending: query.isFetching }}>
      {t("Could not load your devices.")}
    </InlineError>
  ) : null;

  return (
    <>
      <Group
        title={t("Computers")}
        description={t("Desktop apps signed in to your account. Rename one to tell them apart.")}
        action={
          devices.length > 1 ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={revokeOthers.isPending || revoke.isPending}
              onClick={() => signOutOthers().catch(() => undefined)}
            >
              {t("Sign out of all other devices")}
            </Button>
          ) : undefined
        }
        feedback={status ?? (error ? <InlineError>{error}</InlineError> : undefined)}
      >
        {rows(desktops)}
      </Group>
      <Group
        title={t("Phones")}
        description={t("bycoda on your phone. Signing one out also stops its notifications.")}
      >
        {phones.length ? (
          rows(phones)
        ) : (
          <Row
            label={t("No phone signed in")}
            description={t(
              "Sign in on the bycoda mobile app with the same account to see it here.",
            )}
          />
        )}
      </Group>
      {dialog}
    </>
  );
}
