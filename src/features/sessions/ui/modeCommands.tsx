import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuAction } from "../../../shared/ui/DropdownMenu";
import { useRef } from "react";
import { Text, type TextTone } from "../../../shared/ui/Text";
import { useLocale, useT } from "../../../shared/i18n";
import {
  AiIdea,
  Bot,
  CheckList,
  CircleDashed,
  CursorMagicSelection,
  MessageSquare,
  Share,
  SlidersHorizontal,
  Terminal,
} from "../../../shared/ui/icons";
import { BTW_COMMAND } from "../model/btw";
import { SUBAGENTS_COMMAND, TASK_COMMAND } from "../model/delegationCommands";
import { EPIC_COMMAND, CREW_COMMAND, AUTOMATION_COMMAND } from "../model/workCommands";
import { DRAFT_COMMAND } from "../model/draftCommand";
import { OPERATOR_COMMAND } from "../model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../model/orchestratorCommand";
import { PLAN_COMMAND } from "../model/plan";

type ModeCommandStyle = {
  Icon: typeof AiIdea;
  /** Text tone of the command inside the prompt. */
  tone?: TextTone;
  /** Feature ink for the command when no Text tone matches (orchestration). */
  className?: string;
  /** Shows a mode pill under the prompt while the mode is on. */
  pill?: true;
  /** Rows that list the mode, such as a + menu or command list. */
  menu?: { tone?: TextTone };
};

/** Presentation only. Wording lives in `modeCommandText`, which takes the caller's
 * `t` so compiled components re-render it after a language switch. */
export const MODE_COMMAND_STYLES: Record<string, ModeCommandStyle> = {
  [PLAN_COMMAND.name]: {
    Icon: AiIdea,
    tone: "warning",
    pill: true,
    menu: { tone: "warning" },
  },
  [OPERATOR_COMMAND.name]: {
    Icon: CursorMagicSelection,
    tone: "info",
    pill: true,
    menu: { tone: "info" },
  },
  [ORCHESTRATOR_COMMAND.name]: {
    Icon: Share,
    className: "text-orchestration",
    pill: true,
    menu: { tone: "secondary" },
  },
  [DRAFT_COMMAND.name]: {
    Icon: CircleDashed,
    tone: "secondary",
    pill: true,
    menu: { tone: "secondary" },
  },
  [BTW_COMMAND.name]: {
    Icon: MessageSquare,
    tone: "success",
  },
  [SUBAGENTS_COMMAND.name]: {
    Icon: Bot,
    className: "text-orchestration",
  },
  [TASK_COMMAND.name]: {
    Icon: CheckList,
    tone: "info",
  },
  [EPIC_COMMAND.name]: { Icon: CheckList, tone: "info" },
  [CREW_COMMAND.name]: { Icon: Bot, className: "text-orchestration" },
  [AUTOMATION_COMMAND.name]: { Icon: AiIdea, tone: "info" },
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
  tone: "warning",
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
  iconClassName = "icon-sm",
}: {
  text: string;
  mode: ModeCommandToken;
  indent?: string;
  iconClassName?: string;
}) {
  useLocale();
  return (
    <Text
      as="span"
      size="inherit"
      tone={mode.style.tone ?? "inherit"}
      className={mode.style.className}
    >
      <span className="relative">
        <span className="text-transparent">{text[0]}</span>
        <mode.style.Icon
          className={`absolute top-1/2 -translate-y-1/2 start-(--mode-icon-offset) ${iconClassName}`}
          style={{ "--mode-icon-offset": `-${indent}` } as React.CSSProperties}
        />
      </span>
      <span key={mode.name} className="composer-mode-shimmer">
        {text.slice(1, mode.end)}
      </span>
    </Text>
  );
}

export function ComposerModePicker({
  choices,
  onPick,
  open,
  onOpenChange,
  settings,
}: {
  choices: DropdownMenuAction[];
  onPick: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: boolean;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const selected = choices.find((choice) => choice.checked);
  return (
    <div className="relative flex shrink-0">
      {/* oxlint-disable-next-line bycoda/transcript-row-trigger -- opens the Mode menu from the composer, not a transcript row */}
      <Button
        ref={anchor}
        size="sm"
        variant={settings ? "secondary" : "ghost"}
        iconOnly={!settings}
        label={t("Mode")}
        selected={open}
        aria-haspopup="menu"
        aria-expanded={open}
        expanded={settings ? open : undefined}
        data-composer-mode-trigger
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        {settings ? (selected?.label ?? t("Default")) : <SlidersHorizontal className="icon-sm" />}
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          returnFocusRef={anchor}
          label={t("Mode")}
          side="top"
          align={settings ? "end" : "start"}
          size="md"
          onClose={() => onOpenChange(false)}
          data-composer-mode-menu
          items={[{ kind: "group", id: "mode", label: t("Mode"), items: choices }]}
          onPick={onPick}
        />
      ) : null}
    </div>
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
      iconOnly
      selected
      label={t("Turn off {p0}", { p0: pill.title })}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClear}
    >
      <Icon className="icon-sm" />
    </Button>
  );
}
