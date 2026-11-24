import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useT } from "../../../shared/i18n";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { observeResize } from "../../../shared/lib/observeResize";
import { Text } from "../../../shared/ui/Text";
import { ContextMenu } from "../../../shared/ui/ContextMenu";
import {
  ComposerAttachmentPreview,
  ComposerSkillReference,
  UnavailableReference,
} from "./ComposerReferenceActions";
import { resizeComposer } from "../model/composerResize";
import { attachComposerInlineInput } from "./composerInlineInput";
import { attachNativeHistory, type NativeHistory } from "./composerInlineHistory";
import { INLINE_LINE_LIMIT, hasLongLine, keepsNativeField } from "./composerInlineLongLine";
import { inlineComposerWidgets } from "./composerInlineWidgets";
import {
  composerInlineReferences,
  isInlineMentionMark,
  type InlineReference,
  type InlineReferenceContext,
} from "./composerInlineReferences";
import styles from "./ComposerInlineEditor.module.css";
import { ComposerCitations } from "./ComposerCitations";
import type { ComposerCitation } from "../model/chatCitation";

type Props = {
  field: RefObject<HTMLTextAreaElement | null>;
  text: string;
  references: InlineReferenceContext;
  attachmentProjectRoot?: string;
  label: string;
  placeholder: string;
  readOnly: boolean;
  disabled: boolean;
  spellCheck: boolean;
  hasSubagents: boolean;
  onInlineAttachments: (ids: ReadonlySet<string> | null) => void;
  onRemoveAttachment: (id: string) => void;
  onChangeCitations: (citations: ComposerCitation[], removed?: number) => void;
};

/** Inline reference widgets share the composer's original draft and dispatch endpoint. */
export function ComposerInlineEditor({
  field,
  text,
  references,
  attachmentProjectRoot,
  label,
  placeholder,
  readOnly,
  disabled,
  spellCheck,
  hasSubagents,
  onInlineAttachments,
  onRemoveAttachment,
  onChangeCitations,
}: Props) {
  const t = useT();
  const mount = useRef<HTMLDivElement>(null);
  const editor = useRef<{
    input: ReturnType<typeof attachComposerInlineInput>;
    widgets: ReturnType<typeof inlineComposerWidgets>;
  } | null>(null);
  const [opened, setOpened] = useState<{ reference: InlineReference; anchor: HTMLElement } | null>(
    null,
  );
  const settings = { label, placeholder, readOnly, disabled, spellCheck };
  const [menu, setMenu] = useState<{ reference: InlineReference; anchor: HTMLElement } | null>(
    null,
  );
  const current = useStableCallback(() => ({ settings, references }));
  const open = useStableCallback((reference: InlineReference, anchor: HTMLElement) => {
    if (reference.kind === "file") references.onOpenFile?.(reference.value);
    else setOpened({ reference, anchor });
  });
  const remove = useStableCallback((id: string) => {
    onRemoveAttachment(id);
    field.current?.focus();
  });
  const openMenu = useStableCallback((reference: InlineReference, anchor: HTMLElement) =>
    setMenu({ reference, anchor }),
  );
  const openLabel = useStableCallback((reference: InlineReference) =>
    reference.kind === "attachment" || reference.kind === "file"
      ? t("Open {p0}", { p0: reference.label })
      : reference.label,
  );

  // A draft with a very long line stays in the native field (see composerInlineLongLine.ts).
  const native = useRef(false);
  // Undo history of the editor that left, applied to the native field until an editor returns.
  const held = useRef<NativeHistory | null>(null);
  const settle = useRef<number | null>(null);

  const activate = useStableCallback(() => {
    const input = field.current;
    const parent = mount.current;
    if (
      !input ||
      !parent ||
      editor.current ||
      held.current?.composing ||
      !parent.parentElement?.clientWidth ||
      !input.value
    )
      return;
    native.current = keepsNativeField(input.value, native.current);
    if (native.current) {
      if (!held.current) held.current = attachNativeHistory(input);
      return;
    }
    const configuration = current();
    // Highlight-only mentions already work in the textarea and do not need replacement widgets.
    const references = composerInlineReferences(input.value, configuration.references);
    if (references.every(isInlineMentionMark)) return;
    const widgets = inlineComposerWidgets(configuration.references, {
      onInlineAttachments,
      open,
      remove,
      menu: openMenu,
      openLabel,
    });
    const seed = held.current?.release();
    held.current = null;
    editor.current = {
      widgets,
      input: attachComposerInlineInput(
        input,
        parent,
        configuration.settings,
        widgets.extension,
        seed,
      ),
    };
    widgets.reportAttachments(editor.current.input.view.state);
  });

  const leave = useStableCallback(() => {
    const mounted = editor.current;
    const input = field.current;
    if (!mounted || !input) return;
    const { view } = mounted.input;
    const focused = view.hasFocus || view.root.activeElement === view.contentDOM;
    const state = view.state;
    editor.current = null;
    native.current = true;
    // The view already wrote its text and selection to the field; destroy restores the field's own methods.
    mounted.input.destroy();
    held.current?.release();
    held.current = attachNativeHistory(input, state);
    onInlineAttachments(null);
    // The parent shows the field again in the re-render this state change flushes before the microtask.
    queueMicrotask(() => {
      if (!input.isConnected) return;
      resizeComposer(input);
      if (!focused) return;
      input.focus();
      if (input.selectionEnd === input.value.length) input.scrollTop = input.scrollHeight;
    });
  });

  // An open composition ends in the view that started it; leave once it has settled.
  const leaveWhenIdle = useStableCallback(() => {
    const view = editor.current?.input.view;
    if (view && (view.composing || view.compositionStarted)) return;
    if (settle.current !== null) window.clearInterval(settle.current);
    settle.current = null;
    if (view && hasLongLine(view.state.doc.toString(), INLINE_LINE_LIMIT)) flushSync(leave);
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Mount once when a referenced draft has a visible field, and dispose it with that field.
  useEffect(() => {
    const container = mount.current?.parentElement;
    const input = field.current;
    if (!container || !input) return;
    const afterComposition = () => queueMicrotask(activate);
    input.addEventListener("compositionend", afterComposition);
    const stop = observeResize(container, activate);
    activate();
    return () => {
      stop();
      input.removeEventListener("compositionend", afterComposition);
      if (settle.current !== null) window.clearInterval(settle.current);
      settle.current = null;
      held.current?.release();
      held.current = null;
      editor.current?.input.destroy();
      editor.current = null;
    };
  }, [activate, field]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronize external drafts and editor settings after the composer writes to its input endpoint.
  useLayoutEffect(() => {
    const mounted = editor.current;
    if (!mounted) {
      held.current?.sync();
      if (native.current) activate();
      return;
    }
    if (hasLongLine(text, INLINE_LINE_LIMIT)) {
      const { view } = mounted.input;
      if (!view.composing && !view.compositionStarted) {
        leave();
        return;
      }
      if (settle.current === null) settle.current = window.setInterval(leaveWhenIdle, 50);
    }
    mounted.input.sync();
    mounted.input.configure({ label, placeholder, readOnly, disabled, spellCheck });
  }, [text, label, placeholder, readOnly, disabled, spellCheck, activate, leave, leaveWhenIdle]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronize widgets after attachments, files or skill catalogs change in the mounted view.
  useLayoutEffect(() => {
    activate();
    const mounted = editor.current;
    if (mounted) mounted.input.view.dispatch({ effects: mounted.widgets.configure.of(references) });
  }, [activate, references]);

  const active = opened?.anchor.isConnected ? opened : null;
  const reference = active?.reference;
  const attachment =
    reference?.kind === "attachment"
      ? references.attachments.find((item) => item.id === reference.value)
      : undefined;
  const group =
    reference?.kind === "group"
      ? references.skillGroups?.find((item) => item.invocation === reference.value)
      : undefined;
  const skill =
    reference?.kind === "skill" ? references.skillDetails?.get(reference.value) : undefined;
  const close = () => setOpened(null);
  return (
    <>
      <Text
        as="div"
        size="body"
        tone="neutral"
        ref={mount}
        className={styles.mount}
        data-subagents={hasSubagents || undefined}
      />
      {active && reference?.kind === "file-comment" && references.citationSources ? (
        <ComposerCitations
          key={reference.value}
          citations={references.citationSources}
          disabled={readOnly || disabled}
          onChange={onChangeCitations}
          openFileComment={{ id: reference.value, anchor: active.anchor }}
          onCloseFileComment={close}
        />
      ) : null}
      {active && attachment ? (
        <ComposerAttachmentPreview
          key={attachment.id}
          attachment={attachment}
          projectRoot={attachmentProjectRoot}
          anchor={active.anchor}
          close={close}
        />
      ) : null}
      {active && reference?.kind === "missing" ? (
        <UnavailableReference anchor={active.anchor} name={reference.label} close={close} />
      ) : null}
      {active && reference && (group || reference.kind === "skill") ? (
        <ComposerSkillReference
          anchor={active.anchor}
          label={reference.label}
          group={group}
          skill={skill}
          close={close}
          onOpenFile={references.onOpenFile}
        />
      ) : null}
      {menu?.anchor.isConnected ? (
        <ContextMenu
          anchor={menu.anchor}
          items={[
            { kind: "item", id: "open", label: t("Open {p0}", { p0: menu.reference.label }) },
            {
              kind: "item",
              id: "remove",
              label: t("Remove {p0}", { p0: menu.reference.label }),
              danger: true,
              disabled: readOnly || disabled,
            },
          ]}
          onPick={(id) => {
            setMenu(null);
            if (id === "remove") remove(menu.reference.value);
            else open(menu.reference, menu.anchor);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}
