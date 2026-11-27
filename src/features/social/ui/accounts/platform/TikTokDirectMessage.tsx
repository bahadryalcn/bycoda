import { accountBlockedReason } from "../blockedReason";
import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Select } from "../../../../../shared/ui/Select";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import type { HostProject } from "../../../../connections/public/protocol";
import type {
  SocialAccount,
  SocialContact,
  SocialDraft,
  SocialJob,
  SocialJobsPage,
} from "../../../model/social";
import { useAccountWrite } from "../useAccountWrite";
import "./tiktok.css";
import type { TikTokPanelProps } from "./TikTokAccountTools";

export function TikTokDirectMessage({
  client,
  accountId,
  disabled,
  account,
  projects,
  onChanged,
}: TikTokPanelProps & {
  account: SocialAccount;
  projects: HostProject[];
  onChanged(): void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const { write, is, failureTitle, details } = useAccountWrite(
    t("Could not prepare the TikTok message."),
  );
  const [project, setProject] = useState("");
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<SocialDraft>();
  const [attempted, setAttempted] = useState(false);
  const [job, setJob] = useState<SocialJob>();
  const [requests, setRequests] = useState(() => ({
    contact: crypto.randomUUID(),
    draft: crypto.randomUUID(),
    approve: crypto.randomUUID(),
    send: crypto.randomUUID(),
  }));
  const available = projects.filter(({ id }) =>
    ["draft", "message"].every((permission) =>
      account.grants[id]?.some((grant) => grant === permission),
    ),
  );
  const projectId = available.some(({ id }) => id === project) ? project : available[0]?.id;
  const busy = is("draft") || is("send") || is("check");
  const valid = !!projectId && /^[a-z0-9_.]{2,24}$/.test(username) && !!message.trim();
  const edit = () => {
    setDraft(undefined);
    setJob(undefined);
    setAttempted(false);
    setRequests({
      contact: crypto.randomUUID(),
      draft: crypto.randomUUID(),
      approve: crypto.randomUUID(),
      send: crypto.randomUUID(),
    });
  };
  const prepare = async () => {
    if (!projectId) return;
    const next = await write("draft", async () => {
      const platformId = `web:tiktok:${username}`;
      const previous = (
        await client.request<SocialContact[]>("contacts.search", {
          query: platformId,
        })
      ).find((contact) => contact.accountId === accountId && contact.platformId === platformId);
      const recipient = previous?.projectIds.includes(projectId)
        ? previous
        : await client.request<SocialContact>(
            "contacts.upsert",
            {
              accountId,
              platformId,
              name: previous?.name ?? `@${username}`,
              profileUrl: previous?.profileUrl ?? `https://www.tiktok.com/@${username}`,
              projectIds: [...new Set([...(previous?.projectIds ?? []), projectId])],
            },
            requests.contact,
          );
      return await client.request<SocialDraft>(
        "messages.draft",
        {
          accountId,
          contactId: recipient.id,
          projectId,
          text: message.trim(),
          factIds: [],
        },
        requests.draft,
      );
    });
    if (next) setDraft(next);
  };
  const check = async () => {
    const result = await write("check", async () => {
      if (job) return await client.request<SocialJob>("jobs.status", { id: job.id });
      const page = await client.request<SocialJobsPage>("jobs.status", {
        page: true,
        offset: 0,
        limit: 100,
      });
      return page.jobs.find((current) => current.draftId === draft?.id);
    });
    if (result) setJob(result);
  };
  const send = async () => {
    if (!draft) return;
    await confirm.confirm({
      title: t("Send TikTok message"),
      message: t("Review the exact changes before confirming."),
      context: account.name,
      details: (
        <DescriptionList size="sm">
          <DescriptionItem term={t("Username")}>@{username}</DescriptionItem>
          <DescriptionItem term={t("Message")}>{draft.text}</DescriptionItem>
        </DescriptionList>
      ),
      confirmLabel: t("Send message"),
      danger: false,
      onConfirm: async () => {
        const queued = await write("send", async () => {
          await client.request(
            "drafts.approve",
            { id: draft.id, reviewedDraft: draft },
            requests.approve,
          );
          setAttempted(true);
          return await client.request<SocialJob>("messages.send", { id: draft.id }, requests.send);
        });
        if (queued) {
          setJob(queued);
          onChanged();
        }
      },
    });
  };

  return (
    <div className="tiktok-panel">
      <SectionLabel as="h3">{t("New direct message")}</SectionLabel>
      {!available.length && (
        <InlineMessage tone="info">
          {t("Choose a project with permission to message from this account.")}
        </InlineMessage>
      )}
      <form
        className="tiktok-panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !disabled && !busy && !draft && !attempted) prepare().catch(() => undefined);
        }}
      >
        <div className="tiktok-grid">
          <Select
            label={t("Project")}
            value={projectId}
            disabled={disabled || busy || !!draft || !available.length}
            options={available.map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
            onValueChange={(value) => {
              setProject(value);
              edit();
            }}
          />
          <TextField
            label={t("Username")}
            value={username}
            disabled={disabled || busy || !!draft}
            maxLength={24}
            required
            pattern="[a-z0-9_.]{2,24}"
            onChange={(event) => {
              setUsername(event.currentTarget.value.toLowerCase());
              edit();
            }}
          />
        </div>
        <TextareaField
          label={t("Message")}
          value={message}
          disabled={disabled || busy || !!draft}
          maxLength={500}
          required
          rows={3}
          onChange={(event) => {
            setMessage(event.currentTarget.value);
            edit();
          }}
        />
        <div className="tiktok-actions">
          {!draft && (
            <Button
              size="sm"
              type="submit"
              variant="secondary"
              disabled={disabled || busy || !valid}
              disabledReason={
                disabled || busy
                  ? accountBlockedReason(disabled)
                  : !projectId
                    ? t("Choose a project first.")
                    : t("Fill in the fields above.")
              }
              loading={is("draft")}
            >
              {t("Prepare message")}
            </Button>
          )}
          {draft && !attempted && (
            <Button
              size="sm"
              variant="primary"
              disabled={disabled || busy}
              disabledReason={accountBlockedReason(disabled)}
              loading={is("send")}
              onClick={() => send().catch(() => undefined)}
            >
              {t("Review and send")}
            </Button>
          )}
          {draft && !attempted && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={edit}>
              {t("Edit draft")}
            </Button>
          )}
          {attempted && (
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled || busy}
              disabledReason={accountBlockedReason(disabled)}
              loading={is("check")}
              onClick={() => check().catch(() => undefined)}
            >
              {t("Check message status")}
            </Button>
          )}
        </div>
      </form>
      {attempted && !job && (
        <InlineMessage tone="warning">
          {t("TikTok did not confirm this change. Check its current state before trying again.")}
        </InlineMessage>
      )}
      {job && (
        <InlineMessage tone={job.status === "succeeded" ? "success" : "info"}>
          {job.status === "succeeded"
            ? t("Message sent")
            : job.status === "queued" || job.status === "running"
              ? t("Message queued")
              : t("Check TikTok")}
        </InlineMessage>
      )}
      {job?.status === "succeeded" && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          disabled={disabled || busy}
          disabledReason={accountBlockedReason(disabled)}
          onClick={() => {
            setMessage("");
            edit();
          }}
        >
          {t("New message")}
        </Button>
      )}
      {failureTitle && <InlineError details={details}>{failureTitle}</InlineError>}
      {confirm.dialog}
    </div>
  );
}
