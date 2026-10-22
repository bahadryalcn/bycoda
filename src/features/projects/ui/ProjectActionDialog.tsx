import { t, useLocale } from "../../../shared/i18n";
import { useId, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Switch } from "../../../shared/ui/Switch";
import { Select } from "../../../shared/ui/Select";
import { Alert } from "../../../shared/ui/Alert";
import { CodeBlock, FolderOpen, Globe, Play, Terminal, Wrench } from "../../../shared/ui/icons";
import { prettyCwd } from "../../../shared/lib/paths";
import {
  quickComposerShortcutLabel,
  shortcutFromKeyEvent,
} from "../../quick-composer/model/quickComposerShortcut";
import {
  ACTION_ICONS,
  projectActionShortcutError,
  validActionUrl,
  type ProjectAction,
} from "../model/projectActions";

const icons = {
  play: Play,
  terminal: Terminal,
  code: CodeBlock,
  globe: Globe,
  wrench: Wrench,
};
const labels = {
  play: "Run",
  terminal: "Terminal",
  code: "Code",
  globe: "Web",
  wrench: "Build",
};
const presets = [
  {
    name: "Dev server",
    command: "pnpm dev",
    icon: "play" as const,
    url: "http://localhost:5173",
    devServer: true,
  },
  { name: "Run tests", command: "pnpm test", icon: "code" as const, url: "" },
  {
    name: "Build project",
    command: "pnpm build",
    icon: "wrench" as const,
    url: "",
  },
];
const heading = "block text-[13px] font-medium text-content";
const help = "text-xs leading-relaxed text-(--ui-text-secondary)";

export function ProjectActionDialog({
  action,
  actions,
  cwd,
  editing,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  action: ProjectAction;
  actions: ProjectAction[];
  cwd: string;
  editing: boolean;
  error: string;
  onSave: (action: ProjectAction) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useLocale();
  const [draft, setDraft] = useState(() => ({
    ...action,
    shortcut: action.shortcut ?? "",
    openUrlOnRun: action.openUrlOnRun ?? true,
    devServer: action.devServer ?? false,
  }));
  const [shortcutHint, setShortcutHint] = useState("");
  const uid = useId();
  const shortcutError = projectActionShortcutError(draft.shortcut, actions, draft.id);
  const missing = !draft.name.trim()
    ? "Enter a name for this action."
    : draft.devServer && !draft.command.trim()
      ? t("Enter a command to start the development server.")
      : !draft.command.trim() && !draft.url.trim()
        ? "Enter a command or a web address to continue."
        : !validActionUrl(draft.url)
          ? "Use an HTTP or HTTPS address."
          : !draft.command.trim() && !draft.openUrlOnRun
            ? "Enable the web address option so this action has something to run."
            : shortcutError;
  return (
    <Modal
      title={editing ? t("Edit action") : t("Add action")}
      description={t(
        "Actions are shortcuts for this project. Run a command from the top bar or a keybinding, and optionally open its web address.",
      )}
      size="md"
      onClose={onClose}
      className="[&_header]:px-6 [&_header]:pt-5"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!missing)
            onSave({
              ...draft,
              name: draft.name.trim(),
              command: draft.command.trim(),
              url: draft.url.trim(),
            });
        }}
      >
        <div className="space-y-4 px-6 pb-5 pt-4">
          <div className="flex items-center gap-2.5 rounded-lg border border-stroke bg-(--ui-surface) px-3 py-2">
            <FolderOpen className="mt-0.5 size-4 shrink-0 text-(--ui-text-muted)" />
            <div className="min-w-0">
              <p title={cwd} className="truncate text-xs text-(--ui-text-secondary)">
                <span className="mr-2 text-(--ui-text-muted)">{t("Working folder")}</span>
                <span className="font-mono">{prettyCwd(cwd)}</span>
              </p>
            </div>
          </div>
          {!editing ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-(--ui-text-muted)">{t("Examples")}</span>
                {presets.map((preset) => (
                  <Button
                    type="button"
                    key={preset.name}
                    variant="secondary"
                    onClick={() =>
                      setDraft({ ...draft, devServer: false, ...preset, openUrlOnRun: true })
                    }
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <label htmlFor={`${uid}-name`} className={heading}>
              {t("Name")}{" "}
              <span className="font-normal text-(--ui-text-muted)">{t("(required)")}</span>
            </label>
            <div className="flex gap-2">
              <Select
                label={t("Icon")}
                value={draft.icon}
                options={ACTION_ICONS.map((icon) => {
                  const Choice = icons[icon];
                  return {
                    value: icon,
                    label: t(labels[icon]),
                    icon: <Choice className="size-4" aria-hidden="true" />,
                  };
                })}
                onValueChange={(icon) =>
                  setDraft({ ...draft, icon: icon as ProjectAction["icon"] })
                }
                title={t("Choose action icon")}
              />
              <TextField
                label=""
                hideLabel
                id={`${uid}-name`}
                autoFocus
                required
                maxLength={80}
                fieldClassName="min-w-0 flex-1"
                placeholder={t("e.g. Start development server")}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                aria-describedby={`${uid}-name-help`}
              />
            </div>
            <p id={`${uid}-name-help`} className={help}>
              {t("Shown in the top bar. Click the icon to choose its symbol.")}
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${uid}-shortcut`} className={heading}>
              {t("Keybinding")}{" "}
              <span className="font-normal text-(--ui-text-muted)">{t("(optional)")}</span>
            </label>
            <div className="flex gap-2">
              <TextField
                label=""
                hideLabel
                id={`${uid}-shortcut`}
                readOnly
                fieldClassName="min-w-0 flex-1"
                placeholder={t("Click here and press a shortcut")}
                value={draft.shortcut ? quickComposerShortcutLabel(draft.shortcut) : ""}
                aria-describedby={`${uid}-shortcut-help`}
                aria-invalid={Boolean(shortcutError)}
                onKeyDown={(event) => {
                  if (event.key === "Tab") return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === "Backspace" || event.key === "Delete") {
                    setDraft({ ...draft, shortcut: "" });
                    setShortcutHint("");
                    return;
                  }
                  const value = shortcutFromKeyEvent(event);
                  if (value) {
                    setDraft({ ...draft, shortcut: value });
                    setShortcutHint("");
                  } else if (!["Control", "Meta", "Alt", "Shift"].includes(event.key))
                    setShortcutHint("Include Ctrl, Alt or Command with another key.");
                }}
              />
              <Button
                type="button"
                disabled={!draft.shortcut}
                variant="secondary"
                onClick={() => {
                  setDraft({ ...draft, shortcut: "" });
                  setShortcutHint("");
                }}
              >
                {t("Clear")}
              </Button>
            </div>
            <p id={`${uid}-shortcut-help`} className={help}>
              {t(
                "Press a shortcut; Backspace clears it. Works in this project. App shortcuts are reserved.",
              )}
            </p>
            {shortcutError || shortcutHint ? (
              <p role="status" className="text-xs text-warning">
                {shortcutError || shortcutHint}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${uid}-command`} className={heading}>
              {t("Command")}
            </label>
            <TextareaField
              label=""
              hideLabel
              id={`${uid}-command`}
              rows={2}
              className="resize-y font-mono leading-relaxed"
              placeholder={t("e.g. pnpm dev, npm run dev, or bun test")}
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              aria-describedby={`${uid}-command-help`}
            />
            <p id={`${uid}-command-help`} className={help}>
              {t(
                draft.devServer
                  ? "Runs on this project's host with server status and logs in Conversation tools."
                  : "Runs in a new terminal in this folder using your default shell. Leave empty for a web link action.",
              )}
            </p>
            <label className="flex items-center gap-2 text-xs text-(--ui-text-secondary)">
              <Checkbox
                checked={draft.devServer}
                onChange={(event) => setDraft({ ...draft, devServer: event.target.checked })}
              />
              {t("Manage as development server")}
            </label>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${uid}-url`} className={heading}>
              {t("Web address")}{" "}
              <span className="font-normal text-(--ui-text-muted)">{t("(optional)")}</span>
            </label>
            <TextField
              label=""
              hideLabel
              id={`${uid}-url`}
              type="url"
              placeholder="http://localhost:5173"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              aria-describedby={`${uid}-url-help`}
              aria-invalid={!validActionUrl(draft.url)}
            />
            <p id={`${uid}-url-help`} className={help}>
              {t(
                draft.devServer
                  ? "The web address provides the expected server port. Open the discovered URL from Conversation tools."
                  : "Add your local dev server or any HTTP/HTTPS page. Opens in your default browser.",
              )}
            </p>
          </div>
          {!draft.devServer ? (
            <div className="flex items-center justify-between gap-4 rounded-lg bg-(--ui-surface) p-3">
              <div>
                <span id={`${uid}-open-label`} className="text-[13px] font-medium text-content">
                  {t("Open web address when this action runs")}
                </span>
                <p id={`${uid}-open-help`} className={`${help} mt-1`}>
                  {t("Opens immediately; a dev server may still be starting.")}
                </p>
              </div>
              <Switch
                aria-labelledby={`${uid}-open-label`}
                aria-describedby={`${uid}-open-help`}
                checked={draft.openUrlOnRun}
                disabled={!draft.url.trim()}
                onCheckedChange={(openUrlOnRun) => setDraft({ ...draft, openUrlOnRun })}
              />
            </div>
          ) : (
            <p className={help}>
              {t(
                "Open discovered server addresses from Conversation tools after the server starts.",
              )}
            </p>
          )}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-stroke bg-background-base px-6 py-4">
          {editing ? (
            <Button type="button" variant="link" tone="danger" onClick={onDelete}>
              {t("Delete action")}
            </Button>
          ) : null}
          <p aria-live="polite" className="min-w-0 flex-1 text-xs text-(--ui-text-muted)">
            {missing ||
              (draft.devServer
                ? t("Starts a managed development server on this project's host.")
                : draft.command.trim()
                  ? t(
                      draft.url.trim() && draft.openUrlOnRun
                        ? "Runs in a new terminal and opens your browser."
                        : "Runs in a new terminal.",
                    )
                  : t("Opens the web address in your browser."))}
          </p>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={Boolean(missing)} variant="primary">
            {t("Save action")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
