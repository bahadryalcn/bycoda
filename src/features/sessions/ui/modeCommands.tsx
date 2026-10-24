import { Button } from "../../../shared/ui/Button";
import { useLocale, useT } from "../../../shared/i18n";
import {
  AiIdea,
  Bot,
  CheckList,
  CircleDashed,
  CursorMagicSelection,
  MessageSquare,
  Share,
  Terminal,
  X,
} from "../../../shared/ui/icons";
import { BTW_COMMAND } from "../model/btw";
import { SUBAGENTS_COMMAND, TASK_COMMAND } from "../model/delegationCommands";
import { DRAFT_COMMAND } from "../model/draftCommand";
import { OPERATOR_COMMAND } from "../model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { PLAN_COMMAND } from "../model/plan";

type ModeCommandStyle = {
  Icon: typeof AiIdea;
  /** Text color of the command inside the prompt. */
  className: string;
  /** Shows a mode pill under the prompt while the mode is on. */
  pill?: true;
  /** Rows that list the mode, such as a + menu or command list. */
  menu?: { iconClassName: string };
};

/** Presentation only. Wording lives in `modeCommandText`, which takes the caller's
 * `t` so compiled components re-render it after a language switch. */
export const MODE_COMMAND_STYLES: Record<string, ModeCommandStyle> = {
  [PLAN_COMMAND.name]: {
    Icon: AiIdea,
    className: "text-(--ui-tone-warning-fg)",
    pill: true,
    menu: { iconClassName: "text-(--ui-tone-warning-fg)" },
  },
  [OPERATOR_COMMAND.name]: {
    Icon: CursorMagicSelection,
    className: "text-(--ui-tone-info-fg)",
    pill: true,
    menu: { iconClassName: "text-(--ui-tone-info-fg)" },
  },
  [ORCHESTRATOR_COMMAND.name]: {
    Icon: Share,
    className: "text-orchestration",
    pill: true,
    menu: { iconClassName: "text-(--ui-text-secondary)" },
  },
  [DRAFT_COMMAND.name]: {
    Icon: CircleDashed,
    className: "text-(--ui-text-secondary)",
    pill: true,
    menu: { iconClassName: "text-(--ui-text-secondary)" },
  },
  [BTW_COMMAND.name]: {
    Icon: MessageSquare,
    className: "text-(--ui-tone-success-fg)",
  },
  [SUBAGENTS_COMMAND.name]: {
    Icon: Bot,
    className: "text-orchestration",
  },
  [TASK_COMMAND.name]: {
    Icon: CheckList,
    className: "text-(--ui-tone-info-fg)",
  },
};

type Translate = (message: string, values?: Record<string, unknown>) => string;

/** A mode's pill and menu wording, translated with the caller's `t` (`useT()`). */
export function modeCommandText(
  name: string,
  t: Translate,
):
  | {
      pill: { label: string; title: string };
      menu: { label: string; description: string };
    }
  | undefined {
  switch (name) {
    case PLAN_COMMAND.name:
      return {
        pill: { label: t("Plan"), title: t("Plan mode") },
        menu: { label: t("Plan mode"), description: t("Review a plan before building") },
      };
    case OPERATOR_COMMAND.name:
      return {
        pill: { label: t("Operator"), title: t("Operator") },
        menu: { label: t("Operator"), description: t("Give this thread access to bycoda") },
      };
    case ORCHESTRATOR_COMMAND.name:
      return {
        pill: { label: t("Orchestrator"), title: t("Orchestrator mode") },
        menu: { label: t("Orchestrator"), description: t("Plan and coordinate agent work") },
      };
    case DRAFT_COMMAND.name:
      return {
        pill: { label: t("Draft"), title: t("Draft mode") },
        menu: {
          label: t("Draft"),
          description: t("Save this message without starting the agent"),
        },
      };
    default:
      return undefined;
  }
}

/** A leading `!` runs the line in the shell instead of sending a prompt. */
export const SHELL_MODE_NAME = "shell";

const SHELL_MODE_STYLE: ModeCommandStyle = {
  Icon: Terminal,
  className: "text-(--ui-tone-warning-fg)",
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
  const t = useT();
  const style = MODE_COMMAND_STYLES[name];
  const pill = modeCommandText(name, t)?.pill;
  if (!style?.pill || !pill) return null;
  const { Icon } = style;
  return (
    <Button
      className="shrink-0"
      variant="ghost"
      type="button"
      title={t("Turn off {p0}", { p0: pill.title })}
      aria-label={t("Turn off {p0}", { p0: pill.title })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClear}
    >
      <Icon className="size-3.5" />
      <span className="composer-mode-shimmer">{pill.label}</span>
      <X className="size-3" />
    </Button>
  );
}
