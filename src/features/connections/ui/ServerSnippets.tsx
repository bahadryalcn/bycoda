import { useEffect, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { isSingleLineCommand } from "../../terminal/model/terminalSuggestions";
import {
  insertSshSnippet,
  loadSshSnippets,
  saveSshSnippet,
  subscribeSshSnippets,
  type SshSnippet,
} from "../model/sshSnippets";

/** Explicit, target-bound command insertion. Nothing runs when mounted/restored. */
export function ServerSnippets({
  serverId,
  serverName,
  onInsert,
}: {
  serverId: string;
  serverName?: string;
  /** Supply only when a verified remote prompt/echo capability permits insertion. */
  onInsert?: (text: string) => Promise<void>;
}) {
  const [snippets, setSnippets] = useState<SshSnippet[]>([]);
  const [selected, setSelected] = useState<SshSnippet>();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSelected(undefined);
    setName("");
    setCommand("");
    setNotice("");
    setError("");
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
    <section aria-label={t("Saved SSH commands")} className="flex min-w-0 flex-col gap-3 p-4">
      <p className="break-words text-xs text-(--ui-text-muted)">
        {t("Target")}: {serverName ?? serverId}
      </p>
      <ul aria-label={t("Saved commands")} className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {snippets.map((snippet) => (
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
              <span className="min-w-0 flex-1 truncate">{snippet.name}</span>
              <span className="text-xs text-(--ui-text-muted)">v{snippet.version}</span>
            </Button>
          </li>
        ))}
      </ul>
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
            setNotice(t("Saved"));
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
        <p className="text-xs text-(--ui-text-muted)">
          {t("Commands are saved locally. Do not include secrets.")}
        </p>
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
          <Button type="submit" disabled={busy || !name.trim() || !isSingleLineCommand(command)}>
            {t("Save")}
          </Button>
          <Button
            variant={onInsert ? "secondary" : "primary"}
            loading={busy}
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
                setNotice(t("Copied"));
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
                  setNotice(t("Inserted. Press Enter in the terminal to run."));
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
      {selected && !selected.reviewed ? (
        <p className="text-xs text-(--ui-text-muted)">
          {t("This shared template changed. Review and save it before inserting.")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-(--ui-tone-danger-fg)">
          {error}
        </p>
      ) : null}
      <p role="status" className="text-xs text-(--ui-text-muted)">
        {notice}
      </p>
    </section>
  );
}
