import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
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
import { attachComposerInlineInput } from "./composerInlineInput";
import { inlineComposerWidgets } from "./composerInlineWidgets";
import {
  composerInlineReferences,
  isInlineMentionMark,
  type InlineReference,
  type InlineReferenceContext,
} from "./composerInlineReferences";
import styles from "./ComposerInlineEditor.module.css";

type Props = {
  field: RefObject<HTMLTextAreaElement | null>;
  text: string;
  references: InlineReferenceContext;
  label: string;
  placeholder: string;
  readOnly: boolean;
  disabled: boolean;
  spellCheck: boolean;
  hasSubagents: boolean;
  onReady: (ready: boolean) => void;
  onRemoveAttachment: (id: string) => void;
};

/** Inline reference widgets share the composer's original draft and dispatch endpoint. */
export function ComposerInlineEditor({
  field,
  text,
  references,
  label,
  placeholder,
  readOnly,
  disabled,
  spellCheck,
  hasSubagents,
  onReady,
  onRemoveAttachment,
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

  const activate = useStableCallback(() => {
    const input = field.current;
    const parent = mount.current;
    if (!input || !parent || editor.current || !parent.parentElement?.clientWidth || !input.value)
      return;
    const configuration = current();
    // Highlight-only mentions already work in the textarea and do not need replacement widgets.
    const references = composerInlineReferences(input.value, configuration.references);
    if (references.every(isInlineMentionMark)) return;
    const widgets = inlineComposerWidgets(configuration.references, {
      open,
      remove,
      menu: openMenu,
      openLabel,
    });
    editor.current = {
      widgets,
      input: attachComposerInlineInput(input, parent, configuration.settings, widgets.extension),
    };
    onReady(true);
  });

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Mount once when a referenced draft has a visible field, and dispose it with that field.
  useEffect(() => {
    const container = mount.current?.parentElement;
    if (!container) return;
    const stop = observeResize(container, activate);
    activate();
    return () => {
      stop();
      editor.current?.input.destroy();
      editor.current = null;
    };
  }, [activate, field]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Synchronize external drafts and editor settings after the composer writes to its input endpoint.
  useLayoutEffect(() => {
    const mounted = editor.current;
    if (!mounted) return;
    mounted.input.sync();
    mounted.input.configure({ label, placeholder, readOnly, disabled, spellCheck });
  }, [text, label, placeholder, readOnly, disabled, spellCheck]);

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
      {active && attachment ? (
        <ComposerAttachmentPreview
          key={attachment.id}
          attachment={attachment}
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
