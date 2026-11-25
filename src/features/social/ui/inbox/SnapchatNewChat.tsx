import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialAccount, SocialDraft, SocialJob } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useSocialPending } from "../../hooks/useSocialPending";
import { StatusText } from "../common/StatusText";

type PendingChat = { requestId: string; accountId: string; username: string; text: string };
type FriendPage = { usernames: string[]; partial: boolean };

export function SnapchatNewChat({
  client,
  accounts,
  projectId,
  enabled,
}: {
  client: SocialClient;
  accounts: SocialAccount[];
  projectId: string;
  enabled: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [username, setUsername] = useState("");
  const [text, setText] = useState("");
  const [operation, setOperation] = useState<PendingChat>();
  const [job, setJob] = useState<SocialJob>();
  const [problem, setProblem] = useState<{ title: string; details?: string }>();
  const [friends, setFriends] = useState<{ key: string; page: FriendPage }>();
  const pending = useSocialPending();
  const confirmation = useConfirm();
  const account = accounts.find((item) => item.id === selected) ?? accounts[0];
  if (!account) return null;
  const busy = pending.is("message") || pending.is("friends");
  const editable = !operation && !busy;
  const friendKey = JSON.stringify([account.id, account.platformId, account.executorId]);
  const friendPage = friends?.key === friendKey ? friends.page : undefined;
  const readFriends = async () => {
    setProblem(undefined);
    try {
      await pending.run("friends", async () => {
        const page = await client.request<FriendPage>("snapchat.friends.list", {
          accountId: account.id,
        });
        setFriends({ key: friendKey, page });
      });
    } catch (cause) {
      setProblem({
        title: t("Could not load Snapchat friends."),
        details: cause instanceof Error ? cause.message : undefined,
      });
    }
  };
  const eligible = /^[a-z][\w.-]{1,30}$/i.test(username.trim().replace(/^@/, "")) && !!text.trim();
  const payload = operation ?? {
    accountId: account.id,
    username: username.trim(),
    text: text.trim(),
  };
  const confirmRequest = {
    title: t("Start a Snapchat chat?"),
    message: `@${payload.username.replace(/^@/, "")} · ${accounts.find((item) => item.id === payload.accountId)?.name ?? account.name}`,
    details: [payload.text],
    confirmLabel: t("Send message"),
    onConfirm: async () => {
      if (!enabled || !eligible || !accounts.some((item) => item.id === payload.accountId)) return;
      await pending.run("message", async () => {
        const requestId = operation?.requestId ?? crypto.randomUUID();
        setOperation({ ...payload, requestId });
        setProblem(undefined);
        setJob(undefined);
        try {
          const draft = await client.request<SocialDraft>(
            "snapchat.chat.draft",
            {
              accountId: payload.accountId,
              projectId,
              username: payload.username,
              text: payload.text,
            },
            `${requestId}:draft`,
          );
          await client.request(
            "drafts.approve",
            {
              id: draft.id,
              reviewedDraft: draft,
            },
            `${requestId}:approve`,
          );
          const queued = await client.request<SocialJob>(
            "messages.send",
            { id: draft.id },
            `${requestId}:send`,
          );
          setJob(queued);
          setOperation(undefined);
          setText("");
        } catch (cause) {
          setProblem({
            title: t("Could not queue the Snapchat message."),
            details: cause instanceof Error ? cause.message : undefined,
          });
        }
      });
    },
  };
  return (
    <Disclosure summary={t("New Snapchat chat")} variant="row">
      <div className="inbox-new-chat">
        <Select
          label={t("Account")}
          options={accounts.map((item) => ({ value: item.id, label: item.name }))}
          value={account.id}
          onValueChange={setSelected}
          disabled={!editable}
        />
        <div>
          <Button
            variant="secondary"
            loading={pending.is("friends")}
            disabled={!editable}
            disabledReason={
              operation
                ? t("A message is waiting to be retried. Retry it first.")
                : t("Wait for the current action to finish.")
            }
            onClick={() => void readFriends().catch(() => undefined)}
          >
            {t("Read Snapchat friends")}
          </Button>
        </div>
        {friendPage?.usernames.length ? (
          <Select
            label={t("Snapchat friends")}
            value={friendPage.usernames.includes(username) ? username : ""}
            options={[
              { value: "", label: t("Choose a friend"), disabled: true },
              ...friendPage.usernames.map((friend) => ({ value: friend, label: `@${friend}` })),
            ]}
            onValueChange={setUsername}
            disabled={!editable}
          />
        ) : friendPage && !friendPage.partial ? (
          <InlineMessage>{t("No Snapchat friends found.")}</InlineMessage>
        ) : null}
        {friendPage?.partial && (
          <InlineMessage>{t("Only visible Snapchat friends are shown.")}</InlineMessage>
        )}
        <Disclosure summary={t("Enter a username instead")} variant="plain">
          <TextField
            label={t("Friend’s Snapchat username")}
            value={username}
            disabled={!editable}
            onChange={(event) => setUsername(event.currentTarget.value)}
          />
        </Disclosure>
        <TextareaField
          label={t("Message")}
          value={text}
          disabled={!editable}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <Button
          disabled={!enabled || !eligible || busy}
          disabledReason={
            busy
              ? t("Wait for the current action to finish.")
              : !enabled
                ? t("Sending is turned off.")
                : t("Enter a valid Snapchat username and a message first.")
          }
          onClick={() => void confirmation.confirm(confirmRequest).catch(() => undefined)}
        >
          {operation ? t("Retry same message") : t("Send message")}
        </Button>
        {problem && <InlineError details={problem.details}>{problem.title}</InlineError>}
        {job && <StatusText status={job.status} />}
        {confirmation.renderDialog(confirmRequest)}
      </div>
    </Disclosure>
  );
}
