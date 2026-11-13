import { Tooltip } from "../../../shared/ui/Tooltip";
import { Text } from "../../../shared/ui/Text";
import { Code } from "../../../shared/ui/Code";
import { useT } from "../../../shared/i18n";
import { useEffect, useId, useState } from "react";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { projectActionPresetIO } from "../model/projectActionCatalog";
import { Alert } from "../../../shared/ui/Alert";
import { Field } from "../../../shared/ui/Field";
import { LiveText } from "../../../shared/ui/LiveText";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Check, CodeBlock, Globe, Play, Terminal, Wrench } from "../../../shared/ui/icons";
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
  onSave: (action: ProjectAction) => boolean | void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState(() => ({
    ...action,
    shortcut: action.shortcut ?? "",
    openUrlOnRun: action.openUrlOnRun ?? true,
    devServer: action.devServer ?? false,
  }));
  const [shortcutHint, setShortcutHint] = useState("");
  const [detected, setDetected] = useState<ProjectActionPreset[]>([]);
  // Suggestions belong to the current project; saved actions remain visible and disabled.
  useEffect(() => {
    if (editing) return;
    let live = true;
    detectProjectActionPresets(cwd, projectActionPresetIO)
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
  const chips = detected.length ? detected.slice(0, CHIP_LIMIT) : examples;
  const more = detected.slice(CHIP_LIMIT);
  const applyPreset = ({ name, command, icon, url, devServer }: (typeof chips)[number]) =>
    setDraft({
      ...draft,
      name: detected.length ? name : t(name),
      command,
      icon,
      url,
      devServer: devServer ?? false,
      openUrlOnRun: true,
    });
  const formId = useId();
  const shortcutError = projectActionShortcutError(draft.shortcut, actions, draft.id);
  const missing = !draft.name.trim()
    ? t("Enter a name for this action.")
    : draft.devServer && !draft.command.trim()
      ? t("Enter a command to start the development server.")
      : !draft.command.trim() && !draft.url.trim()
        ? t("Enter a command or a web address to continue.")
        : !validActionUrl(draft.url)
          ? t("Use an HTTP or HTTPS address.")
          : !draft.command.trim() && !draft.openUrlOnRun
            ? t("Enable the web address option so this action has something to run.")
            : shortcutError;
  return (
    <Modal
      title={editing ? t("Edit action") : t("Add action")}
      description={prettyCwd(cwd)}
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
            {t(editing ? "Cancel" : "Close")}
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
          if (!missing) {
            const saved = onSave({
              ...draft,
              name: draft.name.trim(),
              command: draft.command.trim(),
              url: draft.url.trim(),
            });
            if (!editing && saved !== false) {
              setDraft({
                id: crypto.randomUUID(),
                name: "",
                command: "",
                url: "",
                icon: "play",
                shortcut: "",
                openUrlOnRun: true,
                devServer: false,
              });
              setShortcutHint("");
            }
          }
        }}
      >
        <div className="space-y-3">
          {!editing ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Text size="caption" tone="muted" className="mr-1">
                {detected.length
                  ? t("Scripts from {p0}", { p0: detected[0].source })
                  : t("Examples")}
              </Text>
              {chips.map((preset) => (
                <Button
                  type="button"
                  key={preset.name}
                  variant="secondary"
                  disabled={added.has(preset.command.trim())}
                  aria-label={
                    added.has(preset.command.trim())
                      ? `${detected.length ? preset.name : t(preset.name)}: ${t("Added")}`
                      : undefined
                  }
                  tooltip={detected.length ? preset.command : undefined}
                  onClick={() => applyPreset(preset)}
                >
                  {added.has(preset.command.trim()) ? (
                    <Check className="icon-sm" aria-hidden="true" />
                  ) : null}
                  {detected.length ? preset.name : t(preset.name)}
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
                    disabled: added.has(preset.command.trim()),
                    meta: added.has(preset.command.trim()) ? t("Added") : undefined,
                  }))}
                  onChange={(name) => {
                    const preset = more.find((item) => item.name === name);
                    if (preset) applyPreset(preset);
                  }}
                />
              ) : null}
            </div>
          ) : null}
          {!editing && actions.length ? (
            <Text as="section" aria-label={t("Project actions")} className="space-y-1">
              <Text as="p" size="caption" tone="muted">
                {t("Saved")}
              </Text>
              <Text as="ul" className="max-h-24 space-y-1 overflow-y-auto">
                {actions.map((saved) => (
                  <Text
                    as="li"
                    key={saved.id}
                    className="flex min-w-0 items-center gap-3"
                    size="secondary"
                  >
                    <Text truncate className="min-w-0 flex-1">
                      {saved.name}
                    </Text>
                    <Text size="caption" tone="muted" truncate className="min-w-0 flex-1">
                      <Code>{saved.command || saved.url}</Code>
                    </Text>
                  </Text>
                ))}
              </Text>
            </Text>
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
            minRows={2}
            monospace
            className="resize-y"
            leading="relaxed"
            placeholder={t("e.g. pnpm dev, npm run dev, or bun test")}
            value={draft.command}
            onChange={(event) => setDraft({ ...draft, command: event.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Tooltip label={t("Backspace clears the shortcut.")}>
              <TextField
                label={t("Keybinding")}
                readOnly

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
                    setShortcutHint(t("Include Ctrl, Alt or Command with another key."));
                }}
              />
            </Tooltip>
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
          <div className="space-y-2.5">
            <Checkbox
              size="secondary"
              checked={draft.devServer}
              onChange={(event) => setDraft({ ...draft, devServer: event.target.checked })}
              label={t("Manage as development server")}
              description={t("Track server status and logs.")}
            />
            {!draft.devServer ? (
              <Checkbox
                size="secondary"
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
            <Text as="p" size="caption" tone="muted">
              <LiveText text={missing} />
            </Text>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
