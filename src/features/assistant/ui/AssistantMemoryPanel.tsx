import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import type { AssistantMemory } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { LiveText } from "../../../shared/ui/LiveText";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Switch } from "../../../shared/ui/Switch";
import { Timestamp } from "../../../shared/ui/Timestamp";
import { Pencil, Plus, Trash2 } from "../../../shared/ui/icons";
import styles from "./AssistantMemoryPanel.module.css";

type Props = {
  entries: AssistantMemory[];
  ruleCount: number;
  query: string;
  searching: boolean;
  pending: boolean;
  searchError: ReactNode;
  errorFor: (id: string) => ReactNode;
  onQuery: (value: string) => void;
  onAdd: () => void;
  onEdit: (entry: AssistantMemory) => void;
  onToggle: (entry: AssistantMemory, active: boolean) => void;
  onDelete: (entry: AssistantMemory) => void;
};

const GROUPS = [
  ["rule", "Rules"],
  ["profile", "About me"],
  ["fact", "Learned"],
] as const;

/** Memory owns its readable collection; mutations retain the Room's Host and receipts. */
export function AssistantMemoryPanel(props: Props) {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.title}>
          <Heading size="page">{t("Memory")}</Heading>
          <Badge size="xs" tone="neutral">
            {t("Rules {p0}/40", { p0: props.ruleCount })}
          </Badge>
        </div>
        <SearchInput
          type="search"
          appearance="field"
          containerClassName={styles.search}
          aria-label={t("Search this section")}
          placeholder={t("Search")}
          value={props.query}
          onChange={(event) => props.onQuery(event.currentTarget.value)}
        />
        <Button
          className={styles.add}
          startIcon={<Plus className="icon-sm" />}
          onClick={props.onAdd}
        >
          {t("Add memory")}
        </Button>
      </header>
      <LiveText className="sr-only" text={props.searching ? t("Loading...") : ""} />
      {props.searchError}
      {!props.searching && !props.entries.length && (
        <EmptyState
          size="inline"
          kind={props.query.trim() ? "filtered" : "empty"}
          description={t(props.query.trim() ? "No results" : "Nothing saved here yet")}
        />
      )}
      {GROUPS.map(([kind, label]) => {
        const entries = props.entries.filter((entry) => entry.kind === kind);
        if (!entries.length) return null;
        return (
          <section key={kind} className={styles.group} aria-label={t(label)}>
            <SectionLabel as="h3" count={entries.length}>
              {t(label)}
            </SectionLabel>
            <div
              {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, styles.list)}
            >
              {entries.map((entry) => (
                <ActionHost
                  as="article"
                  key={entry.id}
                  className={styles.entry}
                  aria-label={entry.text}
                >
                  <div className={styles.text}>
                    <Text
                      as="p"
                      size="body"
                      tone="inherit"
                      weight="medium"
                      leading="normal"
                      className={styles.body}
                      id={`assistant-memory-${entry.id}`}
                    >
                      {entry.text}
                    </Text>
                    <Text
                      as="div"
                      size="caption"
                      tone="secondary"
                      leading="inherit"
                      className={styles.meta}
                    >
                      <span>
                        {t(
                          entry.scope === "all"
                            ? "Everywhere"
                            : entry.scope === "voice"
                              ? "Voice only"
                              : "Coding sessions only",
                        )}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {t(
                          entry.source === "typed"
                            ? "You wrote"
                            : entry.source === "spoken"
                              ? "You said"
                              : "Learned",
                        )}
                      </span>
                      <span aria-hidden>·</span>
                      <Timestamp className={styles.time} value={entry.createdAt} />
                    </Text>
                    {entry.quote && entry.quote !== entry.text && (
                      <Text as="blockquote" leading="normal" className={styles.quote}>
                        {entry.quote}
                      </Text>
                    )}
                  </div>
                  <div className={styles.actions}>
                    <Switch
                      aria-label={t("Enable memory")}
                      aria-describedby={`assistant-memory-${entry.id}`}
                      checked={entry.active}
                      disabled={props.pending}
                      onCheckedChange={(active) => props.onToggle(entry, active)}
                    />
                    <InlineAction
                      label={t("Edit")}
                      disabled={props.pending}
                      onClick={() => props.onEdit(entry)}
                    >
                      <Pencil className="icon-sm" />
                    </InlineAction>
                    <InlineAction
                      label={t("Delete memory")}
                      disabled={props.pending}
                      onClick={() => props.onDelete(entry)}
                    >
                      <Trash2 className="icon-sm" />
                    </InlineAction>
                  </div>
                  <div className={styles.feedback}>{props.errorFor(entry.id)}</div>
                </ActionHost>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
