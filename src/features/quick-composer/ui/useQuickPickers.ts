import { useCallback, useMemo, useRef, useState, type SetStateAction } from "react";
import { OPERATOR_COMMAND } from "../../sessions/model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../../sessions/model/orchestratorCommand";
import { PLAN_COMMAND } from "../../sessions/model/plan";
import { DRAFT_COMMAND } from "../../sessions/model/draftCommand";
import {
  rankSkills,
  replaceSlashToken,
  slashTokenAt,
  type SlashToken,
} from "../../skills/model/slashCommands";
import { filterQuickProjects } from "../model/quickComposer";
import type { QuickComposerOwner } from "../model/quickComposerClosure";
import type { QuickWorkspace } from "../model/quickWorkspace";

/** Commands the floating composer offers after a leading `/`. */
export const MODE_COMMANDS = [PLAN_COMMAND, OPERATOR_COMMAND, ORCHESTRATOR_COMMAND, DRAFT_COMMAND];

export type QuickPicker = "project" | "model" | "permissions" | "attachments" | "commands";
type OpenablePicker = Exclude<QuickPicker, "commands">;

export interface QuickPickersInput {
  owner: QuickComposerOwner;
  /** Owned by QuickComposer; submit and the prompt bridge share the same ref. */
  promptRef: { readonly current: HTMLTextAreaElement | null };
  projects: string[];
  cwd: string | null;
  /** True while a launch is in flight; blocks the command picker from opening. */
  busy: boolean;
  gitOpen: boolean;
  focusPrompt: () => void;
  setPrompt: (value: SetStateAction<string>) => void;
  setCwd: (value: SetStateAction<string | null>) => void;
  setWorkspaceChoice: (value: QuickWorkspace) => void;
}

/** Project/model/permission/attachment/slash-command picker state and handlers. */
export function useQuickPickers({
  owner,
  promptRef,
  projects,
  cwd,
  busy,
  gitOpen,
  focusPrompt,
  setPrompt,
  setCwd,
  setWorkspaceChoice,
}: QuickPickersInput) {
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [picker, setPicker] = useState<QuickPicker | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const queryRef = useRef<HTMLInputElement>(null);

  const projectOptions = useMemo(
    () => filterQuickProjects(projects, picker === "project" ? query : ""),
    [picker, projects, query],
  );
  const commandOptions = useMemo(
    () => rankSkills(MODE_COMMANDS, slash?.query ?? ""),
    [slash?.query],
  );
  const optionCount = picker === "commands" ? commandOptions.length : projectOptions.length;

  /** Hides the picker and any slash token; used by show/submit/git-open. */
  const reset = useCallback(() => {
    setPicker(null);
    setSlash(null);
  }, []);
  /** Hides only the picker (attachment actions keep any slash token as is). */
  const hide = useCallback(() => setPicker(null), []);

  const closePicker = () => {
    setPicker(null);
    setSlash(null);
    setQuery("");
    if (picker === "commands") promptRef.current?.focus({ preventScroll: true });
    else focusPrompt();
  };

  const openPicker = (kind: OpenablePicker) => {
    if (!owner.canMutate()) return;
    if (picker === kind) {
      closePicker();
      return;
    }
    setSlash(null);
    setPicker(kind);
    setQuery("");
    setHighlight(Math.max(0, projects.indexOf(cwd ?? "")));
    if (kind === "project")
      requestAnimationFrame(() => queryRef.current?.focus({ preventScroll: true }));
  };

  const chooseAt = (index: number) => {
    if (!owner.canMutate()) return;
    if (picker === "commands") {
      const command = commandOptions[index];
      const field = promptRef.current;
      if (!command || !slash || !field) return;
      // The command stays in the prompt, where it renders with its icon.
      const next = replaceSlashToken(field.value, slash, command.invocation);
      let cursor = slash.start + command.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      field.value = next;
      setPrompt(next);
      setPicker(null);
      setSlash(null);
      requestAnimationFrame(() => {
        field.focus({ preventScroll: true });
        field.setSelectionRange(cursor, cursor);
      });
      return;
    }
    if (picker === "project") {
      const path = projectOptions[index];
      if (!path) return;
      setCwd(path);
      setWorkspaceChoice({ cwd: path });
    }
    closePicker();
  };

  const syncPromptCommand = (field: HTMLTextAreaElement) => {
    const token =
      field.selectionStart === field.selectionEnd
        ? slashTokenAt(field.value, field.selectionStart)
        : null;
    // Operator activates only at the start of a prompt.
    const leading = token && !field.value.slice(0, token.start).trim() ? token : null;
    setSlash(leading);
    if (leading && !busy && !gitOpen) {
      setPicker("commands");
      setHighlight(0);
    } else {
      setPicker((current) => (current === "commands" ? null : current));
    }
  };

  return {
    picker,
    slash,
    query,
    highlight,
    queryRef,
    projectOptions,
    commandOptions,
    optionCount,
    setQuery,
    setHighlight,
    reset,
    hide,
    openPicker,
    closePicker,
    chooseAt,
    syncPromptCommand,
  };
}
