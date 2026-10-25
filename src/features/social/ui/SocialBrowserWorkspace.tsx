import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useContext, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { useQueryVisible } from "../../../shared/hooks/useQueryVisible";
import type { SocialAccount } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";
import {
  SOCIAL_BROWSER_INTENTS,
  SOCIAL_BROWSER_LABELS,
  SOCIAL_BROWSER_SITES,
  type SocialBrowserIntent,
  type SocialBrowserWorkflow,
} from "../model/socialBrowser";
import { SocialPanelActiveContext } from "./socialContext";
import { XProfileManager } from "./XProfileManager";

const statuses: Record<SocialBrowserWorkflow["status"], string> = {
  get queued() {
    return t("Waiting for the browser queue");
  },
  get awaiting_owner() {
    return t("Waiting for your action in the browser");
  },
  get window_closed() {
    return t("Window closed; the result was not verified");
  },
  get cancelled() {
    return t("Cancelled");
  },
  get expired() {
    return t("Expired; open it again");
  },
  get interrupted() {
    return t("The host restarted; open it again");
  },
  get failed() {
    return t("Could not open; check the host connection");
  },
};

/** Owner-assisted work is shown separately from verified send and inbox adapters. */
export function SocialBrowserWorkspace({
  account,
  client,
}: {
  account: SocialAccount;
  client: SocialClient;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const active = useContext(SocialPanelActiveContext);
  const visible = useQueryVisible();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<SocialBrowserIntent>("login");
  const [target, setTarget] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: [...socialQueryScope(client), "browser-workflows", account.id],
    queryFn: () => client.browserWorkflowStatus(account.id),
    enabled: open && active && visible,
    retry: false,
    staleTime: 5_000,
    refetchInterval: (q) =>
      active &&
      visible &&
      q.state.data?.workflows.some((item) => ["queued", "awaiting_owner"].includes(item.status))
        ? 3_000
        : false,
  });
  const current = query.data?.workflows.find((item) =>
    ["queued", "awaiting_owner"].includes(item.status),
  );
  const monitor = useQuery({
    queryKey: [...socialQueryScope(client), "monitoring", account.id],
    queryFn: () => client.monitoringStatus(account.id),
    enabled: open && active && visible && account.connected,
    staleTime: 30_000,
    retry: false,
    refetchInterval: open && active && visible && account.connected ? 30_000 : false,
  });
  const options = SOCIAL_BROWSER_INTENTS.filter((value) =>
    value === "comments"
      ? ["x", "instagram", "facebook", "linkedin", "youtube", "tiktok"].includes(account.platform)
      : !!SOCIAL_BROWSER_SITES[account.platform].routes[value],
  ).map((value) => ({ value, label: SOCIAL_BROWSER_LABELS[value] }));
  const perform = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      await Promise.all([
        query.refetch({ throwOnError: true }),
        account.connected ? monitor.refetch({ throwOnError: true }) : Promise.resolve(),
      ]);
    } catch {
      setError(
        t(
          "The action could not be completed. Check the selected host and the open browser action, then try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const openBlocker = current
    ? t("A browser action is already in progress.")
    : !acknowledged
      ? t("Confirm the separate browser profile to continue.")
      : query.data && !query.data.available
        ? t("Chrome or Edge was not found on the selected host.")
        : intent === "comments" && !target.trim()
          ? t("Enter the post link to continue.")
          : "";
  return (
    <details
      className="social-connection"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("Browser workspace")}</summary>
      {account.platform === "x" && account.connection === "browser" && account.connected ? (
        <XProfileManager accountId={account.id} accountName={account.name} client={client} />
      ) : null}
      {monitor.data ? (
        <p role="status">
          {t("Automatic monitoring")}:{" "}
          {monitor.data.pollingEnabled === false
            ? t("Off")
            : monitor.data.accountActive === false
              ? t("Paused for this account")
              : {
                  idle: t("Not checked yet"),
                  healthy: t("Last check succeeded"),
                  partial: t("Partial monitoring; some channels could not be read"),
                  blocked: t("Monitoring blocked; check the connection"),
                }[monitor.data.status]}
          {monitor.data.checkedAt
            ? ` · ${new Date(monitor.data.checkedAt).toLocaleString(getLocale())}`
            : ""}
        </p>
      ) : null}
      {monitor.data?.coverage?.some((channel) => channel.reason === "chat_setup_required") ? (
        <p role="status">{t("X Chat needs access code setup in the browser.")}</p>
      ) : monitor.data?.coverage?.some(
          (channel) => channel.reason === "encrypted_chat_unsupported",
        ) ? (
        <p role="status">{t("X encrypted Chat cannot be read with this connection.")}</p>
      ) : null}
      {monitor.isError ? (
        <p role="alert">{t("Automatic monitoring status could not be read.")}</p>
      ) : null}
      {monitor.data?.coverage?.length ? (
        <p role="status">
          {monitor.data.coverage
            .map(
              (item) =>
                `${{ mentions: t("Mentions"), messages: t("Messages"), comments: t("Tweet comments") }[item.channel]}: ${item.status === "read" ? t("read") : t("could not be read")}`,
            )
            .join(" · ")}
        </p>
      ) : null}
      <p className="social-muted">
        {t(
          "This section is for sign-up and connection recovery. Connected accounts are monitored automatically on the host, and sending follows active publishing programs and reply rules.",
        )}
      </p>
      <Select
        label={t("Browser action")}
        value={intent}
        options={options}
        onValueChange={(value) => setIntent(value as SocialBrowserIntent)}
        disabled={socialLocked || busy || !!current}
      />
      {intent === "comments" ? (
        <TextField
          label={t("Post link")}
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          disabled={socialLocked || busy || !!current}
        />
      ) : null}
      <label className="social-inline-check">
        <Checkbox
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          disabled={socialLocked || busy}
        />
        {t("Open a separate browser profile for this account")}
      </label>
      {intent === "signup" ? (
        <p>
          {t(
            "Complete the terms, password, verification code and CAPTCHA steps in the browser that opens.",
          )}
        </p>
      ) : null}
      {account.platform === "whatsapp" || account.platform === "telegram" ? (
        <p className="social-muted">
          {t("New accounts are registered in the mobile app; this opens a web session.")}
        </p>
      ) : null}
      {!query.data?.available && query.data ? (
        <p role="status">{t("Chrome or Edge was not found on the selected host.")}</p>
      ) : null}
      {query.isError ? (
        <p role="alert">
          {t(
            "Browser status could not be read. Check the host version and connection, then refresh.",
          )}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {openBlocker ? <p className="social-muted">{openBlocker}</p> : null}
      <div className="social-actions">
        <Button
          loading={pendingUi.is("browser-workspace.open-in-browser")}
          type="button"
          disabled={
            socialLocked ||
            busy ||
            !!current ||
            !acknowledged ||
            !query.data?.available ||
            (intent === "comments" && !target.trim())
          }
          onClick={() =>
            void pendingUi.run("browser-workspace.open-in-browser", () =>
              perform(() =>
                client.browserWorkflowBegin(
                  account.id,
                  intent,
                  intent === "comments" ? target : undefined,
                ),
              ),
            )
          }
        >
          {t("Open in browser")}
        </Button>
        <Badge variant="label" appearance="outline">
          {t("Account: {p0}", { p0: account.name })}
        </Badge>
        <Button
          loading={pendingUi.is("browser-workspace.refresh-status")}
          type="button"
          variant="secondary"
          disabled={socialLocked || busy || query.isFetching}
          onClick={() =>
            void pendingUi.run("browser-workspace.refresh-status", () =>
              perform(async () => undefined),
            )
          }
        >
          {t("Refresh status")}
        </Button>
        {current ? (
          <Button
            loading={pendingUi.is("browser-workspace.cancel-action")}
            type="button"
            variant="secondary"
            tone="danger"
            className="ml-auto"
            disabled={socialLocked || busy}
            onClick={() =>
              void pendingUi.run("browser-workspace.cancel-action", () =>
                perform(() => client.browserWorkflowCancel(account.id)),
              )
            }
          >
            {t("Cancel action")}
          </Button>
        ) : null}
      </div>
      <div role="status" aria-live="polite">
        {query.data?.workflows[0] ? (
          <p>
            {SOCIAL_BROWSER_LABELS[query.data.workflows[0].intent]}:{" "}
            {statuses[query.data.workflows[0].status]}
          </p>
        ) : null}
      </div>
      {query.data && query.data.workflows.length > 1 ? (
        <details>
          <summary>{t("Previous browser actions")}</summary>
          <ul>
            {query.data.workflows.slice(1).map((item) => (
              <li key={item.id}>
                {SOCIAL_BROWSER_LABELS[item.intent]}: {statuses[item.status]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </details>
  );
}
