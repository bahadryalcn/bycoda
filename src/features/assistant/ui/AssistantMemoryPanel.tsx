import type { ReactNode } from "react";
import type { AssistantMemory } from "../../../shared/model/host-contracts/assistant";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { LiveText } from "../../../shared/ui/LiveText";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Surface } from "../../../shared/ui/Surface";
import { Switch } from "../../../shared/ui/Switch";
import { Plus, Trash2 } from "../../../shared/ui/icons";
import styles from "./AssistantMemoryPanel.module.css";

type Props = {
  entries: AssistantMemory[];
  ruleCount: number;
  query: string;
  searching: boolean;
  pending: boolean;
  searchError: ReactNode;
  errorFor: (id: string) => ReactNode;
  date: (value: number) => string;
  onQuery: (value: string) => void;
  onAdd: () => void;
  onEdit: (entry: AssistantMemory) => void;
  onToggle: (entry: AssistantMemory, active: boolean) => void;
  onDelete: (entry: AssistantMemory) => void;
};

/** Memory owns its readable collection; mutations retain the Room's Host and receipts. */
export function AssistantMemoryPanel(props: Props) {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.title}>
          <h2>{t("Memory")}</h2>
          <span className={styles.metadata}>{t("Rules {p0}/40", { p0: props.ruleCount })}</span>
        </div>
        <Button startIcon={<Plus className="icon-sm" />} onClick={props.onAdd}>
          {t("Add memory")}
        </Button>
      </header>
      <SearchInput
        type="search"
        appearance="field"
        containerClassName={styles.search}
        aria-label={t("Search this section")}
        placeholder={t("Search")}
        value={props.query}
        onChange={(event) => props.onQuery(event.currentTarget.value)}
      />
      <LiveText className={styles.metadata} text={props.searching ? t("Loading...") : ""} />
      {props.searchError}
      {!props.searching && !props.entries.length && (
        <Surface variant="outline" padding="lg" className={styles.empty}>
          <p>{t(props.query.trim() ? "No results" : "Nothing saved here yet")}</p>
        </Surface>
      )}
      {(
        [
          ["rule", "Rules"],
          ["profile", "About me"],
          ["fact", "Learned"],
        ] as const
      ).map(([kind, label]) => {
        const entries = props.entries.filter((entry) => entry.kind === kind);
        if (!entries.length) return null;
        return (
          <section key={kind} className={styles.group} aria-label={t(label)}>
            <SectionLabel as="h3" count={entries.length}>
              {t(label)}
            </SectionLabel>
            <div className={styles.entries}>
              {entries.map((entry) => (
                <Surface
                  as="article"
                  variant="outline"
                  padding="lg"
                  key={entry.id}
                  className={styles.entry}
                  aria-label={entry.text}
                >
                  <div className={styles.text}>
                    <p className={styles.body} id={`assistant-memory-${entry.id}`}>
                      {entry.text}
                    </p>
                    <div className={styles.metadata}>
                      <span>
                        {t(
                          entry.scope === "all"
                            ? "Everywhere"
                            : entry.scope === "voice"
                              ? "Voice only"
                              : "Coding sessions only",
                        )}
                      </span>
                      <span>
                        {t(
                          entry.source === "typed"
                            ? "You wrote"
                            : entry.source === "spoken"
                              ? "You said"
                              : "Learned",
                        )}
                      </span>
                      <time>{props.date(entry.createdAt)}</time>
                    </div>
                    {entry.quote && entry.quote !== entry.text && (
                      <blockquote className={styles.quote}>{entry.quote}</blockquote>
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
                    <Button disabled={props.pending} onClick={() => props.onEdit(entry)}>
                      {t("Edit")}
                    </Button>
                    <Button
                      iconOnly
                      label={t("Delete memory")}
                      disabled={props.pending}
                      onClick={() => props.onDelete(entry)}
                    >
                      <Trash2 className="icon-sm" />
                    </Button>
                  </div>
                  <div className={styles.feedback}>{props.errorFor(entry.id)}</div>
                </Surface>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
