import { PickerListRoot } from "../../../shared/ui/picker/PickerList";
import { isSkillGroupPickerItem } from "../model/skillGroupPicker";
import { Text } from "../../../shared/ui/Text";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ClampText } from "../../../shared/ui/ClampText";
import { Alert } from "../../../shared/ui/Alert";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { ListRow } from "../../../shared/ui/ListRow";
import { skillPickerDescription, skillScopeLabel } from "../model/skillPickerLabels";
import { t, useLocale } from "../../../shared/i18n";
import { Plus } from "../../../shared/ui/icons";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { isLocalProject } from "../../projects/model/recents";
import { isValidSkillName, slugSkillName, type Skill } from "../model/skills";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  retainParentInput,
  useParentInputClosure,
  useParentInputsClosed,
  mutateParentInput,
} from "../../sessions/data/parentInputClosure";

type Props = {
  parentSessionId?: string;
  skills: Skill[];
  /** What a row starts with: `/` for commands, `$` for Codex skills. */
  prefix?: "/" | "$";
  query: string;
  active: number;
  creating: boolean;
  cwd: string;
  compact?: boolean;
  showCreate?: boolean;
  error?: string | null;
  busy?: boolean;
  /** Id of the listbox; rows derive their ids from it so an owning field can reference the active row. */
  listId?: string;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
};

/** Stable id of the row at `index`, for `aria-activedescendant` on the owning field. */
export function skillOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

export function SkillPicker({
  parentSessionId,
  skills,
  prefix = "/",
  query,
  active,
  creating,
  cwd,
  compact = false,
  showCreate = true,
  error,
  busy,
  listId,
  onActive,
  onPick,
  onStartCreate,
  onCancelCreate,
  onCreate,
}: Props) {
  useLocale();
  return (
    <div data-skill-picker className="flex min-h-0 flex-col">
      {creating ? (
        <CreateSkillForm
          parentSessionId={parentSessionId}
          query={query}
          cwd={cwd}
          error={error}
          busy={busy}
          onCancel={onCancelCreate}
          onCreate={onCreate}
        />
      ) : (
        <>
          <SkillList
            skills={skills}
            prefix={prefix}
            query={query}
            active={active}
            compact={compact}
            listId={listId}
            onActive={onActive}
            onPick={onPick}
          />
          {showCreate ? (
            <div className="flex shrink-0 justify-end px-3 pb-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onStartCreate}
              >
                <Plus className="icon-sm shrink-0" strokeWidth={1.75} aria-hidden />
                {t("New skill")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function SkillList({
  skills,
  prefix,
  query,
  active,
  compact,
  listId,
  onActive,
  onPick,
}: {
  skills: Skill[];
  prefix: "/" | "$";
  query: string;
  active: number;
  compact?: boolean;
  listId?: string;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
}) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [skills]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  if (skills.length === 0) {
    return (
      <EmptyState
        size="inline"
        kind={query.trim() ? "filtered" : "empty"}
        description={query.trim() ? t("No matching commands or skills") : t("No commands yet")}
        inset="row"
      />
    );
  }

  return (
    <PickerListRoot
      ref={lockOverscroll}
      id={listId}
      label={t("Commands and skills")}
      onMouseMove={onListMouseMove}
      className={`${compact ? "max-h-48" : "max-h-[min(240px,40vh)]"} overflow-y-auto overscroll-none px-1 py-1`}
    >
      {skills.map((skill, index) => {
        const highlighted = index === active;
        return (
          <Fragment
            key={
              isSkillGroupPickerItem(skill)
                ? `group:${skill.groupId}`
                : `${skill.kind}:${skill.source}:${skill.invocation}`
            }
          >
            {sectionOf(skill) !== (index > 0 ? sectionOf(skills[index - 1]) : "commands") ? (
              <Text
                as="p"
                size="caption"
                tone="secondary"
                weight="medium"
                className="px-2 pb-0.5 pt-1.5"
              >
                {SECTION_HEADINGS[sectionOf(skill)]()}
              </Text>
            ) : null}
            <ListRow
              className={compact ? undefined : "flex-col items-start justify-center"}
              data-has-description={compact ? undefined : ""}
              ref={highlighted ? activeRef : undefined}
              id={listId ? skillOptionId(listId, index) : undefined}
              role="option"
              aria-selected={highlighted}
              active={highlighted}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onRowEnter(index)}
              onClick={() => onPick(skill)}
            >
              <span className="flex min-w-0 w-full items-baseline gap-2">
                <Text size="secondary" tone="inherit" truncate>
                  {prefix}
                  {skill.invocation}
                </Text>
                <Text size="caption" tone="secondary" className="shrink-0">
                  {isSkillGroupPickerItem(skill)
                    ? t("{p0} skills", { p0: skill.memberCount })
                    : skillScopeLabel(skill)}
                </Text>
              </span>
              {!compact && skill.description ? (
                <ClampText as="span" lines={2} expandable={false} size="caption" tone="secondary">
                  {skillPickerDescription(skill)}
                </ClampText>
              ) : null}
              {!compact &&
              skill.kind === "native" &&
              (skill.inputHint || skill.subcommands?.length) ? (
                <ClampText
                  as="span"
                  lines={2}
                  expandable={false}
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                >
                  {skill.inputHint ||
                    skill.subcommands?.map((sub) => sub.usage || sub.name).join(" · ")}
                </ClampText>
              ) : null}
            </ListRow>
          </Fragment>
        );
      })}
    </PickerListRoot>
  );
}

/** Shared starter-skill form for the composer picker and Settings. */
export function CreateSkillForm({
  parentSessionId,
  query,
  cwd,
  monospace = true,
  className = "px-2.5 py-2",
  error,
  busy,
  onCancel,
  onCreate,
}: {
  parentSessionId?: string;
  query: string;
  cwd: string;
  monospace?: boolean;
  className?: string;
  error?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
}): ReactNode {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  const project = isLocalProject(cwd);
  const [name, setName] = useState(() => slugSkillName(query));
  const [scope, setScope] = useState<"project" | "user">(project ? "project" : "user");
  const form = useRef<HTMLFormElement>(null);
  const parentClosed = useParentInputsClosed(parentSessionId);
  const parentInput = useParentInputClosure(
    {
      kind: "composer-parent",
      sessionId: parentSessionId,
      snapshot: () => ({
        source: "create-skill-form",
        rawName: input.current?.value ?? name,
        name,
        scope,
        query,
        cwd,
        project,
        busy,
        error,
      }),
    },
    form,
  );

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const slug = slugSkillName(name);
  const valid = isValidSkillName(slug);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy || !parentInput.canMutate()) return;
    mutateParentInput(parentInput, () => {
      const data = {
        source: "create-skill-intent",
        rawName: input.current?.value ?? name,
        name,
        slug,
        scope: project ? scope : "user",
        cwd,
      };
      const retained = retainParentInput({
        kind: "composer-parent",
        sessionId: parentSessionId,
        snapshot: () => data,
      });
      onCreate(slug, project ? scope : "user");
      retained.update({ ...data, disposition: "accepted-unknown" });
    });
  };

  return (
    <form
      ref={form}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        parentInput();
        onCancel();
      }}
      className={className}
    >
      <TextField
        monospace={monospace}
        label={t("Skill name")}
        ref={input}
        value={name}
        spellCheck={false}
        placeholder={t("skill-name")}
        error={
          !error && name.trim() && !valid
            ? t("Use lowercase letters, numbers, and hyphens.")
            : undefined
        }
        disabled={busy}
        readOnly={parentClosed}
        onChange={(e) => {
          if (parentInput.canMutate()) setName(e.target.value);
        }}
      />
      {parentClosed ? (
        <Text as="p" size="micro" tone="secondary" role="status" className="mb-2">
          {t("Preparing session checkpoint. Your draft is kept.")}
        </Text>
      ) : null}
      <RadioGroup
        compact
        label={t("Scope")}
        value={scope}
        disabled={busy || parentClosed}
        onValueChange={(value) => {
          if (parentInput.canMutate()) setScope(value as "project" | "user");
        }}
        options={[
          {
            value: "project",
            label: t("Project"),
            description: project
              ? ".agents/skills"
              : t("Open a local project to enable project scope."),
            disabled: !project,
          },
          {
            value: "user",
            label: t("Personal"),
            description: "~/.agents/skills",
          },
        ]}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={busy}
          onClick={() => {
            parentInput();
            onCancel();
          }}
        >
          {t("Cancel")}
        </Button>
        <Button variant="ghost" size="sm" type="submit" disabled={!valid || busy || parentClosed}>
          {busy ? t("Creating…") : t("Create")}
        </Button>
      </div>
    </form>
  );
}

type PickerSection = "commands" | "groups" | "templates";

const SECTION_HEADINGS: Record<PickerSection, () => string> = {
  commands: () => t("Commands and skills"),
  groups: () => t("Skill groups"),
  templates: () => t("Templates"),
};

function sectionOf(skill: Skill): PickerSection {
  if (skill.kind !== "template") return "commands";
  return isSkillGroupPickerItem(skill) ? "groups" : "templates";
}
