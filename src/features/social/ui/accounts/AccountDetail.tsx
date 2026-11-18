import { InlineError } from "../../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { Heading } from "../../../../shared/ui/Heading";
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
import { LinkedInAnalytics } from "../linkedin/LinkedInAnalytics";
import { LinkedInBrowserProfile } from "../linkedin/LinkedInBrowserProfile";
import { LinkedInCreator } from "../linkedin/LinkedInCreator";
import { LinkedInLive } from "../linkedin/LinkedInLive";
import { LinkedInNetwork } from "../linkedin/LinkedInNetwork";
import { LinkedInPostManagement } from "../linkedin/LinkedInPostManagement";
import { AccountPermissions } from "./AccountPermissions";
import { AutonomySettings } from "./AutonomySettings";
import { BrowserSettings } from "./BrowserSettings";
import { ReplyRules } from "./ReplyRules";
import { accountHealth, accountModeText } from "./accountsModel";
import { useAccountWrite } from "./useAccountWrite";
import { XApiSettings } from "./platform/XApiSettings";
import { XAccountActions } from "./platform/XAccountActions";
import { YouTubeManage } from "./youtube/YouTubeManage";
import type { YouTubeSection } from "./youtube/youtubeForms";
import { TikTokAccountTools } from "./platform/TikTokAccountTools";
import { SnapchatProfilePanel } from "./SnapchatProfilePanel";
import { snapchatAccountKey } from "../common/snapchatAccount";
// Facebook Page panels
import { socialQueryScope } from "../../model/socialQuery";
import { FacebookLivePanel } from "./platform/FacebookLivePanel";
import { FacebookManagementRequests } from "./platform/FacebookManagementRequests";
import { FacebookMonetization } from "./platform/FacebookMonetization";
import { FacebookPageActivity } from "./platform/FacebookPageActivity";
import { FacebookProfileEditor } from "./platform/FacebookProfileEditor";
import {
  FacebookPersonalProfileForm,
  FacebookProfilePhotos,
} from "./platform/FacebookProfileForms";
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
  youtubeSection?: YouTubeSection;
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
  youtubeSection,
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

  const hasPlatformTools =
    account.platform === "x" ||
    account.platform === "youtube" ||
    (account.platform === "tiktok" && account.connected) ||
    (account.platform === "snapchat" &&
      (account.accountType === "public_profile" || account.connection === "browser")) ||
    (account.platform === "linkedin" && account.connected) ||
    (account.platform === "facebook" &&
      (account.accountType === "page" ||
        (account.accountType === "member" && account.connection === "browser")) &&
      account.connected &&
      onThisComputer &&
      !disabled);

  return (
    <div className="social-accounts-screen social-detail">
      <div className="social-detail-header">
        <PlatformMark platform={account.platform} size="lg" />
        <div className="social-detail-header-main">
          <ScreenHeader
            title={SOCIAL_PLATFORM_NAMES[account.platform]}
            description={`${accountModeText(account)} · ${onThisComputer ? t("On this computer") : t("On another computer")}`}
            secondary={menu}
          />
          <div className="social-detail-status">
            <Badge tone={HEALTH_TONE[health.status]} size="sm">
              {health.text}
            </Badge>
            {account.paused ? (
              <Badge tone="warning" size="sm">
                {t("Paused")}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
      {disabled ? (
        <InlineMessage tone="warning" live="off">
          {t("Could not reach this computer.")}
        </InlineMessage>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {account.platform === "x" && account.connection !== "browser" ? (
        <XApiSettings account={account} client={client} disabled={disabled} onChanged={onChanged} />
      ) : null}
      <AccountConnection
        client={client}
        account={account}
        capabilities={capabilities}
        projects={projects}
        onThisComputer={onThisComputer}
        disabled={disabled}
        onChanged={onChanged}
      />
      {hasPlatformTools ? (
        <section
          {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "social-card")}
          aria-label={t("Tools")}
        >
          <Heading size="item">{t("Tools")}</Heading>
          {account.platform === "x" ? (
            <XAccountActions
              key={account.id}
              account={account}
              client={client}
              disabled={disabled}
            />
          ) : null}
          {account.platform === "youtube" ? (
            <Disclosure
              summary={t("YouTube management")}
              variant="row"
              defaultOpen={Boolean(youtubeSection)}
            >
              <YouTubeManage
                client={client}
                account={account}
                capabilities={capabilities}
                disabled={disabled || !onThisComputer}
                initialSection={youtubeSection}
              />
            </Disclosure>
          ) : null}
          {account.platform === "tiktok" && account.connected ? (
            <TikTokAccountTools
              key={`${account.executorId}:${account.id}:${account.platformId}:${account.connection}`}
              client={client}
              account={account}
              projects={projects}
              disabled={disabled || account.paused || !onThisComputer}
              onChanged={onChanged}
            />
          ) : null}
          {account.platform === "snapchat" &&
          (account.accountType === "public_profile" || account.connection === "browser") ? (
            <SnapchatProfilePanel
              key={snapchatAccountKey(client, account)}
              client={client}
              account={account}
              capabilities={capabilities}
              disabled={disabled}
              onThisComputer={onThisComputer}
              onChanged={onChanged}
            />
          ) : null}
          {account.platform === "linkedin" && account.connected ? (
            <LinkedInAnalytics
              key={JSON.stringify([account.id, account.platformId, account.connection])}
              account={account}
              client={client}
              disabled={disabled}
            />
          ) : null}
          {account.platform === "linkedin" &&
          account.connected &&
          account.connection === "oauth" ? (
            <LinkedInPostManagement
              key={JSON.stringify([account.id, account.platformId])}
              account={account}
              client={client}
              disabled={disabled || !onThisComputer}
            />
          ) : null}
          {account.platform === "linkedin" && account.connected ? (
            <LinkedInLive
              key={JSON.stringify([account.id, account.platformId, account.connection])}
              account={account}
              client={client}
              disabled={disabled || !onThisComputer}
            />
          ) : null}
          {account.platform === "linkedin" && account.connected ? (
            <LinkedInBrowserProfile
              key={JSON.stringify([account.id, account.platformId, account.connection])}
              account={account}
              client={client}
              disabled={disabled || !onThisComputer}
            />
          ) : null}
          {account.platform === "linkedin" &&
          account.connected &&
          account.connection === "browser" ? (
            <LinkedInNetwork
              key={JSON.stringify([account.id, account.platformId])}
              account={account}
              client={client}
              disabled={disabled || !onThisComputer}
            />
          ) : null}
          {account.platform === "linkedin" && account.connected ? (
            <LinkedInCreator
              key={JSON.stringify([account.id, account.platformId, account.connection])}
              account={account}
              client={client}
              disabled={disabled || !onThisComputer}
            />
          ) : null}
          {/* Facebook Page and personal profile management */}
          {account.platform === "facebook" &&
          (account.accountType === "page" ||
            (account.accountType === "member" && account.connection === "browser")) &&
          account.connected &&
          onThisComputer &&
          !disabled ? (
            <div key={`${socialQueryScope(client).join(":")}:${account.id}:${account.connection}`}>
              <Disclosure summary={t("Edit profile")} variant="row">
                {account.accountType === "member" ? (
                  <FacebookPersonalProfileForm client={client} account={account} />
                ) : (
                  <FacebookProfileEditor client={client} account={account} />
                )}
              </Disclosure>
              <Disclosure summary={t("Facebook profile photos")} variant="row">
                <FacebookProfilePhotos client={client} account={account} />
              </Disclosure>
              {account.accountType === "page" && account.connection !== "browser" ? (
                <>
                  <Disclosure summary={t("Posts")} variant="row">
                    <FacebookPageActivity client={client} accountId={account.id} />
                  </Disclosure>
                  <Disclosure summary={t("Facebook requests")} variant="row">
                    <FacebookManagementRequests client={client} accountId={account.id} />
                  </Disclosure>
                  <Disclosure summary={t("Mentions")} variant="row">
                    <FacebookPageActivity client={client} accountId={account.id} mentions />
                  </Disclosure>
                  <Disclosure summary={t("Live video")} variant="row">
                    <FacebookLivePanel
                      client={client}
                      accountId={account.id}
                      canStream={capabilities.some(
                        ({ operation, status }) =>
                          operation === "live.transmit" && status === "available",
                      )}
                    />
                  </Disclosure>
                </>
              ) : null}
              {account.accountType === "page" ? (
                <Disclosure summary={t("Monetization")} variant="row">
                  <FacebookMonetization client={client} account={account} />
                </Disclosure>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <section
        {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "social-card")}
        aria-label={t("Account settings")}
      >
        <Heading size="item">{t("Account settings")}</Heading>
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
      </section>
      {confirmation.dialog}
    </div>
  );
}
