import { isSkillGroupPickerItem } from "../model/skillGroupPicker";
import { Text } from "../../../shared/ui/Text";
import { ClampText } from "../../../shared/ui/ClampText";
import { Alert } from "../../../shared/ui/Alert";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
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
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
};

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
  onActive,
  onPick,
  onStartCreate,
  onCancelCreate,
  onCreate,
}: Props) {
  useLocale();
  return (
    <div
      data-skill-picker
      className={
        compact
          ? "overflow-hidden"
          : "overflow-hidden rounded-(--ui-radius-card) border border-(--ui-card-border)"
      }
    >
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
            onActive={onActive}
            onPick={onPick}
          />
          {showCreate ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onStartCreate}
              className="flex w-full items-center gap-2"
            >
              <Plus className="icon-sm shrink-0" strokeWidth={1.75} />
              {t("New skill")}
            </Button>
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
  onActive,
  onPick,
}: {
  skills: Skill[];
  prefix: "/" | "$";
  query: string;
  active: number;
  compact?: boolean;
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
      <Text as="p" size="caption" tone="secondary" className="px-3 py-2.5">
        {query.trim() ? t("No matching commands or skills") : t("No commands yet")}
      </Text>
    );
  }

  return (
    <div
      ref={lockOverscroll}
      role="listbox"
      aria-label={t("Commands and skills")}
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
            {skill.kind === "template" &&
            (skills[index - 1]?.kind !== "template" ||
              isSkillGroupPickerItem(skill) !==
                (skills[index - 1] ? isSkillGroupPickerItem(skills[index - 1]) : false)) ? (
              <Text
                as="p"
                size="caption"
                tone="secondary"
                weight="medium"
                className="px-2 pb-0.5 pt-1.5"
              >
                {isSkillGroupPickerItem(skill) ? t("Skill groups") : t("Templates")}
              </Text>
            ) : null}
            <Button
              variant="item"
              motion="none"
              fullWidth
              layout={compact ? "inline" : "stacked"}
              ref={highlighted ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={highlighted}
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
                  {isSkillGroupPickerItem(skill) ? skill.description : scopeLabel(skill)}
                </Text>
              </span>
              {!compact && skill.description ? (
                <ClampText as="span" lines={2} expandable={false} size="caption" tone="secondary">
                  {skill.description}
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
            </Button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Shared starter-skill form for the composer picker and Settings. */
export function CreateSkillForm({
  parentSessionId,
  query,
  cwd,
  monospace = true,
  showScopeHelp = false,
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
  showScopeHelp?: boolean;
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
      <Text as="p" size="micro" tone="secondary" className="mb-2">
        {t("Writes a starter SKILL.md you can edit.")}
      </Text>
      <TextField
        monospace={monospace}
        label={t("Skill name")}
        ref={input}
        value={name}
        spellCheck={false}
        placeholder={t("skill-name")}
        aria-label={t("Skill name")}
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
            description: ".agents/skills",
            disabled: !project,
          },
          { value: "user", label: t("Personal"), description: "~/.agents/skills" },
        ]}
      />
      {showScopeHelp ? (
        <Text
          as="p"
          size="caption"
          tone="secondary"
          className="[margin-block-end:0.5rem] break-all"
        >
          {project && scope === "project"
            ? t("Creates a starter in {p0}.agents/skills. Edit SKILL.md after creation.", {
                p0: `${cwd.replace(/[\\/]+$/, "")}/`,
              })
            : t("Creates a starter in ~/.agents/skills on this computer.")}
          {!project ? ` ${t("Open a local project to enable project scope.")}` : ""}
        </Text>
      ) : null}
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !name.trim() || valid ? null : (
        <Text as="p" size="caption" tone="secondary" className="mb-2">
          {t("Use lowercase letters, numbers, and hyphens.")}
        </Text>
      )}
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

function scopeLabel(skill: Skill): string {
  if (skill.kind === "native") {
    return skill.origin ? `${skill.source} · ${skill.origin}` : skill.source;
  }
  if (skill.kind === "builtin") return PRODUCT_IDENTITY.displayName;
  if (skill.kind === "template") return "template";
  if (skill.scope === "user") return "personal";
  if (skill.source !== "agents" && skill.source !== "bycoda") return skill.source;
  return "project";
}
