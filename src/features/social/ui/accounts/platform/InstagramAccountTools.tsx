import { useState } from "react";
import { formatNumber, t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { Text } from "../../../../../shared/ui/Text";
import type {
  InstagramInsightInput,
  InstagramInsightResult,
} from "../../../../../integrations/social/adapters/instagram-insights";
import type { Capability, SocialAccount } from "../../../model/social";
import type { HostProject } from "../../../../connections/public/protocol";
import type { InstagramPostChange, SocialBrowserIntent } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { InstagramAccountMentions } from "./InstagramAccountMentions";
import { InstagramProfileEditor } from "./InstagramProfileEditor";
import { InstagramDirectComposer } from "./InstagramDirectComposer";

export function InstagramAccountTools({
  client,
  account,
  capabilities,
  projects,
  disabled,
}: {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  projects: readonly HostProject[];
  disabled: boolean;
}) {
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
  const confirmation = useConfirm();
  const [notice, setNotice] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [handle, setHandle] = useState("");
  const [followers, setFollowers] = useState<string[]>();
  const [mediaId, setMediaId] = useState("");
  const [demographics, setDemographics] = useState<InstagramInsightInput["demographics"]>();
  const [insights, setInsights] = useState<InstagramInsightResult>();
  const browser = account.connection === "browser" && account.connected;
  const analytics = capabilities.some(
    (row) => row.operation === "analytics" && row.status === "available",
  );
  const signedMentions = capabilities.some(
    (row) => row.operation === "webhook" && row.status === "available",
  );
  const messageStart = capabilities.some(
    (row) => row.operation === "message.start" && row.status === "available",
  );
  const run = (key: string, work: () => Promise<unknown>) => {
    setNotice("");
    void write(key, work).catch(() => undefined);
  };
  const openWorkflow = (intent: SocialBrowserIntent) =>
    run(intent, async () => {
      const workflow = await client.browserWorkflowBegin(account.id, intent);
      if (workflow.status !== "awaiting_owner")
        throw new Error(workflow.error ?? t("Instagram could not complete this action."));
      setNotice(t("Continue in the Instagram browser window."));
    });
  const confirm = (
    label: string,
    target: string,
    danger: boolean,
    work: () => Promise<unknown>,
  ) => {
    void confirmation
      .confirm({
        title: label,
        message: t("Apply this change on Instagram?"),
        details: target,
        confirmLabel: label,
        danger,
      })
      .then((ok) => {
        if (ok) run(label, work);
      })
      .catch(() => undefined);
  };
  const changePost = (action: InstagramPostChange["action"], label: string) => {
    const url = postUrl.trim();
    const change: InstagramPostChange =
      action === "delete"
        ? { action, postUrl: url, confirm: "DELETE_INSTAGRAM_POST" }
        : { action, postUrl: url, caption, confirm: "EDIT_INSTAGRAM_CAPTION" };
    confirm(label, url, action === "delete", async () => {
      await client.browserInstagramPost(account.id, change);
      setNotice(t("Instagram updated."));
    });
  };
  const follow = (next: boolean, label: string) => {
    const username = handle.trim();
    confirm(label, username, false, async () => {
      const result = await client.browserInstagramFollow(account.id, {
        handle: username,
        follow: next,
        confirm: next ? "FOLLOW_INSTAGRAM_ACCOUNT" : "UNFOLLOW_INSTAGRAM_ACCOUNT",
      });
      setNotice(result.requested ? t("Follow request sent.") : t("Instagram updated."));
    });
  };
  const workflows: { intent: SocialBrowserIntent; label: string }[] = [
    { intent: "instagram-professional", label: t("Switch to professional account") },
    { intent: "instagram-profile", label: t("Open Instagram profile settings") },
    { intent: "instagram-highlights", label: t("Manage Instagram Highlights") },
    { intent: "instagram-monetization", label: t("Open Instagram monetization") },
    { intent: "instagram-live", label: t("Open Instagram Live Producer") },
  ];
  return (
    <Disclosure summary={t("Instagram tools")}>
      {account.connection === "browser" ? (
        <FieldGroup legend={t("Instagram in browser")} layout="row" gap="sm" disabled={disabled}>
          {workflows.map(({ intent, label }) => (
            <Button
              key={intent}
              size="sm"
              variant="secondary"
              loading={is(intent)}
              onClick={() => openWorkflow(intent)}
            >
              {label}
            </Button>
          ))}
        </FieldGroup>
      ) : null}
      {analytics ? (
        <FieldGroup legend={t("Instagram insights")} disabled={disabled || is("insights")}>
          <TextField
            label={t("Instagram media ID (optional)")}
            value={mediaId}
            onChange={(event) => {
              setMediaId(event.target.value);
              setInsights(undefined);
            }}
          />
          <Select
            label={t("Audience breakdown")}
            value={demographics ?? ""}
            disabled={!!mediaId.trim()}
            options={[
              { value: "", label: t("Overview") },
              { value: "age", label: t("Age") },
              { value: "gender", label: t("Gender") },
              { value: "country", label: t("Country") },
              { value: "city", label: t("City") },
            ]}
            onValueChange={(value) => {
              setDemographics((value || undefined) as InstagramInsightInput["demographics"]);
              setInsights(undefined);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={is("insights")}
            onClick={() =>
              run("insights", async () => {
                const id = mediaId.trim();
                setInsights(
                  await client.request<InstagramInsightResult>("instagram.insights", {
                    accountId: account.id,
                    ...(id ? { mediaId: id } : demographics ? { demographics } : {}),
                  }),
                );
              })
            }
          >
            {t("Read Instagram insights")}
          </Button>
          {insights ? (
            <ul>
              {Object.entries(insights.metrics).map(([key, metric]) => (
                <li key={key}>
                  <Text>
                    {key.replace(/_/g, " ")}{" "}
                    {metric.value !== undefined ? formatNumber(metric.value) : ""}
                  </Text>
                  {metric.points?.map((point, index) => (
                    <Text key={index} as="p">
                      {point.endTime} {formatNumber(point.value)}
                    </Text>
                  ))}
                  {metric.breakdown?.map((entry) => (
                    <Text key={entry.dimensions.join("|")} as="p">
                      {entry.dimensions.join(" · ")} {formatNumber(entry.value)}
                    </Text>
                  ))}
                </li>
              ))}
              {insights.unavailable.length ? (
                <li>{t("Unavailable metrics: {p0}", { p0: insights.unavailable.join(", ") })}</li>
              ) : null}
            </ul>
          ) : null}
        </FieldGroup>
      ) : null}
      {browser || signedMentions ? (
        <InstagramAccountMentions
          client={client}
          accountId={account.id}
          browser={browser}
          disabled={disabled}
        />
      ) : null}
      {browser ? (
        <>
          <InstagramProfileEditor client={client} accountId={account.id} disabled={disabled} />
          {messageStart ? (
            <InstagramDirectComposer
              client={client}
              account={account}
              projects={projects}
              disabled={disabled}
            />
          ) : null}
          <FieldGroup legend={t("Manage Instagram posts")} disabled={disabled}>
            <TextField
              label={t("Instagram post URL")}
              type="url"
              value={postUrl}
              onChange={(event) => setPostUrl(event.target.value)}
            />
            <TextareaField
              label={t("Caption")}
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
            />
            <div className="social-tag-line">
              <Button
                size="sm"
                variant="secondary"
                disabled={!postUrl.trim()}
                loading={is(t("Edit Instagram caption"))}
                onClick={() => changePost("caption", t("Edit Instagram caption"))}
              >
                {t("Edit Instagram caption")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                tone="danger"
                disabled={!postUrl.trim()}
                loading={is(t("Delete Instagram post"))}
                onClick={() => changePost("delete", t("Delete Instagram post"))}
              >
                {t("Delete Instagram post")}
              </Button>
            </div>
          </FieldGroup>
          <FieldGroup legend={t("Instagram followers")} disabled={disabled}>
            <TextField
              label={t("Instagram username")}
              value={handle}
              onChange={(event) => {
                setHandle(event.target.value);
                setFollowers(undefined);
              }}
            />
            <div className="social-tag-line">
              <Button
                size="sm"
                variant="secondary"
                disabled={!handle.trim()}
                loading={is("followers")}
                onClick={() =>
                  run("followers", async () => {
                    const sample = await client.browserInstagramFollowers(
                      account.id,
                      handle.trim(),
                    );
                    setFollowers(sample.followers.map(({ username }) => username));
                  })
                }
              >
                {t("Read visible followers")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!handle.trim()}
                loading={is(t("Follow"))}
                onClick={() => follow(true, t("Follow"))}
              >
                {t("Follow")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!handle.trim()}
                loading={is(t("Unfollow"))}
                onClick={() => follow(false, t("Unfollow"))}
              >
                {t("Unfollow")}
              </Button>
            </div>
            {followers ? (
              <Text size="caption" tone="muted">
                {t("Visible followers only")}
                {followers.length ? ` · ${followers.join(", ")}` : ""}
              </Text>
            ) : null}
          </FieldGroup>
        </>
      ) : null}
      {notice ? <InlineMessage>{notice}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirmation.dialog}
    </Disclosure>
  );
}
