import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import type { HarnessId } from "../../sessions/model/session";
import {
  hasNativeCommands,
  rankSkills,
  replaceSlashToken,
  skillTextParts,
  slashTokenAt,
  type Skill,
  type SlashToken,
} from "../model/skills";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { useKeyedActiveIndex } from "../../../shared/hooks/useKeyedActiveIndex";
import { SkillPicker } from "./SkillPicker";
import { Popover } from "../../../shared/ui/Popover";
import { PromptField } from "../../../shared/ui/PromptField";
import { DraftToken } from "../../../shared/ui/DraftToken";
import { Sparkles } from "../../../shared/ui/icons";
import { useComposerSkills } from "../../sessions/ui/useComposerSkills";

type Props = {
  value: string;
  harness: HarnessId;
  cwd: string;
  onChange: (value: string) => void;
  /** Accessible name; defaults to "Instructions". */
  label?: string;
  placeholder?: string;
  /** Smallest height in lines (default 4). */
  minRows?: number;
  maxRows?: number;
  /** Tallest height in pixels before the editor scrolls. */
  maxHeight?: number;
  surface?: "default" | "raised";
  /** Pickers and toggles inside the frame, below the editor. */
  toolbarLeading?: ReactNode;
  toolbarTrailing?: ReactNode;
  frameProps?: ComponentProps<typeof PromptField>["frameProps"];
  /** `false` when a bordered ancestor with `data-ui-focus-group` already is the frame. */
  framed?: boolean;
};

/** Automation instructions field with the composer's slash-skill behavior. */
export function SkillPromptField({
  value,
  harness,
  cwd,
  onChange,
  label = "Instructions",
  placeholder = "Tell the agent what to do when this automation runs…",
  minRows = 4,
  maxRows,
  maxHeight,
  surface,
  toolbarLeading,
  toolbarTrailing,
  frameProps,
  framed,
}: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const slashAnchorRef = useRef<HTMLSpanElement>(null);
  const slashRef = useRef<SlashToken | null>(null);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  slashRef.current = slash;

  const skillCatalog = useComposerSkills({
    harness,
    executionCwd: cwd,
    pickerOpen: slash !== null,
  });
  const skills = skillCatalog.skills;
  const rankedSkills = useMemo(
    () =>
      rankSkills(
        skills,
        slash?.query ?? "",
        hasNativeCommands(harness) ? Number.POSITIVE_INFINITY : undefined,
      ),
    [harness, skills, slash?.query],
  );
  const skillNames = useMemo(() => new Set(skills.map((skill) => skill.invocation)), [skills]);

  const [active, setActive] = useKeyedActiveIndex(
    `${harness}\u0000${cwd}\u0000${slash?.query ?? ""}`,
    rankedSkills.length,
  );

  const syncSlashToken = useCallback(
    (field: HTMLTextAreaElement) => {
      const cursor = field.selectionStart ?? 0;
      setSlash(slashTokenAt(field.value, cursor, hasNativeCommands(harness)));
    },
    [harness],
  );

  const pickSkill = useCallback(
    (skill: Skill) => {
      const field = fieldRef.current;
      const token = slashRef.current;
      if (!field || !token) {
        setSlash(null);
        return;
      }

      const next = replaceSlashToken(field.value, token, skill.invocation);
      field.value = next;
      let cursor = token.start + skill.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      field.setSelectionRange(cursor, cursor);
      onChange(next);
      setSlash(null);
      field.focus();
    },
    [onChange],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(event.nativeEvent) || !slash) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rankedSkills.length > 0) {
        setActive((index) => (index + 1) % rankedSkills.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rankedSkills.length > 0) {
        setActive((index) => (index - 1 + rankedSkills.length) % rankedSkills.length);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSlash(null);
      return;
    }
    if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
      const skill = rankedSkills[active];
      if (!skill) return;
      event.preventDefault();
      pickSkill(skill);
    }
  };

  return (
    <PromptField
      ref={fieldRef}
      label={label}
      minRows={minRows}
      maxRows={maxRows}
      maxHeight={maxHeight}
      surface={surface}
      framed={framed}
      frameProps={frameProps}
      toolbarLeading={toolbarLeading}
      toolbarTrailing={toolbarTrailing}
      overlay={
        <SkillPromptHighlight
          text={value}
          names={skillNames}
          slash={slash}
          anchorRef={slashAnchorRef}
        />
      }
      spellCheck={false}
      aria-haspopup="listbox"
      aria-expanded={slash !== null}
      value={value}
      onBlur={() => setSlash(null)}
      onChange={(event) => {
        const field = event.currentTarget;
        onChange(field.value);
        syncSlashToken(field);
      }}
      onClick={(event) => syncSlashToken(event.currentTarget)}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key !== "Escape") syncSlashToken(event.currentTarget);
      }}
      onSelect={(event) => syncSlashToken(event.currentTarget)}
      placeholder={placeholder}
    >
      {slash ? (
        <Popover
          key={slash.start}
          anchor={slashAnchorRef}
          side="bottom"
          align="start"
          gap={4}
          width={300}
          maxHeight={194}
          motion="none"
          onDismiss={() => setSlash(null)}
          data-skill-suggestions
        >
          <SkillPicker
            skills={rankedSkills}
            query={slash.query}
            active={active}
            creating={false}
            cwd={cwd}
            compact
            showCreate={false}
            onActive={setActive}
            onPick={pickSkill}
            onStartCreate={() => undefined}
            onCancelCreate={() => undefined}
            onCreate={() => undefined}
          />
        </Popover>
      ) : null}
    </PromptField>
  );
}

function SkillPromptHighlight({
  text,
  names,
  slash,
  anchorRef,
}: {
  text: string;
  names: ReadonlySet<string>;
  slash: SlashToken | null;
  anchorRef: Ref<HTMLSpanElement>;
}) {
  const parts = skillTextParts(text, names);
  let offset = 0;

  return (
    <>
      {parts.map((part, index) => {
        const start = offset;
        const end = start + part.text.length;
        offset = end;
        const anchorAt = slash?.start;
        const anchorInside = anchorAt !== undefined && anchorAt >= start && anchorAt < end;
        const localAnchor = anchorInside ? anchorAt - start : -1;
        const content = anchorInside ? (
          <>
            {part.text.slice(0, localAnchor)}
            <span ref={anchorRef} data-skill-anchor className="inline-block">
              {part.text[localAnchor]}
            </span>
            {part.text.slice(localAnchor + 1)}
          </>
        ) : (
          part.text
        );

        return part.skill ? (
          <DraftToken
            key={index}
            className="text-skill"
            prefix={
              localAnchor === 0 ? (
                <span ref={anchorRef} data-skill-anchor className="inline-block">
                  {part.text[0]}
                </span>
              ) : (
                part.text[0]
              )
            }
            icon={<Sparkles />}
          >
            {localAnchor > 0 ? (
              <>
                {part.text.slice(1, localAnchor)}
                <span ref={anchorRef} data-skill-anchor className="inline-block">
                  {part.text[localAnchor]}
                </span>
                {part.text.slice(localAnchor + 1)}
              </>
            ) : (
              part.text.slice(1)
            )}
          </DraftToken>
        ) : (
          <span key={index}>{content}</span>
        );
      })}
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
}
