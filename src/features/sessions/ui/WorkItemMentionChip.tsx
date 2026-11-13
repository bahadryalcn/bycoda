import { createContext, useContext, useEffect, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { ExternalLink, Inbox } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { Spinner } from "../../../shared/ui/Spinner";
import { Text, textAttributes } from "../../../shared/ui/Text";
import { DraftToken } from "../../../shared/ui/DraftToken";
import { openExternal } from "../../../platform/tauri/openExternal";
import {
  InboxProviderMark,
  lookupWorkItemMention,
  parseWorkItemMentionToken,
  peekWorkItemMention,
  requestInboxItem,
  type InboxItem,
} from "../../inbox/public/workItemMentions";
import { workItemMentionMeta } from "./ComposerWorkItemMentionRow";
import styles from "./WorkItemMentionChip.module.css";

/** Project folder that transcript work-item chips resolve their tokens against. */
export const WorkItemMentionCwd = createContext<string | undefined>(undefined);

type Lookup = { item: InboxItem | null; done: boolean };

/** Details card for one `@alias:ref` token: title, owner, and ways to open the item. */
export function WorkItemMentionCard({
  token,
  cwd,
  anchor,
  onDismiss,
}: {
  token: string;
  cwd: string;
  anchor: HTMLElement;
  onDismiss: () => void;
}) {
  const t = useT();
  // One card per token: the chip remounts it under a new key if the token changes.
  const [lookup, setLookup] = useState<Lookup>(() => {
    const item = peekWorkItemMention(token, cwd);
    return { item, done: Boolean(item) };
  });
  const mention = parseWorkItemMentionToken(token);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- provider read held while the card is open; aborted on close.
  useEffect(() => {
    if (lookup.done) return;
    const abort = new AbortController();
    lookupWorkItemMention(token, cwd, abort.signal)
      .then((item) => {
        if (!abort.signal.aborted) setLookup({ item, done: true });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.warn("Work item mention lookup failed", error);
        setLookup({ item: null, done: true });
      });
    return () => abort.abort();
  }, [token, cwd, lookup.done]);
  const item = lookup.item;
  return (
    <Popover anchor={anchor} side="top" align="start" width={340} onDismiss={onDismiss}>
      <div className={styles.card}>
        <div className={styles.heading}>
          {mention ? (
            <InboxProviderMark provider={mention.provider} className="icon-sm shrink-0" />
          ) : null}
          <Text size="secondary" tone="secondary" truncate>
            {mention?.ref ?? token}
          </Text>
        </div>
        {item ? (
          <>
            <Text as="p" leading="inherit" className={styles.title}>
              {item.title}
            </Text>
            <Text as="p" size="caption" tone="secondary" truncate>
              {workItemMentionMeta(
                { kind: "item", provider: item.provider, item, token },
                t("Unassigned"),
              )}
            </Text>
            <div className={styles.actions}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onDismiss();
                  requestInboxItem(item);
                }}
              >
                <Inbox className="icon-sm" />
                {t("Show in Inbox")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  openExternal(item.url).catch((error: unknown) =>
                    console.error("Failed to open work item link:", error),
                  )
                }
              >
                <ExternalLink className="icon-sm" />
                {t("Open in browser")}
              </Button>
            </div>
          </>
        ) : lookup.done ? (
          <Text as="p" size="caption" tone="secondary">
            {t("This work item was not found in your connected trackers.")}
          </Text>
        ) : (
          <Text as="p" size="caption" tone="secondary" className={styles.pending}>
            <Spinner size="xs" />
            {t("Looking up work item…")}
          </Text>
        )}
      </div>
    </Popover>
  );
}

/** A sent `@jira:KEY` token: provider mark and ref; the alias stays in the DOM for copying. */
export function WorkItemMentionChip({ token }: { token: string }) {
  const cwd = useContext(WorkItemMentionCwd);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const mention = parseWorkItemMentionToken(token);
  if (!mention || !cwd) {
    if (mention) {
      return (
        <Badge
          size="xs"
          appearance="subtle"
          tone="accent"
          icon={<InboxProviderMark provider={mention.provider} />}
          data-work-item-mention=""
        >
          {token}
        </Badge>
      );
    }
    return (
      <Text size="inherit" tone="accent" data-work-item-mention="">
        {token}
      </Text>
    );
  }
  const alias = token.slice(0, token.length - mention.ref.length);
  return (
    <>
      <Button
        variant="link"
        layout="text"
        motion="none"
        type="button"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
      >
        <Badge
          size="xs"
          appearance="subtle"
          tone="accent"
          icon={<InboxProviderMark provider={mention.provider} />}
          data-work-item-mention=""
        >
          <span className="sr-only">{alias}</span>
          {mention.ref}
        </Badge>
      </Button>
      {anchor ? (
        <WorkItemMentionCard
          key={token}
          token={token}
          cwd={cwd}
          anchor={anchor}
          onDismiss={() => setAnchor(null)}
        />
      ) : null}
    </>
  );
}

/**
 * A `@jira:KEY` token in the draft overlay. The textarea underneath keeps the raw text,
 * so every character keeps its width: the tracker mark covers the transparent `@` and
 * opens the details card; the alias is muted and the ref keeps the mention ink.
 */
export function ComposerWorkItemToken({ token }: { token: string }) {
  const cwd = useContext(WorkItemMentionCwd);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const mention = parseWorkItemMentionToken(token);
  if (!mention)
    return (
      <Text size="inherit" tone="accent">
        {token}
      </Text>
    );
  const alias = token.slice(1, token.length - mention.ref.length);
  return (
    <DraftToken
      prefix="@"
      {...textAttributes({ tone: "accent" })}
      data-work-item-mention=""
      onIconClick={(event) => setAnchor(event.currentTarget)}
      icon={
        <span data-work-item-open="">
          <InboxProviderMark provider={mention.provider} />
        </span>
      }
    >
      <Text as="span" size="inherit" tone="secondary">
        {alias}
      </Text>
      {mention.ref}
      {anchor && cwd ? (
        <WorkItemMentionCard
          key={token}
          token={token}
          cwd={cwd}
          anchor={anchor}
          onDismiss={() => setAnchor(null)}
        />
      ) : null}
    </DraftToken>
  );
}
