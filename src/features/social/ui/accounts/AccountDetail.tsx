import { InlineError } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import type { HostProject } from "../../../connections/public/protocol";
import { Badge, type BadgeTone } from "../../../../shared/ui/Badge";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { Globe, MessageSquare, Shield, SlidersHorizontal } from "../../../../shared/ui/icons";
import { PlatformMark } from "../common/PlatformIcon";
import { ScreenHeader, type ScreenHeaderMenuItem } from "../common/ScreenHeader";
import { SOCIAL_PLATFORM_NAMES, type SocialAccount, type SocialSnapshot } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { AccountConnection } from "./AccountConnection";
import { AccountPermissions } from "./AccountPermissions";
import { AutonomySettings } from "./AutonomySettings";
import { BrowserSettings } from "./BrowserSettings";
import { ReplyRules } from "./ReplyRules";
import { accountHealth, accountModeText } from "./accountsModel";
import { useAccountWrite } from "./useAccountWrite";
import "./accounts.css";

const HEALTH_TONE: Record<"ok" | "warn" | "error", BadgeTone> = {
  ok: "success",
  warn: "warning",
  error: "danger",
};

export type AccountDetailProps = {
  client: SocialClient;
  account: SocialAccount;
  snapshot: SocialSnapshot;
  projects: HostProject[];
  needsHuman: boolean | undefined;
  now?: number;
  hostOnline: boolean;
  onChanged(): void;
};

/**
 * One account: its health and connection, who may use it, how far AI may act, browser options and
 * its reply rules. Pause and removing the connection sit in the overflow menu.
 */
export function AccountDetail({
  client,
  account,
  snapshot,
  projects,
  needsHuman,
  now,
  hostOnline,
  onChanged,
}: AccountDetailProps) {
  const [openedAt] = useState(Date.now);
  const { error, is, write } = useAccountWrite(t("The account could not be changed. Try again."));
  const confirmation = useConfirm();
  const capabilities = snapshot.capabilities[account.id] ?? [];
  const health = accountHealth({ account, capabilities, needsHuman, now: now ?? openedAt });
  const onThisComputer = account.executorId === snapshot.executorId;
  const disabled = !hostOnline;

  const pause = () =>
    void write("pause", () =>
      client.request("accounts.pause", { accountId: account.id, paused: !account.paused }),
    )
      .then((result) => result !== undefined && onChanged())
      .catch(() => undefined);
  const remove = () =>
    confirmation
      .confirm({
        title: t("Remove the connection of {p1}?", { p1: account.name }),
        message: t(
          "The saved sign-in of {p1} is removed and the account is paused, so nothing is sent from it. The account entry, its project access and past activity stay.",
          { p1: account.name },
        ),
        confirmLabel: t("Remove connection"),
        danger: true,
        onConfirm: async () => {
          await client.request("accounts.disconnect", { accountId: account.id });
          onChanged();
        },
      })
      .catch(() => undefined);

  const menu: ScreenHeaderMenuItem[] = [
    {
      id: "pause",
      label: account.paused ? t("Resume account") : t("Pause account"),
      onSelect: pause,
      disabled: disabled || is("pause"),
    },
    {
      id: "remove",
      label: t("Remove connection"),
      danger: true,
      onSelect: remove,
      disabled: disabled || !account.connected,
    },
  ];

  return (
    <div className="social-accounts-screen">
      <ScreenHeader
        title={SOCIAL_PLATFORM_NAMES[account.platform]}
        description={`${accountModeText(account)} · ${onThisComputer ? t("On this computer") : t("On another computer")}`}
        secondary={menu}
      />
      <div className="social-detail-status">
        <PlatformMark platform={account.platform} size="lg" />
        <Text
          size="body"
          tone="inherit"
          leading="inherit"
          weight="medium"
          className="social-detail-name"
        >
          {account.name}
        </Text>
        <Badge tone={HEALTH_TONE[health.status]} size="sm">
          {health.text}
        </Badge>
        {account.paused ? (
          <Badge tone="warning" size="sm">
            {t("Paused")}
          </Badge>
        ) : null}
      </div>
      {disabled ? (
        <InlineMessage tone="warning" live="off">
          {t("Could not reach this computer.")}
        </InlineMessage>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <AccountConnection
        client={client}
        account={account}
        capabilities={capabilities}
        onThisComputer={onThisComputer}
        disabled={disabled}
        onChanged={onChanged}
      />
      <Disclosure
        summary={
          <span className="social-detail-topic">
            <Shield className="icon-sm" aria-hidden />
            {t("Who can use this account")}
          </span>
        }
        variant="row"
      >
        <AccountPermissions
          client={client}
          account={account}
          projects={projects}
          disabled={disabled}
          onChanged={onChanged}
        />
      </Disclosure>
      <Disclosure
        summary={
          <span className="social-detail-topic">
            <SlidersHorizontal className="icon-sm" aria-hidden />
            {t("Autonomy")}
          </span>
        }
        variant="row"
      >
        <AutonomySettings
          client={client}
          account={account}
          disabled={disabled}
          onChanged={onChanged}
        />
      </Disclosure>
      {account.connection === "browser" ? (
        <Disclosure
          summary={
            <span className="social-detail-topic">
              <Globe className="icon-sm" aria-hidden />
              {t("Browser")}
            </span>
          }
          variant="row"
          defaultOpen={needsHuman === true}
        >
          <BrowserSettings
            client={client}
            accountId={account.id}
            accountName={account.name}
            needsHuman={needsHuman === true}
            disabled={disabled}
          />
        </Disclosure>
      ) : null}
      <Disclosure
        summary={
          <span className="social-detail-topic">
            <MessageSquare className="icon-sm" aria-hidden />
            {t("Reply rules")}
          </span>
        }
        variant="row"
      >
        <ReplyRules client={client} account={account} projects={projects} disabled={disabled} />
      </Disclosure>
      {confirmation.dialog}
    </div>
  );
}
