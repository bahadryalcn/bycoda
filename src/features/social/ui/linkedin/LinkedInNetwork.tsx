import { useRef, useState } from "react";
import { openExternal } from "../../../../platform/tauri/openExternal";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

type Target = { platformId: string; url: string; name: string };
type NetworkAction =
  | "invite"
  | "accept"
  | "ignore"
  | "withdraw"
  | "follow"
  | "unfollow"
  | "join"
  | "post";

export function LinkedInNetwork({
  account,
  client,
  disabled,
}: {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
}) {
  const [list, setList] = useState("connections");
  const [action, setAction] = useState<NetworkAction>("invite");
  const [items, setItems] = useState<Target[]>();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [resultState, setResultState] = useState<
    "done" | "membership_pending" | "moderation_pending"
  >();
  const attempts = useRef(new Map<string, string>());
  const { error, is, write } = useAccountWrite(t("Could not save changes."));
  const confirm = useConfirm();
  const member = account.accountType === "member";
  const busy = is("read") || is("write") || is("open");
  const group = action === "join" || action === "post";
  const options = [
    { value: "invite", label: t("Send invitation") },
    { value: "accept", label: t("Accept invitation") },
    { value: "ignore", label: t("Ignore invitation") },
    { value: "withdraw", label: t("Withdraw invitation") },
    { value: "follow", label: t("Follow") },
    { value: "unfollow", label: t("Unfollow") },
    { value: "join", label: t("Join group") },
    { value: "post", label: t("Post in group") },
  ] as const;
  const read = () =>
    write("read", async () => {
      setResultState(undefined);
      if (list === "groups") {
        const result = await client.linkedInBrowserManage<{ groups: Target[] }>(account.id, {
          operation: "groups.list",
        });
        setItems(result.groups);
      } else {
        const result = await client.linkedInBrowserManage<{ people: Target[] }>(account.id, {
          operation: "network.list",
          kind: list,
        });
        setItems(result.people);
      }
    });
  const openInbox = () =>
    write("open", async () => {
      const result = await client.linkedInBrowserManage<{ url: string }>(account.id, {
        operation: "inbox.destination",
      });
      await openExternal(result.url);
    });
  const target = URL.parse(url.trim());
  const id =
    target?.origin === "https://www.linkedin.com"
      ? (group ? /^\/groups\/([1-9]\d{0,19})\/?$/ : /^\/in\/([\w-]{1,100})\/?$/).exec(
          target.pathname,
        )?.[1]
      : undefined;
  const submit = async () => {
    if (!id || (action === "post" && !text.trim())) return;
    await confirm.confirm({
      title: options.find((option) => option.value === action)?.label ?? t("Confirm"),
      message: [account.name, url, action === "post" ? text : null].filter(Boolean).join("\n"),
      confirmLabel: t("Confirm"),
      onConfirm: async () => {
        await write("write", async () => {
          setResultState(undefined);
          const key = JSON.stringify([action, id, action === "post" ? text.trim() : undefined]);
          const requestId = attempts.current.get(key) ?? crypto.randomUUID();
          attempts.current.set(key, requestId);
          const result = await client.linkedInBrowserManage<{ status?: string }>(account.id, {
            operation: group ? "groups.write" : "network.write",
            kind: action,
            ...(group
              ? { groupId: `web:linkedin:group:${id}`, ...(action === "post" ? { text } : {}) }
              : { targetId: `web:linkedin:in:${id.toLowerCase()}` }),
            confirm: "CONFIRM_LINKEDIN_BROWSER_WRITE",
            requestId,
          });
          setResultState(
            result.status === "membership_pending" || result.status === "moderation_pending"
              ? result.status
              : "done",
          );
        });
      },
    });
  };
  return (
    <Disclosure summary={member ? t("Connections") : t("Inbox")} variant="row">
      <FieldGroup variant="bare" disabled={disabled || busy}>
        {member ? (
          <>
            <Select
              label={t("Connections")}
              value={list}
              options={[
                { value: "connections", label: t("Connections") },
                { value: "invitations.received", label: t("Received invitations") },
                { value: "invitations.sent", label: t("Sent invitations") },
                { value: "groups", label: t("Groups") },
              ]}
              onValueChange={(value) => {
                setList(value);
                setItems(undefined);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={is("read")}
              onClick={() => void read().catch(() => undefined)}
            >
              {t("Refresh")}
            </Button>
            {items ? (
              <FieldGroup legend={t("Visible results")} layout="row">
                {items.map((item) => (
                  <Button
                    key={item.platformId}
                    variant="ghost"
                    size="sm"
                    onClick={() => setUrl(item.url)}
                  >
                    {item.name}
                  </Button>
                ))}
                {!items.length ? <Text as="p">{t("No results")}</Text> : null}
              </FieldGroup>
            ) : null}
            <Select
              label={t("Action")}
              value={action}
              options={[...options]}
              onValueChange={(value) => {
                const option = options.find((option) => option.value === value);
                if (option) setAction(option.value);
              }}
            />
            <TextField
              label={group ? t("LinkedIn group URL") : t("LinkedIn profile URL")}
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setResultState(undefined);
              }}
            />
            {action === "post" ? (
              <TextareaField
                label={t("Post text")}
                value={text}
                maxLength={3000}
                onChange={(event) => setText(event.target.value)}
              />
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={!id || (action === "post" && !text.trim())}
              loading={is("write")}
              onClick={() => void submit().catch(() => undefined)}
            >
              {t("Review change")}
            </Button>
          </>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void openInbox().catch(() => undefined)}
        >
          {t("Open LinkedIn inbox")}
        </Button>
      </FieldGroup>
      {resultState ? (
        <Text as="p">{resultState === "done" ? t("Done") : t("Pending review")}</Text>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirm.dialog}
    </Disclosure>
  );
}
