import {
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { useT } from "../../../shared/i18n";
import {
  mentionLabel,
  mentionTokenAt,
  replaceMentionToken,
  type MentionToken,
} from "../../files/public/fileMentions";
import { peekProjectFiles } from "../../files/public/fileIndex";
import { rememberWorkItemMention } from "../../inbox/public/workItemMentions";
import { isNoteMentionPath } from "../../notes";
import { looksLikeProject } from "../../projects/public/recents";
import {
  dollarTokenAt,
  hasNativeCommands,
  rankSkills,
  replaceSlashToken,
  slashTokenAt,
  type Skill,
  type SlashToken,
  SkillPicker,
} from "../../skills/public/skillPicker";
import { isSkillGroupPickerItem, skillGroupInsertion } from "../../skills/public/skillGroups";
import { composerMentionScopeHintOf, scopedNoteMentionLabel } from "../model/composerMentionScopes";
import { tokenSyncUnchanged } from "../model/composerTokenSync";
import { CREWS_MENTION_SCOPE, crewMentionOf } from "../model/crewMentions";
import { insertTemplateBody } from "../model/promptTemplates";
import {
  parseServerMentionQuery,
  serverMentionAliasHint,
  serverMentionOf,
} from "../model/serverMentions";
import type { HarnessId } from "../model/session";
import { workItemMentionOf } from "../model/workItemMentionRows";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { FileMentionPicker } from "./FileMentionPicker";
import { keepEqualToken } from "./keepEqualToken";
import { useComposerMentionSources } from "./useComposerMentionSources";
import { useComposerSlashInventory } from "./useComposerSlashInventory";

/** The chat scope the queued message's `/` and `@` menus read from. */
export type QueuedEditSuggestionScope = {
  harness: HarnessId;
  executionCwd: string;
  sessionId?: string;
  remote: boolean;
  remotePlan: boolean;
  notesEnabled: boolean;
};

export type QueuedEditSuggestionsHandle = {
  /** Reads the token under the caret after an input, click or selection change. */
  sync: (field: HTMLTextAreaElement, skipUnchanged?: boolean) => void;
  /** True when an open menu consumed the key. */
  keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Starts a skill token at the end of the draft and opens the list. */
  openSkills: () => void;
  /** Closes an open menu; false when none was open. */
  dismiss: () => boolean;
};

/**
 * The composer's skill and mention menus for a queued message. Bycoda commands
 * are left out: they act on the composer or set the intent at send time, and a
 * queued message already has its intent.
 */
export function QueuedEditSuggestions({
  ref,
  scope,
  parentSessionId,
  field,
  anchor,
  canEdit,
  onEdit,
  onError,
}: {
  ref: Ref<QueuedEditSuggestionsHandle>;
  scope: QueuedEditSuggestionScope;
  parentSessionId?: string;
  field: RefObject<HTMLTextAreaElement | null>;
  anchor: RefObject<HTMLDivElement | null>;
  canEdit: () => boolean;
  onEdit: (text: string, caret: number) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const { harness, executionCwd, sessionId, remote, remotePlan, notesEnabled } = scope;
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [mention, setMention] = useState<MentionToken | null>(null);
  const [skillSelection, setSkillSelection] = useState({ query: "", index: 0 });
  const [mentionSelection, setMentionSelection] = useState({ query: "", index: 0 });
  const lastSync = useRef<Parameters<typeof tokenSyncUnchanged>[0]>(null);
  const mentionOpen =
    mention !== null &&
    (looksLikeProject(executionCwd) ||
      (!remote &&
        (notesEnabled ||
          serverMentionAliasHint(mention.query) !== undefined ||
          parseServerMentionQuery(mention.query) !== null)));
  const inventory = useComposerSlashInventory({
    harness,
    executionCwd,
    sessionId,
    pickerOpen: slash !== null,
    remote,
    remotePlan,
    hideOrchestrator: true,
    canStartNewSession: false,
    canSaveDraft: false,
    canResumeProviderSession: false,
    slashTrigger: slash?.trigger,
    slashQuery: slash?.query ?? "",
  });
  const skills = inventory.rankedSkills.filter((skill) => skill.kind !== "builtin");
  const mentions = useComposerMentionSources({
    executionCwd,
    remote,
    notesEnabled,
    mentionOpen,
    mentionQuery: mention?.query ?? "",
  });
  const files = mentions.rankedFiles;
  const skillActive =
    skillSelection.query === (slash?.query ?? "")
      ? Math.max(0, Math.min(skillSelection.index, skills.length - 1))
      : 0;
  const mentionActive =
    mentionSelection.query === (mention?.query ?? "")
      ? Math.max(0, Math.min(mentionSelection.index, files.length - 1))
      : 0;
  const selectSkill = (index: number) => setSkillSelection({ query: slash?.query ?? "", index });
  const selectMention = (index: number) =>
    setMentionSelection({ query: mention?.query ?? "", index });

  const pickSkill = useStableCallback((skill: Skill) => {
    const el = field.current;
    const token = slash;
    setSlash(null);
    if (!el || !token || !canEdit()) return;
    if (isSkillGroupPickerItem(skill)) {
      const original = el.value;
      void skillGroupInsertion(
        skill.groupId,
        { harness, cwd: executionCwd, sessionId },
        token.trigger ?? "/",
      )
        .then((body) => {
          if (!body || !canEdit() || field.current !== el || el.value !== original) return;
          const spacer = el.value.slice(token.end).startsWith(" ") ? "" : " ";
          const edit = insertTemplateBody(el.value, token.start, token.end, body + spacer);
          onEdit(edit.text, edit.caret + (spacer ? 0 : 1));
          el.focus();
        })
        .catch(() => onError(t("Could not insert skill group")));
      return;
    }
    if (skill.kind === "template") {
      const edit = insertTemplateBody(el.value, token.start, token.end, skill.body);
      onEdit(edit.text, edit.caret);
    } else {
      const next = replaceSlashToken(el.value, token, skill.invocation);
      let caret = token.start + skill.invocation.length + 1;
      if (next[caret] === " ") caret += 1;
      onEdit(next, caret);
    }
    el.focus();
  });

  const pickMention = (file: (typeof files)[number]) => {
    const el = field.current;
    const token = mention;
    if (!el || !token || !canEdit()) {
      setMention(null);
      return;
    }
    const workItem = workItemMentionOf(file);
    const server = serverMentionOf(file);
    const scopeHint = composerMentionScopeHintOf(file);
    const crew = crewMentionOf(file);
    const hint = Boolean(scopeHint || workItem?.kind === "hint" || server?.hint);
    if (workItem?.kind === "item") rememberWorkItemMention(workItem.item);
    const label =
      workItem?.token ??
      server?.token ??
      scopeHint ??
      (crew ? `${CREWS_MENTION_SCOPE}${crew.token}` : undefined) ??
      (isNoteMentionPath(file.path)
        ? scopedNoteMentionLabel(file.relative)
        : remote
          ? file.relative
          : mentionLabel(file, mentions.mentionIndex));
    const next = replaceMentionToken(el.value, token, label, !hint);
    let caret = token.start + label.length + 1;
    if (!hint && next[caret] === " ") caret += 1;
    onEdit(next, caret);
    setMention(
      hint ? { start: token.start, end: token.start + label.length + 1, query: label } : null,
    );
    el.focus();
  };

  /** Arrow, Tab and Enter keys of one open list. */
  const listKey = <Item,>(
    event: KeyboardEvent<HTMLTextAreaElement>,
    items: Item[],
    active: number,
    select: (index: number) => void,
    pick: (item: Item) => void,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length > 0) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        select((active + step + items.length) % items.length);
      }
      return true;
    }
    if (event.key !== "Tab" && (event.key !== "Enter" || event.shiftKey)) return false;
    if (event.ctrlKey || event.metaKey) return false;
    const item = items[active];
    if (!item) return false;
    event.preventDefault();
    pick(item);
    return true;
  };

  useImperativeHandle(ref, () => ({
    sync: (el, skipUnchanged = false) => {
      const { selectionStart, selectionEnd, value } = el;
      const cursor = selectionStart === selectionEnd ? selectionStart : null;
      const snapshot = { value, cursor, context: [inventory.dollarSkills, harness] };
      // A trailing keyup or select must not reopen a menu Escape just closed.
      if (skipUnchanged && tokenSyncUnchanged(lastSync.current, snapshot)) return;
      lastSync.current = snapshot;
      if (cursor === null) {
        setSlash(null);
        setMention(null);
        return;
      }
      const token = slashTokenAt(value, cursor, hasNativeCommands(harness));
      const dollar = token ? null : dollarTokenAt(value, cursor);
      setSlash(
        keepEqualToken(
          token ??
            (dollar && rankSkills(inventory.dollarSkills, dollar.query, 1).length > 0
              ? dollar
              : null),
        ),
      );
      setMention(keepEqualToken(token ? null : mentionTokenAt(value, cursor)));
    },
    keyDown: (event) => {
      if (slash) return listKey(event, skills, skillActive, selectSkill, pickSkill);
      if (mentionOpen) return listKey(event, files, mentionActive, selectMention, pickMention);
      return false;
    },
    openSkills: () => {
      const el = field.current;
      if (!el || !canEdit()) return;
      const prefix = harness === "codex" ? "$" : "/";
      const lead = el.value && !/\s$/.test(el.value) ? " " : "";
      const start = el.value.length + lead.length;
      const next = el.value + lead + prefix;
      onEdit(next, next.length);
      setMention(null);
      setSlash({
        start,
        end: next.length,
        query: "",
        ...(prefix === "$" ? { trigger: "$" as const } : {}),
      });
      setSkillSelection({ query: "", index: 0 });
      el.focus();
    },
    dismiss: () => {
      if (!slash && !mentionOpen) return false;
      setSlash(null);
      setMention(null);
      return true;
    },
  }));

  if (slash) {
    return (
      <ComposerSuggestions anchor={anchor} below={false} matchComposer>
        <SkillPicker
          parentSessionId={parentSessionId}
          skills={skills}
          prefix={slash.trigger ?? "/"}
          showCreate={false}
          query={slash.query}
          active={skillActive}
          creating={false}
          cwd={executionCwd}
          error={null}
          busy={false}
          onActive={selectSkill}
          onPick={pickSkill}
          onStartCreate={() => {}}
          onCancelCreate={() => {}}
          onCreate={() => {}}
        />
      </ComposerSuggestions>
    );
  }
  if (!mentionOpen) return null;
  return (
    <ComposerSuggestions anchor={anchor} below={false} solid matchComposer>
      <FileMentionPicker
        files={files}
        query={mention.query}
        active={mentionActive}
        loading={
          mentions.serversLoading ||
          mentions.workItemsLoading ||
          mentions.scopeLoading ||
          (!mentions.serversScoped &&
            !mentions.workItemsScoped &&
            !mentions.scope &&
            looksLikeProject(executionCwd) &&
            peekProjectFiles(executionCwd) == null)
        }
        workItemsScoped={mentions.workItemsScoped}
        scope={mentions.scope}
        serversScoped={mentions.serversScoped}
        includeServers={mentions.serversAvailable}
        includeWorkItems={mentions.workItemsAvailable}
        workItemsFailure={mentions.workItemsFailure}
        failed={mentions.serversScoped ? mentions.serversFailed : mentions.filesFailed}
        indexNotice={mentions.filesIndexNotice}
        onRetry={mentions.serversScoped ? mentions.retryServers : mentions.retryFiles}
        includeNotes={notesEnabled}
        onActive={selectMention}
        onPick={pickMention}
      />
    </ComposerSuggestions>
  );
}
