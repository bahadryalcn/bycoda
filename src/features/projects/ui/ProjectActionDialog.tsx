import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useId, useState } from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { readTextFile, statFiles } from "../../../platform/tauri/fs";
import { Alert } from "../../../shared/ui/Alert";
import { Field } from "../../../shared/ui/Field";
import { LiveText } from "../../../shared/ui/LiveText";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { CodeBlock, Globe, Play, Terminal, Wrench } from "../../../shared/ui/icons";
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
import {
  detectProjectActionPresets,
  type ProjectActionPreset,
} from "../model/projectActionPresets";

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
const examples = [
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
const presetIO = {
  read: readTextFile,
  exists: (paths: string[]) =>
    statFiles(paths).then((entries) => entries.map((entry) => entry.mtimeMs !== null)),
};
const CHIP_LIMIT = 4;

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
  const [detected, setDetected] = useState<ProjectActionPreset[]>([]);
  useEffect(() => {
    if (editing) return;
    let live = true;
    detectProjectActionPresets(cwd, presetIO)
      .then((found) => {
        if (live) setDetected(found);
      })
      .catch(() => {
        /* Suggestions are optional; the generic examples stay. */
      });
    return () => {
      live = false;
    };
  }, [cwd, editing]);
  const added = new Set(actions.map((item) => item.command.trim()));
  const suggestions = detected.filter((preset) => !added.has(preset.command));
  const chips = suggestions.length ? suggestions.slice(0, CHIP_LIMIT) : examples;
  const more = suggestions.slice(CHIP_LIMIT);
  const applyPreset = ({ name, command, icon, url, devServer }: (typeof chips)[number]) =>
    setDraft({
      ...draft,
      name,
      command,
      icon,
      url,
      devServer: devServer ?? false,
      openUrlOnRun: true,
    });
  const formId = useId();
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
      description={t("Runs in {p0} from the top bar or a keybinding.", { p0: prettyCwd(cwd) })}
      size="md"
      onClose={onClose}
      footerStart={
        editing ? (
          <Button type="button" variant="link" tone="danger" onClick={onDelete}>
            {t("Delete action")}
          </Button>
        ) : undefined
      }
      footer={
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button type="submit" form={formId} disabled={Boolean(missing)} variant="primary">
            {t("Save action")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id={formId}
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
        <div className="space-y-3 px-5 pb-4 pt-1">
          {!editing ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-ui-caption text-(--ui-text-muted)">
                {suggestions.length
                  ? t("Scripts from {p0}", { p0: suggestions[0].source })
                  : t("Examples")}
              </span>
              {chips.map((preset) => (
                <Button
                  type="button"
                  key={preset.name}
                  variant="secondary"
                  tooltip={suggestions.length ? preset.command : undefined}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.name}
                </Button>
              ))}
              {more.length ? (
                <SearchableSelect
                  hideLabel
                  label={t("More scripts")}
                  placeholder={t("{p0} more scripts", { p0: more.length })}
                  value=""
                  options={more.map((preset) => ({
                    value: preset.name,
                    label: preset.name,
                    description: preset.command,
                  }))}
                  onChange={(name) => {
                    const preset = more.find((item) => item.name === name);
                    if (preset) applyPreset(preset);
                  }}
                />
              ) : null}
            </div>
          ) : null}
          <Field label={t("Name")}>
            {(control) => (
              <div className="flex gap-2">
                <Select
                  hideLabel
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
                  {...control}
                  autoFocus
                  required
                  maxLength={80}
                  fieldClassName="min-w-0 flex-1"
                  placeholder={t("e.g. Start development server")}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </div>
            )}
          </Field>
          <TextareaField
            label={t("Command")}
            rows={2}
            monospace
            className="resize-y leading-relaxed"
            placeholder={t("e.g. pnpm dev, npm run dev, or bun test")}
            value={draft.command}
            onChange={(event) => setDraft({ ...draft, command: event.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t("Keybinding")}
              readOnly
              title={t("Backspace clears the shortcut.")}
              placeholder={t("Click here and press a shortcut")}
              value={draft.shortcut ? quickComposerShortcutLabel(draft.shortcut) : ""}
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
            <TextField
              label={`${t("Web address")} ${t("(optional)")}`}
              type="url"
              placeholder="http://localhost:5173"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
              aria-invalid={!validActionUrl(draft.url)}
            />
          </div>
          {shortcutError || shortcutHint ? (
            <InlineMessage tone="warning">{shortcutError || shortcutHint}</InlineMessage>
          ) : null}
          <div className="space-y-2.5 rounded-lg bg-(--ui-surface-muted) px-3 py-2.5">
            <Checkbox
              checked={draft.devServer}
              onChange={(event) => setDraft({ ...draft, devServer: event.target.checked })}
              label={t("Manage as development server")}
              description={t(
                "Runs on this project's host with server status and logs in Conversation tools.",
              )}
            />
            {!draft.devServer ? (
              <Checkbox
                checked={draft.openUrlOnRun && Boolean(draft.url.trim())}
                disabled={!draft.url.trim()}
                onChange={(event) => setDraft({ ...draft, openUrlOnRun: event.target.checked })}
                label={t("Open web address when this action runs")}
                description={t("Opens immediately; a dev server may still be starting.")}
              />
            ) : null}
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {missing ? (
            <p className="text-ui-caption text-(--ui-text-muted)">
              <LiveText text={missing} />
            </p>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
