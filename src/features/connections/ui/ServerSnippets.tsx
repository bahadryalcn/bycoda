import { Text } from "../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { Heading } from "../../../shared/ui/Heading";
import { copyText } from "../../../platform/tauri/clipboard";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { isSingleLineCommand } from "../../terminal/model/terminalSuggestions";
import {
  DuplicateSshSnippetError,
  insertSshSnippet,
  loadSshSnippets,
  saveSshSnippet,
  subscribeSshSnippets,
  type SshSnippet,
} from "../model/sshSnippets";

/** Saved commands show a search field only past this many entries. */
const SEARCH_FROM = 8;

type ServerSnippetsProps = {
  serverId: string;
  serverName?: string;
  /** Optional draft from an explicit terminal selection. It still requires review and save. */
  initialCommand?: string;
  /** Supply only when a verified remote prompt/echo capability permits insertion. */
  onInsert?: (text: string) => Promise<void>;
  onAlreadySaved?: () => void;
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
  initialCommand,
  onInsert,
  onAlreadySaved,
  embedded = false,
}: ServerSnippetsProps) {
  const [snippets, setSnippets] = useState<SshSnippet[]>([]);
  const [selected, setSelected] = useState<SshSnippet>();
  const [name, setName] = useState("");
  const [command, setCommand] = useState(() =>
    initialCommand && initialCommand.length <= 8192 && isSingleLineCommand(initialCommand)
      ? initialCommand
      : "",
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<"" | "saved" | "copied" | "inserted">("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const createOnly = initialCommand !== undefined;
  const query = search.trim().toLocaleLowerCase();
  const matches = query
    ? snippets.filter((snippet) =>
        `${snippet.name} ${snippet.command}`.toLocaleLowerCase().includes(query),
      )
    : snippets;
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Keep the visible command list in sync with local and cross-window template edits.
  useEffect(() => {
    if (createOnly) return;
    const load = () => {
      try {
        setSnippets(loadSshSnippets(serverId));
      } catch {
        setError(t("Couldn’t load saved commands."));
      }
    };
    load();
    return subscribeSshSnippets(load);
  }, [serverId, createOnly]);
  return (
    <section
      aria-label={t("Saved SSH commands")}
      className={`@container/snippets flex min-w-0 flex-col gap-3 ${embedded ? "" : "p-4"}`}
    >
      {!createOnly ? (
        <Heading size="section" level={3}>
          {t("Saved commands")}
        </Heading>
      ) : null}
      <Text as="p" tone="muted" className="break-words">
        {t("Target")}: {serverName ?? serverId}
      </Text>
      {!createOnly && snippets.length > SEARCH_FROM ? (
        <SearchInput
          appearance="field"
          aria-label={t("Search saved commands")}
          placeholder={t("Search saved commands")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}
      <div
        className={`grid min-w-0 gap-4 ${createOnly ? "" : "@min-[48rem]/snippets:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"}`}
      >
        {!createOnly ? (
          <div className="min-w-0">
            {matches.length === 0 ? (
              <EmptyState
                size="inline"
                kind={snippets.length ? "filtered" : undefined}
                description={t(
                  snippets.length ? "No matching commands." : "No saved commands yet.",
                )}
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
                    pressed={selected?.id === snippet.id}
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
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
            } catch (reason) {
              if (reason instanceof DuplicateSshSnippetError) {
                if (createOnly && onAlreadySaved) onAlreadySaved();
                else setError(t("Command already saved."));
                return;
              }
              setError(
                t(
                  "Couldn’t save this command. Reload a changed command and use one line without terminal controls.",
                ),
              );
            }
          }}
        >
          <TextField
            label={t("Name (optional)")}
            value={name}
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <InfoPopover>
              <p>{t("Commands are saved locally. Do not include secrets.")}</p>
            </InfoPopover>
            {!createOnly && selected ? (
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
              variant={createOnly ? "primary" : "secondary"}
              success={notice === "saved"}
              successLabel={t("Saved")}
              disabled={busy || !isSingleLineCommand(command)}
              disabledReason={
                !busy && !isSingleLineCommand(command)
                  ? t("Enter a valid single-line command")
                  : undefined
              }
            >
              {t("Save")}
            </Button>
            {!createOnly ? (
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
                disabledReason={selected ? t("Save changes first") : t("Select a saved command")}
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
            ) : null}
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
                disabledReason={selected ? t("Save changes first") : t("Select a saved command")}
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
