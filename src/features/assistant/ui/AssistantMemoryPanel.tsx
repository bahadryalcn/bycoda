import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text, textAttributes } from "../../../shared/ui/Text";
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

/** The Host keeps up to 40 active rules; the count only matters near that limit. */
const RULE_LIMIT_NOTICE = 30;

/** Memory owns its readable collection; mutations retain the Room's Host and receipts. */
export function AssistantMemoryPanel(props: Props) {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.title}>
          <Heading size="page">{t("Memory")}</Heading>
          {props.ruleCount >= RULE_LIMIT_NOTICE && (
            <Badge size="xs" tone="warning">
              {t("Rules {p0}/40", { p0: props.ruleCount })}
            </Badge>
          )}
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
      <LiveText className="sr-only" text={props.searching ? t("Loading…") : ""} />
      {props.searchError}
      {!props.searching && !props.searchError && !props.entries.length && (
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
            <div className={styles.list}>
              {entries.map((entry) => (
                <ActionHost
                  as="article"
                  key={entry.id}
                  {...surfaceAttributes({ separator: "pane-block" }, styles.entry)}
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
                    <div
                      {...textAttributes(
                        { size: "caption", tone: "secondary", leading: "inherit" },
                        styles.meta,
                      )}
                    >
                      {/* Everywhere is the default; only a narrower scope is worth saying. */}
                      {entry.scope !== "all" && (
                        <>
                          <span>
                            {t(entry.scope === "voice" ? "Voice only" : "Coding sessions only")}
                          </span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      {/* The group title already says "Learned". */}
                      {(entry.source === "typed" || entry.source === "spoken") && (
                        <>
                          <span>{t(entry.source === "typed" ? "You wrote" : "You said")}</span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      <Timestamp className={styles.time} value={entry.createdAt} />
                    </div>
                    {entry.quote && entry.quote !== entry.text && (
                      <blockquote {...textAttributes({ leading: "normal" }, styles.quote)}>
                        {entry.quote}
                      </blockquote>
                    )}
                  </div>
                  <div className={styles.actions}>
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
                    <Switch
                      aria-label={t("Enable memory")}
                      aria-describedby={`assistant-memory-${entry.id}`}
                      checked={entry.active}
                      disabled={props.pending}
                      onCheckedChange={(active) => props.onToggle(entry, active)}
                    />
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
