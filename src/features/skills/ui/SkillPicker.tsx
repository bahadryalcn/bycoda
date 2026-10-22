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

type Props = {
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
          : "overflow-hidden rounded-lg border border-(--color-stroke) bg-(--ui-surface)"
      }
    >
      {creating ? (
        <CreateSkillForm
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
              <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
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
      <p className="px-3 py-2.5 text-[12px] text-(--ui-text-secondary)">
        {query.trim() ? t("No matching commands or skills") : t("No commands yet")}
      </p>
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
          <Fragment key={`${skill.kind}:${skill.source}:${skill.invocation}`}>
            {skill.kind === "template" && skills[index - 1]?.kind !== "template" ? (
              <p className="px-2 pb-0.5 pt-1.5 text-[length:var(--ui-font-caption)] font-medium text-(--ui-text-secondary)">
                {t("Templates")}
              </p>
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
                <span className="truncate text-[13px]">
                  {prefix}
                  {skill.invocation}
                </span>
                <span className="shrink-0 text-[length:var(--ui-font-caption)] text-(--ui-text-secondary)">
                  {scopeLabel(skill)}
                </span>
              </span>
              {!compact && skill.description ? (
                <span className="line-clamp-2 ui-caption-text leading-4">{skill.description}</span>
              ) : null}
              {!compact &&
              skill.kind === "native" &&
              (skill.inputHint || skill.subcommands?.length) ? (
                <span className="line-clamp-2 ui-caption-text">
                  {skill.inputHint ||
                    skill.subcommands?.map((sub) => sub.usage || sub.name).join(" · ")}
                </span>
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
  query,
  cwd,
  monospace = true,
  showScopeHelp = false,
  error,
  busy,
  onCancel,
  onCreate,
}: {
  query: string;
  cwd: string;
  monospace?: boolean;
  showScopeHelp?: boolean;
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

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const slug = slugSkillName(name);
  const valid = isValidSkillName(slug);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    onCreate(slug, project ? scope : "user");
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onCancel();
      }}
      className="px-2.5 py-2"
    >
      <p className="mb-2 text-[11px] text-(--ui-text-secondary)">
        {t("Writes a starter SKILL.md you can edit.")}
      </p>
      <TextField
        className={monospace ? "font-mono" : "font-sans"}
        hideLabel
        label={t("Skill name")}
        ref={input}
        value={name}
        spellCheck={false}
        placeholder={t("skill-name")}
        aria-label={t("Skill name")}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />
      <RadioGroup
        compact
        label={t("Scope")}
        value={scope}
        disabled={busy}
        onValueChange={(value) => setScope(value as "project" | "user")}
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
        <p className="[margin-block-end:0.5rem] break-all text-[12px] text-(--ui-text-secondary)">
          {project && scope === "project"
            ? t("Creates a starter in {p0}.agents/skills. Edit SKILL.md after creation.", {
                p0: `${cwd.replace(/[\\/]+$/, "")}/`,
              })
            : t("Creates a starter in ~/.agents/skills on this computer.")}
          {!project ? ` ${t("Open a local project to enable project scope.")}` : ""}
        </p>
      ) : null}
      {error ? (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      ) : !name.trim() || valid ? null : (
        <p className="mb-2 text-[12px] text-(--ui-text-secondary)">
          {t("Use lowercase letters, numbers, and hyphens.")}
        </p>
      )}
      <div className="flex items-center justify-end gap-1">
        <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="ghost" size="sm" type="submit" disabled={!valid || busy}>
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
