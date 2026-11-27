import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { Heading } from "../../../shared/ui/Heading";
import { InlineError } from "../../../shared/ui/InlineError";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Timestamp } from "../../../shared/ui/Timestamp";
import {
  PROVIDER_ACCOUNT_COLORS,
  setProviderAccountColor,
  type ProviderAccount,
} from "../../providers/public/providerAccounts";
import type { ProviderRateLimits } from "../../providers/public/rateLimitsCache";
import { UsageProviderIdentity, usageProviderLabel } from "./UsageProviderIdentity";
import { UsageQuotaWindows } from "./UsageQuotaWindows";

function colorLabel(id: (typeof PROVIDER_ACCOUNT_COLORS)[number]["id"]): string {
  switch (id) {
    case "blue":
      return t("Blue");
    case "coral":
      return t("Coral");
    case "amber":
      return t("Amber");
    case "green":
      return t("Green");
    case "pink":
      return t("Pink");
    case "purple":
      return t("Purple");
    case "teal":
      return t("Teal");
    case "slate":
      return t("Slate");
    case "orange":
      return t("Orange");
  }
}

/** The account's colour picker; its only action, so the button is named for it. */
function AccountColorMenu({ account }: { account: ProviderAccount }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        iconOnly
        label={t("Account color")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal aria-hidden className="icon-sm" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={button}
          label={t("Account color")}
          items={[
            {
              kind: "group",
              id: "color",
              label: t("Color"),
              items: PROVIDER_ACCOUNT_COLORS.map((option) => ({
                kind: "item" as const,
                id: option.id,
                label: colorLabel(option.id),
                checked: account.color === option.id,
                icon: (
                  <span
                    {...surfaceAttributes({ radius: "pill", variant: "user-color" }, "size-2.5")}
                    style={{ "--surface-user-color": option.value } as CSSProperties}
                  />
                ),
              })),
            },
            {
              kind: "item",
              id: "default",
              label: t("Use automatic color"),
              checked: !account.color,
            },
          ]}
          onPick={(id) => {
            setProviderAccountColor(
              account.provider,
              account.id,
              PROVIDER_ACCOUNT_COLORS.find((option) => option.id === id)?.id,
            );
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * One provider account's quota row: identity and name, last observation, an optional colour
 * menu (its slot is always reserved so rows line up), the quota windows, and load/error state.
 * Used by provider accounts and Grok so every row has the same structure.
 */
export function UsageAccountRow({
  provider,
  account,
  name,
  subtitle,
  limits,
  showRemaining,
  color,
  retryLabel,
  onRetry,
  menu = false,
}: {
  provider: string;
  account: ProviderAccount;
  /** Display name from `accountDisplayLabel`. */
  name: string;
  subtitle?: ReactNode;
  limits: ProviderRateLimits;
  showRemaining: boolean;
  color: string;
  retryLabel?: string;
  onRetry: () => void;
  /** Offer the colour menu; Grok has a fixed colour. */
  menu?: boolean;
}) {
  useLocale();
  const providerName = usageProviderLabel(provider);
  const loading = limits.status === "fetching" || limits.status === "idle";
  const windows = (["session", "weekly", "monthly"] as const).flatMap((kind) =>
    limits[kind] ? [{ kind, window: limits[kind]! }] : [],
  );
  return (
    <section className="usage-account" aria-label={`${providerName} · ${name}`} aria-busy={loading}>
      <div className="usage-account-heading">
        <div className="usage-account-identity">
          <Heading size="item" level={3}>
            <Text size="inherit" tone="secondary" className="usage-account-provider">
              <UsageProviderIdentity provider={provider} />
            </Text>
            <span className="usage-account-name">{name}</span>
          </Heading>
          {subtitle}
        </div>
        <Text size="caption" tone="muted" leading="inherit" className="usage-account-observed">
          {limits.updatedAt > 0 ? (
            <>
              <span className="sr-only">{t("Last observed")}: </span>
              <Timestamp
                value={limits.updatedAt}
                format="relative"
                relativeStyle="short"
                title={t("Last observed: {p0}", {
                  p0: formatDate(limits.updatedAt, { dateStyle: "medium", timeStyle: "short" }),
                })}
              />
            </>
          ) : null}
        </Text>
        <div className="usage-account-actions">
          {menu ? <AccountColorMenu account={account} /> : null}
        </div>
      </div>
      <UsageQuotaWindows
        name={`${providerName} · ${name}`}
        windows={windows}
        showRemaining={showRemaining}
        color={color}
      />
      {limits.error ? (
        <InlineError
          className="usage-account-error"
          details={limits.error}
          retry={{
            label: retryLabel,
            pending: limits.status === "fetching",
            onRetry,
          }}
        >
          {t("Account limits unavailable.")}
        </InlineError>
      ) : null}
      {/* Stale windows stay visible while refreshing (aria-busy on the section says so). */}
      {!windows.length && !limits.error ? (
        loading ? (
          <LoadingText size="caption" tone="secondary">
            {t("Loading account limits…")}
          </LoadingText>
        ) : (
          <Text as="p" size="caption" tone="muted">
            {t("Account limits unavailable.")}
          </Text>
        )
      ) : null}
    </section>
  );
}
