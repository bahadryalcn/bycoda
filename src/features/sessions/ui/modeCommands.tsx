import { t, useLocale } from "../../../shared/i18n";
import {
  AiIdea,
  CircleDashed,
  CursorMagicSelection,
  MessageSquare,
  Share,
  Terminal,
  X,
} from "../../../shared/ui/icons";
import { BTW_COMMAND } from "../model/btw";
import { DRAFT_COMMAND } from "../model/draftCommand";
import { OPERATOR_COMMAND } from "../model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { PLAN_COMMAND } from "../model/plan";

type ModeCommandStyle = {
  Icon: typeof AiIdea;
  /** Text color of the command inside the prompt. */
  className: string;
  /** Mode pill shown under the prompt while the mode is on. */
  pill?: { label: string; title: string; className: string };
  /** Rows that list the mode, such as a + menu or command list. */
  menu?: { label: string; description: string; iconClassName: string };
};

export const MODE_COMMAND_STYLES: Record<string, ModeCommandStyle> = {
  [PLAN_COMMAND.name]: {
    Icon: AiIdea,
    className: "text-warning dark:text-warning/90",
    pill: {
      get label() {
        return t("Plan");
      },
      get title() {
        return t("Plan mode");
      },
      className: "bg-warning/12 text-warning hover:bg-warning/18 dark:text-warning/90",
    },
    menu: {
      get label() {
        return t("Plan mode");
      },
      get description() {
        return t("Review a plan before building");
      },
      iconClassName: "text-warning/80",
    },
  },
  [OPERATOR_COMMAND.name]: {
    Icon: CursorMagicSelection,
    className: "text-info dark:text-info/90",
    pill: {
      get label() {
        return t("Operator");
      },
      get title() {
        return t("Operator");
      },
      className:
        "bg-info/15 font-medium text-info hover:bg-info/20 dark:bg-info/10 dark:text-info/90 dark:hover:bg-info/15",
    },
    menu: {
      get label() {
        return t("Operator");
      },
      get description() {
        return t("Give this thread access to bycoda");
      },
      iconClassName: "text-info/80",
    },
  },
  [ORCHESTRATOR_COMMAND.name]: {
    Icon: Share,
    className: "text-orchestration dark:text-orchestration/90",
    pill: {
      get label() {
        return t("Orchestrator");
      },
      get title() {
        return t("Orchestrator mode");
      },
      className:
        "bg-orchestration/15 font-medium text-orchestration hover:bg-orchestration/20 dark:bg-orchestration/10 dark:text-orchestration/90 dark:hover:bg-orchestration/15",
    },
    menu: {
      get label() {
        return t("Orchestrator");
      },
      get description() {
        return t("Plan and coordinate agent work");
      },
      iconClassName: "text-orchestration/65",
    },
  },
  [DRAFT_COMMAND.name]: {
    Icon: CircleDashed,
    className: "text-content/70",
    pill: {
      get label() {
        return t("Draft");
      },
      get title() {
        return t("Draft mode");
      },
      className:
        "border border-dashed border-content/25 bg-content/5 text-content/70 hover:bg-content/10 hover:text-content",
    },
    menu: {
      get label() {
        return t("Draft");
      },
      get description() {
        return t("Save this message without starting the agent");
      },
      iconClassName: "text-content/60",
    },
  },
  [BTW_COMMAND.name]: {
    Icon: MessageSquare,
    className: "text-success dark:text-success/90",
  },
};

/** A leading `!` runs the line in the shell instead of sending a prompt. */
export const SHELL_MODE_NAME = "shell";

const SHELL_MODE_STYLE: ModeCommandStyle = {
  Icon: Terminal,
  className: "text-danger dark:text-danger",
};

/** First-line indent that, with the `/`, makes room for a mode icon. */
export const MODE_COMMAND_INDENT = "13px";

export type ModeCommandToken = {
  name: string;
  end: number;
  style: ModeCommandStyle;
};

/** Mode commands only take effect at the start of a prompt. */
export function leadingModeCommand(
  text: string,
  names: ReadonlySet<string>,
  { shell = false }: { shell?: boolean } = {},
): ModeCommandToken | null {
  // `![alt](url)` is a Markdown image, not a command.
  if (shell && /^!(?!\[)/.test(text)) {
    return { name: SHELL_MODE_NAME, end: text.length, style: SHELL_MODE_STYLE };
  }
  const match = text.match(/^\/([a-z]+)(?=\s|$)/);
  const name = match?.[1];
  if (!match || !name || !names.has(name)) return null;
  const style = MODE_COMMAND_STYLES[name];
  if (!style) return null;
  return { name, end: match[0].length, style };
}

/**
 * The leading command inside a prompt's highlight layer. The `/` keeps its
 * width so the textarea underneath stays in lockstep; the shared first-line
 * indent widens its slot to fit the icon, like the `@` of a file mention.
 */
export function ModeCommandText({
  text,
  mode,
  indent = MODE_COMMAND_INDENT,
  iconClassName = "size-3.5",
}: {
  text: string;
  mode: ModeCommandToken;
  indent?: string;
  iconClassName?: string;
}) {
  useLocale();
  return (
    <span className={mode.style.className}>
      <span className="relative">
        <span className="text-transparent">{text[0]}</span>
        <mode.style.Icon
          className={`absolute top-1/2 -translate-y-1/2 ${iconClassName}`}
          style={{ left: `-${indent}` }}
        />
      </span>
      <span key={mode.name} className="composer-mode-shimmer">
        {text.slice(1, mode.end)}
      </span>
    </span>
  );
}

export function ModeCommandPill({ name, onClear }: { name: string; onClear: () => void }) {
  useLocale();
  const style = MODE_COMMAND_STYLES[name];
  if (!style?.pill) return null;
  const { Icon, pill } = style;
  return (
    <button
      type="button"
      title={t("Turn off {p0}", { p0: pill.title })}
      aria-label={t("Turn off {p0}", { p0: pill.title })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClear}
      className={`flex h-6.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] ${pill.className}`}
    >
      <Icon className="size-3.5" />
      <span className="composer-mode-shimmer">{pill.label}</span>
      <X className="size-3" />
    </button>
  );
}
