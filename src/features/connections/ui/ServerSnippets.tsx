import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { Heading } from "../../../shared/ui/Heading";
import { copyText } from "../../../platform/tauri/clipboard";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { isSingleLineCommand } from "../../terminal/model/terminalSuggestions";
import {
  insertSshSnippet,
  loadSshSnippets,
  saveSshSnippet,
  subscribeSshSnippets,
  type SshSnippet,
} from "../model/sshSnippets";

type ServerSnippetsProps = {
  serverId: string;
  serverName?: string;
  /** Supply only when a verified remote prompt/echo capability permits insertion. */
  onInsert?: (text: string) => Promise<void>;
  embedded?: boolean;
};

/** Explicit, target-bound command insertion. Nothing runs when mounted/restored.
 * The form is keyed by server so draft state never leaks across targets. */
export function ServerSnippets(props: ServerSnippetsProps) {
  return <ServerSnippetsForm key={props.serverId} {...props} />;
}

function ServerSnippetsForm({
  serverId,
  serverName,
  onInsert,
  embedded = false,
}: ServerSnippetsProps) {
  const [snippets, setSnippets] = useState<SshSnippet[]>([]);
  const [selected, setSelected] = useState<SshSnippet>();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<"" | "saved" | "copied" | "inserted">("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const matches = snippets.filter((snippet) =>
    `${snippet.name} ${snippet.command}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    const load = () => {
      try {
        setSnippets(loadSshSnippets(serverId));
      } catch {
        setError(t("Couldn’t load saved commands."));
      }
    };
    load();
    return subscribeSshSnippets(load);
  }, [serverId]);
  return (
    <section
      aria-label={t("Saved SSH commands")}
      className={`@container/snippets flex min-w-0 flex-col gap-3 ${embedded ? "" : "p-4"}`}
    >
      <Heading size="section" level={3}>
        {t("Saved commands")}
      </Heading>
      <Text as="p" tone="muted" className="break-words">
        {t("Target")}: {serverName ?? serverId}
      </Text>
      <SearchInput
        appearance="field"
        aria-label={t("Search saved commands")}
        placeholder={t("Search saved commands")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid min-w-0 gap-4 @min-[48rem]/snippets:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {matches.length === 0 ? (
            <EmptyState
              size="inline"
              kind={snippets.length ? "filtered" : undefined}
              description={t(snippets.length ? "No matching commands." : "No saved commands yet.")}
              onReset={snippets.length ? () => setSearch("") : undefined}
            />
          ) : null}
          <ul
            aria-label={t("Saved commands")}
            className="flex max-h-60 flex-col gap-1 overflow-y-auto"
          >
            {matches.map((snippet) => (
              <li key={snippet.id}>
                <Button
                  variant="item"
                  selected={selected?.id === snippet.id}
                  aria-pressed={selected?.id === snippet.id}
                  onClick={() => {
                    setSelected(snippet);
                    setName(snippet.name);
                    setCommand(snippet.command);
                    setError("");
                    setNotice("");
                  }}
                >
                  <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
                    {snippet.name}
                  </Text>
                  <Text tone="muted">v{snippet.version}</Text>
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setError("");
            setNotice("");
            try {
              const saved = saveSshSnippet({
                id: selected?.id,
                serverId,
                name,
                command,
                expectedVersion: selected?.version,
                expectedCommand: selected?.command,
              });
              setSelected(saved);
              setNotice("saved");
            } catch {
              setError(
                t(
                  "Couldn’t save this command. Reload a changed command and use one line without terminal controls.",
                ),
              );
            }
          }}
        >
          <TextField
            label={t("Name")}
            value={name}
            required
            maxLength={200}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setNotice("");
            }}
          />
          <TextareaField
            label={t("Command preview")}
            value={command}
            required
            maxLength={8192}
            rows={3}
            disabled={busy}
            onChange={(event) => {
              setCommand(event.target.value);
              setNotice("");
            }}
          />
          <Text as="p" tone="muted">
            {t("Commands are saved locally. Do not include secrets.")}
          </Text>
          <div className="flex flex-wrap justify-end gap-2">
            {selected ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setSelected(undefined);
                  setName("");
                  setCommand("");
                  setNotice("");
                  setError("");
                }}
              >
                {t("New command")}
              </Button>
            ) : null}
            <Button
              type="submit"
              success={notice === "saved"}
              successLabel={t("Saved")}
              disabled={busy || !name.trim() || !isSingleLineCommand(command)}
            >
              {t("Save")}
            </Button>
            <Button
              variant={onInsert ? "secondary" : "primary"}
              loading={busy}
              success={notice === "copied"}
              successLabel={t("Copied")}
              disabled={
                !selected ||
                selected.command !== command ||
                !selected.reviewed ||
                !isSingleLineCommand(command)
              }
              onClick={async () => {
                if (!selected || busy) return;
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  await insertSshSnippet(selected, serverId, copyText);
                  setNotice("copied");
                } catch {
                  setError(t("Couldn’t copy this command. Review and save it first."));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t("Copy command")}
            </Button>
            {onInsert ? (
              <Button
                variant="primary"
                loading={busy}
                disabled={
                  !selected ||
                  !selected.reviewed ||
                  selected.command !== command ||
                  !isSingleLineCommand(command)
                }
                onClick={async () => {
                  if (!selected || busy) return;
                  setBusy(true);
                  setError("");
                  setNotice("");
                  try {
                    await insertSshSnippet(selected, serverId, onInsert);
                    setNotice("inserted");
                  } catch {
                    setError(
                      t(
                        "Couldn’t insert this command. Review it and open the target terminal first.",
                      ),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("Insert into terminal")}
              </Button>
            ) : null}
          </div>
        </form>
      </div>
      {selected && !selected.reviewed ? (
        <Text as="p" tone="muted">
          {t("This shared template changed. Review and save it before inserting.")}
        </Text>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      <LiveText
        text={notice === "inserted" ? t("Inserted. Press Enter in the terminal to run.") : ""}
        size="caption"
        tone="muted"
      />
    </section>
  );
}
