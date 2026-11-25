import { useState } from "react";
import { formatNumber, t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Lock } from "../../../../../shared/ui/icons";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { Tooltip } from "../../../../../shared/ui/Tooltip";
import { isXResourceId } from "../../../../../integrations/social/adapters/x-identifiers";
import type {
  getXListMembers,
  getXOwnedLists,
} from "../../../../../integrations/social/adapters/x-relationships";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { useXApply } from "./XApply";
import "./x.css";

type Lists = Awaited<ReturnType<typeof getXOwnedLists>>;
type List = Lists["items"][number];
type Members = Awaited<ReturnType<typeof getXListMembers>>;

type Props = {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
};

/** Your X lists: pick a list, then rename it, delete it or manage its members. */
export function XListActions({ account, client, disabled }: Props) {
  const [lists, setLists] = useState<Lists>();
  const [members, setMembers] = useState<{ list: List; page: Members }>();
  const [renaming, setRenaming] = useState<{ id: string; name: string }>();
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const read = useAccountWrite(t("Could not load data."));
  const x = useXApply(account, client);
  const busy = disabled || x.busy;
  const loadLists = () =>
    read.write("lists", async () => {
      setLists(await client.request<Lists>("x.lists", { accountId: account.id }));
    });
  const loadMembers = (list: List) =>
    read.write("members", async () => {
      const page = await client.request<Members>("x.lists", {
        accountId: account.id,
        listId: list.id,
      });
      setMembers({ list, page });
    });
  const create = async () => {
    const done = await x.apply({
      kind: "createList",
      title: t("Create list"),
      details: name.trim(),
      fields: { name: name.trim() },
    });
    if (!done) return;
    setName("");
    await loadLists();
  };
  const rename = async (list: List, next: string) => {
    const done = await x.apply({
      kind: "updateList",
      title: t("Edit list"),
      details: `${list.name} · ${next}`,
      fields: { listId: list.id, name: next },
    });
    if (!done) return;
    setRenaming(undefined);
    await loadLists();
  };
  const remove = async (list: List) => {
    const done = await x.apply({
      kind: "deleteList",
      title: t("Delete list"),
      details: list.name,
      fields: { listId: list.id },
      danger: true,
    });
    if (!done) return;
    setMembers((current) => (current?.list.id === list.id ? undefined : current));
    await loadLists();
  };
  const addMember = async (list: List) => {
    const done = await x.apply({
      kind: "addListMember",
      title: t("Add list member"),
      details: `${list.name} · ${userId.trim()}`,
      fields: { listId: list.id, userId: userId.trim() },
    });
    if (!done) return;
    setUserId("");
    await loadMembers(list);
  };
  const removeMember = async (list: List, member: Members["items"][number]) => {
    const done = await x.apply({
      kind: "removeListMember",
      title: t("Remove list member"),
      details: `${list.name} · @${member.username}`,
      fields: { listId: list.id, userId: member.id },
      danger: true,
    });
    if (done) await loadMembers(list);
  };
  return (
    <div className="social-x-group">
      <SectionLabel variant="inline" size="secondary" as="h4">
        {t("X lists")}
      </SectionLabel>
      <div className="social-x-toolbar">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          loading={read.is("lists")}
          onClick={() => void loadLists().catch(() => undefined)}
        >
          {lists ? t("Refresh") : t("Load my lists")}
        </Button>
      </div>
      {!lists && read.is("lists") ? <LoadingText>{t("Loading…")}</LoadingText> : null}
      {lists && !lists.items.length ? (
        <EmptyState size="inline" description={t("You have no X lists yet.")} />
      ) : null}
      {lists?.items.length ? (
        <ul className="social-x-list">
          {lists.items.map((list) => (
            <Surface key={list.id} as="li" variant="card" padding="sm" className="social-x-item">
              <div className="social-x-item-head">
                <Text as="span" weight="medium" className="social-x-item-title">
                  {list.name}
                </Text>
                <span className="social-x-actions">
                  {list.private ? (
                    <Tooltip label={t("Private")}>
                      <Lock className="icon-sm" tone="muted" aria-label={t("Private")} />
                    </Tooltip>
                  ) : null}
                  {list.memberCount !== undefined ? (
                    <Text as="span" size="caption" tone="muted">
                      {t("{p0} members", {
                        p0: formatNumber(list.memberCount),
                      })}
                    </Text>
                  ) : null}
                </span>
              </div>
              {list.description ? (
                <Text as="p" size="secondary" tone="muted">
                  {list.description}
                </Text>
              ) : null}
              {renaming?.id === list.id ? (
                <div className="social-x-toolbar">
                  <TextField
                    label={t("Name")}
                    value={renaming.name}
                    maxLength={25}
                    disabled={busy}
                    onChange={(event) =>
                      setRenaming({
                        id: list.id,
                        name: event.currentTarget.value,
                      })
                    }
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || !renaming.name.trim() || renaming.name.trim() === list.name}
                    onClick={() => void rename(list, renaming.name.trim()).catch(() => undefined)}
                  >
                    {t("Review")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenaming(undefined)}>
                    {t("Cancel")}
                  </Button>
                </div>
              ) : (
                <div className="social-x-actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    loading={read.is("members") && members?.list.id !== list.id}
                    onClick={() => void loadMembers(list).catch(() => undefined)}
                  >
                    {t("Members")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setRenaming({ id: list.id, name: list.name })}
                  >
                    {t("Edit list")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    tone="danger"
                    disabled={busy}
                    onClick={() => void remove(list).catch(() => undefined)}
                  >
                    {t("Delete list")}
                  </Button>
                </div>
              )}
              {members?.list.id === list.id ? (
                <div className="social-x-group">
                  <SectionLabel variant="inline" size="secondary" as="h4">
                    {t("Members")}
                  </SectionLabel>
                  {!members.page.items.length ? (
                    <EmptyState size="inline" description={t("This list has no members yet.")} />
                  ) : (
                    <ul className="social-x-list">
                      {members.page.items.map((member) => (
                        <li key={member.id} className="social-x-item-head">
                          <Text as="span" className="social-x-item-title">
                            {member.name}{" "}
                            <Text as="span" tone="muted">
                              @{member.username}
                            </Text>
                          </Text>
                          <Button
                            size="sm"
                            variant="ghost"
                            tone="danger"
                            disabled={busy}
                            onClick={() => void removeMember(list, member).catch(() => undefined)}
                          >
                            {t("Remove list member")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="social-x-toolbar">
                    <TextField
                      label={t("User ID")}
                      description={t("The numeric ID of the account, not its @username.")}
                      inputMode="numeric"
                      value={userId}
                      disabled={busy}
                      onChange={(event) => setUserId(event.currentTarget.value)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !isXResourceId(userId.trim())}
                      onClick={() => void addMember(list).catch(() => undefined)}
                    >
                      {t("Add list member")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Surface>
          ))}
        </ul>
      ) : null}
      <div className="social-x-toolbar">
        <TextField
          label={t("New list name")}
          value={name}
          maxLength={25}
          disabled={busy}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || !name.trim()}
          onClick={() => void create().catch(() => undefined)}
        >
          {t("Create list")}
        </Button>
      </div>
      {read.error ? <InlineError details={read.details}>{read.error}</InlineError> : null}
      {x.error ? <InlineError details={x.details}>{x.error}</InlineError> : null}
      {x.notice ? (
        <Text as="p" size="caption" tone="muted">
          {x.notice}
        </Text>
      ) : null}
      {x.dialog}
    </div>
  );
}
