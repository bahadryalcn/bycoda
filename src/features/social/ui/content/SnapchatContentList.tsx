import { useState } from "react";
import type {
  SnapchatContentItem,
  SnapchatContentPage,
  SnapchatContentQuery,
  SnapchatContentTarget,
  SnapchatDeleteInput,
} from "../../../../integrations/social/snapchat-content";
import { formatDate, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { CollectionFooter } from "../../../../shared/ui/ContinuousList";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import type { Capability, SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";
import { snapchatAccountKey } from "../common/snapchatAccount";

type ListProps = {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  projectId?: string;
  disabled: boolean;
  executorMismatch?: boolean;
};

const labels: Record<SnapchatContentTarget, () => string> = {
  spotlight: () => t("Spotlight"),
  story: () => t("Public Stories"),
  saved_story: () => t("Saved Stories"),
};

const statusLabels: Record<NonNullable<SnapchatContentItem["status"]>, () => string> = {
  live: () => t("Live"),
  submitted: () => t("Submitted"),
  rejected: () => t("Rejected"),
};

function PublicationPage({
  client,
  account,
  disabled,
  canDelete,
  target,
  parent,
}: {
  client: SocialClient;
  account: SocialAccount;
  disabled: boolean;
  canDelete: boolean;
  target: SnapchatContentTarget;
  parent?: SnapchatContentItem;
}) {
  const [page, setPage] = useState<SnapchatContentPage>();
  const [uncertainId, setUncertainId] = useState<string>();
  const [selected, setSelected] = useState<SnapchatContentItem>();
  const confirmation = useConfirm();
  const { error, is, write } = useAccountWrite(t("Could not load posts."));
  const loading = is("read") || is("more");
  const busy = loading || is("delete");
  const read = async (cursor?: string) => {
    const query: SnapchatContentQuery = {
      target,
      ...(cursor ? { cursor } : {}),
      ...(parent ? { id: parent.id, createdAt: parent.createdAt, endedAt: parent.endedAt } : {}),
    };
    const next = await client.request<SnapchatContentPage>("snapchat.content.list", {
      accountId: account.id,
      ...query,
    });
    setPage((current) => ({
      items:
        cursor && current
          ? [...new Map([...current.items, ...next.items].map((item) => [item.id, item])).values()]
          : next.items,
      cursor: next.cursor === cursor ? undefined : next.cursor,
      partial: next.partial || (cursor !== undefined && current?.partial === true),
    }));
    if (cursor === undefined && !next.partial && !next.cursor) setUncertainId(undefined);
  };
  const requestPage = (cursor?: string) => write(cursor ? "more" : "read", () => read(cursor));
  const deleteRequest = (item: SnapchatContentItem) => ({
    title: t("Delete this Snapchat publication?"),
    message: item.title || item.caption || labels[target](),
    context: account.name,
    details: item.id,
    requireText: { text: item.id, caseSensitive: true },
    confirmLabel: t("Delete"),
    danger: true,
    onConfirm: async () => {
      if (disabled || busy || !canDelete || uncertainId || target === "story")
        throw new Error(t("Action unavailable."));
      await write("delete", async () => {
        const input: SnapchatDeleteInput = { target, id: item.id, confirmId: item.id };
        setUncertainId(item.id);
        await client.request<{ target: SnapchatDeleteInput["target"]; id: string }>(
          "snapchat.content.delete",
          {
            accountId: account.id,
            ...input,
          },
        );
        setPage(
          (current) =>
            current && { ...current, items: current.items.filter((row) => row.id !== item.id) },
        );
        setUncertainId(undefined);
      });
    },
  });
  const remove = async (item: SnapchatContentItem) => {
    setSelected(item);
    try {
      await confirmation.confirm(deleteRequest(item));
    } finally {
      setSelected(undefined);
    }
  };
  return (
    <>
      <div className="social-field-row">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || busy}
          loading={is("read")}
          onClick={() => void requestPage().catch(() => undefined)}
        >
          {page ? t("Refresh") : t("Read publications")}
        </Button>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
      {uncertainId ? (
        <InlineMessage tone="warning">
          {t("Snapchat outcome uncertain. Check the account before trying again.")}
        </InlineMessage>
      ) : null}
      {!loading && !error && page?.items.length === 0 && !page.partial && !page.cursor ? (
        <EmptyState size="inline" context="list" title={t("No Snapchat publications found.")} />
      ) : null}
      {page?.items.map((item) => (
        <Disclosure key={item.id} variant="row" summary={item.title || item.caption || item.id}>
          <div className="social-card">
            <Text as="p" size="secondary" wrap="anywhere">
              {item.id}
            </Text>
            {item.createdAt && Number.isFinite(Date.parse(item.createdAt)) ? (
              <Text as="p" size="secondary">
                {formatDate(Date.parse(item.createdAt))}
              </Text>
            ) : null}
            {item.status ? (
              <Text as="p" size="secondary">
                {statusLabels[item.status]()}
              </Text>
            ) : null}
            {!parent && target !== "spotlight" ? (
              <PublicationPage
                key={JSON.stringify([item.id, item.createdAt, item.endedAt])}
                client={client}
                account={account}
                disabled={disabled}
                canDelete={false}
                target={target}
                parent={item}
              />
            ) : null}
            {!parent && target !== "story" ? (
              <div className="social-field-row">
                <Button
                  variant="secondary"
                  tone="danger"
                  size="sm"
                  disabled={disabled || busy || !canDelete || !!uncertainId}
                  onClick={() => void remove(item).catch(() => undefined)}
                >
                  {t("Delete")}
                </Button>
              </div>
            ) : null}
          </div>
        </Disclosure>
      ))}
      <CollectionFooter
        hasMore={!!page?.cursor && !disabled}
        loading={is("more")}
        partial={page?.partial ? t("Some Snapchat results are unavailable.") : undefined}
        onLoadMore={() => {
          if (!busy && page?.cursor) void requestPage(page.cursor).catch(() => undefined);
        }}
      />
      {selected ? confirmation.renderDialog(deleteRequest(selected)) : null}
    </>
  );
}

function AccountPublications({
  client,
  account,
  capabilities,
  projectId,
  disabled,
  executorMismatch,
}: ListProps) {
  const [target, setTarget] = useState<SnapchatContentTarget>("spotlight");
  const read = capabilities.find((item) => item.operation === "profile.read");
  const deletion = capabilities.find((item) => item.operation === "delete");
  const canRead = account.connection !== "browser" && read?.status === "available";
  const canDelete =
    !account.paused &&
    deletion?.status === "available" &&
    (!projectId || !!account.grants[projectId]?.includes("publish"));
  return (
    <>
      {executorMismatch ? (
        <InlineMessage tone="warning">
          {t("This account is connected on another computer.")}
        </InlineMessage>
      ) : null}
      {!canRead ? (
        <InlineMessage tone="warning">
          {account.connection === "browser"
            ? t("Connect Snapchat with the Public Profile API.")
            : read?.reason || t("Connection needed")}
        </InlineMessage>
      ) : (
        <>
          <Select
            label={t("Format")}
            value={target}
            disabled={disabled}
            onValueChange={(value) => setTarget(value as SnapchatContentTarget)}
            options={(Object.keys(labels) as SnapchatContentTarget[]).map((item) => ({
              value: item,
              label: labels[item](),
            }))}
          />
          {!canDelete && target !== "story" ? (
            <Text as="p" size="secondary" tone="muted">
              {t("This account cannot delete publications here.")}
            </Text>
          ) : null}
          <PublicationPage
            key={target}
            client={client}
            account={account}
            disabled={disabled}
            canDelete={canDelete}
            target={target}
          />
        </>
      )}
    </>
  );
}

export function SnapchatContentList({
  client,
  accounts,
  capabilities,
  executorId,
  projectId,
  disabled,
}: {
  client: SocialClient;
  accounts: SocialAccount[];
  capabilities: Record<string, Capability[]>;
  executorId: string;
  projectId?: string;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState("");
  const account =
    accounts.find((item) => item.id === selected) ??
    accounts.find((item) => item.connection !== "browser") ??
    accounts[0];
  if (!account) return null;
  return (
    <Disclosure summary={t("Snapchat publications")} variant="row">
      <div className="social-card">
        {accounts.length > 1 ? (
          <Select
            label={t("Account")}
            value={account.id}
            onValueChange={setSelected}
            disabled={disabled}
            options={accounts.map((item) => ({ value: item.id, label: item.name }))}
          />
        ) : null}
        <AccountPublications
          key={snapchatAccountKey(client, account)}
          client={client}
          account={account}
          capabilities={capabilities[account.id] ?? []}
          projectId={projectId}
          disabled={disabled || account.executorId !== executorId}
          executorMismatch={account.executorId !== executorId}
        />
      </div>
    </Disclosure>
  );
}
