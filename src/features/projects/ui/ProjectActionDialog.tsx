import { t, useLocale } from "../../../shared/i18n";
import { useId, useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
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
const input =
  "w-full rounded-lg border border-stroke bg-content/5 px-3 py-2.5 text-sm text-content placeholder:text-content/35 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15";
const heading = "block text-[13px] font-medium text-content";
const help = "text-xs leading-relaxed text-content/55";

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
  const [choosingIcon, setChoosingIcon] = useState(false);
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
  const Icon = icons[draft.icon];
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
          <div className="flex items-center gap-2.5 rounded-lg border border-stroke bg-content/3 px-3 py-2">
            <FolderOpen className="mt-0.5 size-4 shrink-0 text-content/50" />
            <div className="min-w-0">
              <p title={cwd} className="truncate text-xs text-content/65">
                <span className="mr-2 text-content/45">{t("Working folder")}</span>
                <span className="font-mono">{prettyCwd(cwd)}</span>
              </p>
            </div>
          </div>
          {!editing ? (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-content/50">{t("Examples")}</span>
                {presets.map((preset) => (
                  <button
                    type="button"
                    key={preset.name}
                    className="rounded-md border border-stroke px-2.5 py-1.5 text-xs text-content/75 hover:border-accent/50 hover:bg-accent/5 focus-visible:outline-accent"
                    onClick={() =>
                      setDraft({ ...draft, devServer: false, ...preset, openUrlOnRun: true })
                    }
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <label htmlFor={`${uid}-name`} className={heading}>
              {t("Name")} <span className="font-normal text-content/45">{t("(required)")}</span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={t("Choose icon: {p0}", { p0: labels[draft.icon] })}
                aria-expanded={choosingIcon}
                onClick={() => setChoosingIcon(!choosingIcon)}
                className="grid size-10 shrink-0 place-items-center rounded-lg border border-stroke bg-content/5 text-accent hover:border-accent focus-visible:outline-accent"
                title={t("Choose action icon")}
              >
                <Icon className="size-5" />
              </button>
              <input
                id={`${uid}-name`}
                autoFocus
                required
                maxLength={80}
                className={input}
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
          {choosingIcon ? (
            <fieldset className="space-y-2">
              <legend className={`${heading} mb-2`}>{t("Icon")}</legend>
              <div className="grid grid-cols-5 gap-2">
                {ACTION_ICONS.map((icon) => {
                  const Choice = icons[icon];
                  return (
                    <button
                      type="button"
                      key={icon}
                      aria-label={t("{p0} icon", { p0: labels[icon] })}
                      aria-pressed={draft.icon === icon}
                      className={`flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 text-xs focus-visible:outline-accent ${draft.icon === icon ? "border-accent bg-accent/10 text-accent" : "border-stroke text-content/60 hover:bg-content/5"}`}
                      onClick={() => {
                        setDraft({ ...draft, icon });
                        setChoosingIcon(false);
                      }}
                    >
                      <Choice className="size-4" />
                      <span>{labels[icon]}</span>
                    </button>
                  );
                })}
              </div>
              <p className={help}>{t("Choose the symbol shown beside this action.")}</p>
            </fieldset>
          ) : null}
          <div className="space-y-2">
            <label htmlFor={`${uid}-shortcut`} className={heading}>
              {t("Keybinding")}{" "}
              <span className="font-normal text-content/45">{t("(optional)")}</span>
            </label>
            <div className="flex gap-2">
              <input
                id={`${uid}-shortcut`}
                readOnly
                className={`${input} cursor-pointer`}
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
              <button
                type="button"
                disabled={!draft.shortcut}
                className="rounded-lg border border-stroke px-3 text-xs text-content/60 hover:bg-content/5 disabled:opacity-35"
                onClick={() => {
                  setDraft({ ...draft, shortcut: "" });
                  setShortcutHint("");
                }}
              >
                {t("Clear")}
              </button>
            </div>
            <p id={`${uid}-shortcut-help`} className={help}>
              {t(
                "Press a shortcut; Backspace clears it. Works in this project. App shortcuts are reserved.",
              )}
            </p>
            {shortcutError || shortcutHint ? (
              <p role="status" className="text-xs text-amber-400">
                {shortcutError || shortcutHint}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${uid}-command`} className={heading}>
              {t("Command")}
            </label>
            <textarea
              id={`${uid}-command`}
              rows={2}
              className={`${input} resize-y font-mono leading-relaxed`}
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
            <label className="flex items-center gap-2 text-xs text-content/75">
              <input
                type="checkbox"
                checked={draft.devServer}
                onChange={(event) => setDraft({ ...draft, devServer: event.target.checked })}
              />
              {t("Manage as development server")}
            </label>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${uid}-url`} className={heading}>
              {t("Web address")}{" "}
              <span className="font-normal text-content/45">{t("(optional)")}</span>
            </label>
            <input
              id={`${uid}-url`}
              type="url"
              className={input}
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
            <div className="flex items-center justify-between gap-4 rounded-lg bg-content/5 p-3">
              <div>
                <span id={`${uid}-open-label`} className="text-[13px] font-medium text-content">
                  {t("Open web address when this action runs")}
                </span>
                <p id={`${uid}-open-help`} className={`${help} mt-1`}>
                  {t("Opens immediately; a dev server may still be starting.")}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-labelledby={`${uid}-open-label`}
                aria-describedby={`${uid}-open-help`}
                aria-checked={draft.openUrlOnRun}
                disabled={!draft.url.trim()}
                className={`relative h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-accent disabled:opacity-35 ${draft.openUrlOnRun && draft.url.trim() ? "bg-active" : "bg-content/20"}`}
                onClick={() => setDraft({ ...draft, openUrlOnRun: !draft.openUrlOnRun })}
              >
                <span
                  className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${draft.openUrlOnRun ? "left-1 translate-x-4" : "left-1"}`}
                />
              </button>
            </div>
          ) : (
            <p className={help}>
              {t(
                "Open discovered server addresses from Conversation tools after the server starts.",
              )}
            </p>
          )}
          {error ? (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          ) : null}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-stroke bg-background-base px-6 py-4">
          {editing ? (
            <button
              type="button"
              className="text-xs text-red-400 hover:underline"
              onClick={onDelete}
            >
              {t("Delete action")}
            </button>
          ) : null}
          <p aria-live="polite" className="min-w-0 flex-1 text-xs text-content/50">
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
          <button
            type="button"
            className="rounded-lg border border-stroke px-3 py-2 text-xs text-content/75 hover:bg-content/5"
            onClick={onClose}
          >
            {t("Cancel")}
          </button>
          <button
            type="submit"
            disabled={Boolean(missing)}
            className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-background-base hover:brightness-110 disabled:opacity-40"
          >
            {t("Save action")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
