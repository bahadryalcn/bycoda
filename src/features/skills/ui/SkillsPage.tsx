import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Alert } from "../../../shared/ui/Alert";
import { TextField } from "../../../shared/ui/TextField";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { NoteMarkdownEditor } from "../../notes/ui/NoteMarkdownEditor";
import type { EditorView } from "@codemirror/view";
import styles from "./SkillsPage.module.css";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  CloudUpload,
  Copy,
  Eye,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { confirmNative } from "../../source-control/model/gitConfirmation";
import { canTransferSkill, SkillExistsError, transferSkill } from "../model/transferSkill";
import { CreateSkillForm } from "./SkillPicker";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";
import { MarkdownSource } from "../../sessions/ui/AgentMarkdown";
import { SkillDocumentPreview } from "./SkillDocumentPreview";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  exportSkill,
  deleteSkill,
  listSkills,
  readTextFile,
  writeTextFile,
  type DiscoveredSkill,
} from "../../../platform/tauri/fs";
import {
  createBlankSkill,
  invalidateSkills,
  loadDisabledSkillPaths,
  saveDisabledSkillPaths,
  SKILLS_CHANGE_EVENT,
} from "../model/skills";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { knownRemoteMachine, useRemoteMachines } from "../../connections/model/connections";
import { remoteProjectMachines } from "../../connections/model/localSync";
import { classifyRemoteError } from "../../connections/model/remoteFailure";
import { listMachineSkills } from "../model/machineSkills";
import { canDeleteSkill } from "../model/deleteSkill";
import { AdvancedSettings, Segmented, Toggle } from "../../settings/ui/settingsControls";

/** A connected machine whose skills are listed: `cwd` is its open project
 * (a `remote://` path), or empty for its personal skills only. */
type Machine = { environmentId: string; name: string; cwd: string };

/** Why a machine's skills could not be listed, in words the user can act on. */
function machineFailure(machine: Machine, error: unknown): string {
  const failure = classifyRemoteError(error);
  const outdated = `${machine.name}'s ${PRODUCT_IDENTITY.displayName} Host needs updating to list skills. Update it in Connections settings.`;
  if (failure.kind === "outdated" || /needs updating/i.test(failure.message)) return outdated;
  if (failure.kind === "unreachable") return `Couldn't reach ${machine.name}.`;
  // A current host accepts an empty project; an older one rejects it as a path.
  if (!machine.cwd && /Invalid workspace path|outside this machine/i.test(failure.message))
    return outdated;
  return failure.message;
}

/** Inspect and manage file skills without modifying provider-owned catalogs. */
export function SkillsPage({ cwd, header }: { cwd: string; header?: ReactNode }): ReactNode {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const previewId = useId();
  const previewOpener = useRef<string | null>(null);
  const previewButtons = useRef(new Map<string, HTMLButtonElement>());
  const filterInput = useRef<HTMLInputElement>(null);
  const closePreview = useRef<HTMLButtonElement>(null);
  const addSkillButton = useRef<HTMLButtonElement>(null);
  const [skills, setSkills] = useState<DiscoveredSkill[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletePending = useRef(false);
  // Every connected machine's skills are listed under this computer's; the
  // machine that owns the open project also lists that project's skills.
  const remoteProject = remoteProjectFor(cwd);
  const projectMachine = remoteProject?.environmentId;
  const { machines: connected } = useRemoteMachines();
  const machines = useMemo<Machine[]>(() => {
    const list = remoteProjectMachines(connected).map((machine) => ({
      environmentId: machine.environmentId,
      name: machine.name,
      cwd: machine.environmentId === projectMachine ? cwd : "",
    }));
    if (projectMachine && !list.some((entry) => entry.environmentId === projectMachine))
      list.push({
        environmentId: projectMachine,
        name: knownRemoteMachine(projectMachine)?.name ?? "Other machine",
        cwd,
      });
    return list;
  }, [connected, projectMachine, cwd]);
  const [machineLists, setMachineLists] = useState<
    Record<string, { skills: DiscoveredSkill[] | null; error: string | null }>
  >({});
  // The "Copy to ..." menu of a row on this computer, when several machines are connected.
  const [copyMenu, setCopyMenu] = useState<{
    skill: DiscoveredSkill;
    anchor: HTMLElement;
  } | null>(null);
  const [query, setQuery] = useRetainedState(`skills:${pathKey(cwd)}:query`, "");
  const [actionsMenu, setActionsMenu] = useState<{
    skill: DiscoveredSkill;
    machine: Machine | null;
    anchor: HTMLElement;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [disabledPaths, setDisabledPaths] = useState<string[]>(() => loadDisabledSkillPaths());
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState("");
  // Path of the skill being copied to the other machine, if any.
  const [transferring, setTransferring] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<DiscoveredSkill | null>(null);
  // The machine a previewed skill is read from; null for this computer.
  const [previewMachine, setPreviewMachine] = useState<Machine | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useMarkdownMode(`skill:${previewSkill?.path ?? ""}`);
  const previewOpen = previewSkill !== null;
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const editorView = useRef<EditorView | null>(null);
  const editable = previewSkill !== null && !previewMachine && canDeleteSkill(previewSkill);
  const draft = previewSkill ? (drafts[previewSkill.path] ?? previewText) : null;
  const dirty = draft !== null && previewText !== null && draft !== previewText;

  const onSave = async (): Promise<void> => {
    if (!previewSkill || !editable || draft === null || !dirty || savePending.current) return;
    const path = previewSkill.path;
    const content = draft;
    savePending.current = true;
    setSaving(true);
    setActionError(null);
    setActionResult("");
    try {
      // Refuse to overwrite an edit made outside this screen since it was read.
      if ((await readTextFile(path)) !== previewText)
        throw new Error(
          t("SKILL.md changed on disk. Reopen the skill before saving; your draft is kept."),
        );
      await writeTextFile(path, content);
      setPreviewText(content);
      setDrafts((current) => {
        if (current[path] !== content) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      invalidateSkills();
      window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
      setActionResult(t("Skill saved."));
      setReload((value) => value + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  const onPreview = (
    skill: DiscoveredSkill,
    trigger: "name" | "icon",
    machine: Machine | null = null,
  ): void => {
    if (savePending.current) return;
    setActionsMenu(null);
    setEditing(trigger === "name" && !machine && canDeleteSkill(skill));
    previewOpener.current = `${trigger}:${skill.path}`;
    setPreviewMachine(machine);
    if (previewSkill?.path !== skill.path) {
      setPreviewText(null);
      setPreviewError(null);
    }
    setPreviewSkill(skill);
  };

  const registerPreviewButton =
    (key: string) =>
    (button: HTMLButtonElement | null): void => {
      if (button) previewButtons.current.set(key, button);
      else previewButtons.current.delete(key);
    };

  useEffect(() => {
    if (!previewOpen) return;
    closePreview.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      if (savePending.current) return;
      setPreviewSkill(null);
    };
    // Handle body focus after controls, before Settings' window listener.
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // A rescan replaces row elements, so restore by skill and trigger identity.
      const opener = previewButtons.current.get(previewOpener.current ?? "");
      const target = opener ?? filterInput.current;
      if (target?.isConnected) target.focus();
    };
  }, [previewOpen]);

  useEffect(() => {
    let cancelled = false;
    setPreviewText(null);
    setPreviewError(null);
    if (!previewSkill) return;
    // A skill on another machine usually lives in its home folder, outside
    // every project, where the host's file commands cannot read; the export
    // command can, so the preview takes SKILL.md from it.
    const path = previewSkill.path;
    const load = isRemoteProjectPath(path)
      ? exportSkill(path, previewMachine?.cwd ?? "").then((bundle) => {
          const file = bundle.files.find((entry) => entry.path.toLowerCase() === "skill.md");
          if (!file) throw new Error("SKILL.md is missing.");
          const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
          return new TextDecoder().decode(bytes);
        })
      : readTextFile(path);
    void load
      .then((text) => {
        if (!cancelled) setPreviewText(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreviewError(
            `Could not read SKILL.md. ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewSkill, previewMachine]);

  useEffect(() => {
    let cancelled = false;
    const remote = isRemoteProjectPath(cwd);
    setSkills(null);
    setError(null);
    // This computer's own skills always; with a remote project, without the
    // project folder, which lives on the other machine.
    listSkills(remote ? "" : cwd)
      .then((next) => {
        if (cancelled) return;
        setSkills(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, reload]);

  // Each machine loads on its own, so a slow or offline one holds nothing up.
  const machinesKey = machines
    .map((machine) => `${machine.environmentId}\n${machine.cwd}`)
    .join("\0");
  useEffect(() => {
    let cancelled = false;
    setMachineLists({});
    for (const machine of machines) {
      const settle = (value: { skills: DiscoveredSkill[] | null; error: string | null }) => {
        if (!cancelled)
          setMachineLists((current) => ({ ...current, [machine.environmentId]: value }));
      };
      listMachineSkills(machine.environmentId, machine.cwd)
        .then((skills) => settle({ skills, error: null }))
        .catch((err: unknown) => settle({ skills: null, error: machineFailure(machine, err) }));
    }
    return () => {
      cancelled = true;
    };
    // `machines` is keyed by `machinesKey`: a new list of the same machines must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machinesKey, reload]);

  useEffect(() => {
    const onChange = (): void => setDisabledPaths(loadDisabledSkillPaths());
    window.addEventListener(SKILLS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SKILLS_CHANGE_EVENT, onChange);
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = (list: DiscoveredSkill[] | null) =>
    (list ?? []).filter(
      (skill) =>
        !needle ||
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle) ||
        skill.source.toLowerCase().includes(needle) ||
        skill.path.toLowerCase().includes(needle),
    );
  const filtered = useMemo(() => matches(skills), [needle, skills]);
  const machineShown = useMemo(
    () =>
      machines.map((machine) => {
        const all = machineLists[machine.environmentId]?.skills ?? null;
        return { machine, all, shown: matches(all) };
      }),
    [needle, machines, machineLists],
  );
  const shownCount =
    filtered.length + machineShown.reduce((sum, entry) => sum + entry.shown.length, 0);

  const onToggle = (path: string, enabled: boolean): void => {
    setActionResult("");
    const next = enabled ? disabledPaths.filter((item) => item !== path) : [...disabledPaths, path];
    try {
      saveDisabledSkillPaths(next);
      setActionError(null);
      setActionResult(t("Catalog preference saved on this computer."));
    } catch {
      setActionError("Could not save the skill preference. Try again.");
    }
  };

  const onReveal = (path: string): void => {
    setActionResult("");
    setActionError(null);
    void revealItemInDir(path).catch((err: unknown) => {
      setActionError(
        `Could not open the folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const onCopyPath = (path: string): void => {
    setActionResult("");
    setActionError(null);
    void copyText(path)
      .then(() => setActionResult(t("Path copied.")))
      .catch(() => {
        setActionError("Could not copy the path to the clipboard.");
      });
  };

  const onCreate = (name: string, scope: "project" | "user"): void => {
    setActionResult("");
    setBusy(true);
    setCreateError(null);
    void createBlankSkill({ cwd, name, scope })
      .then((path) => {
        setActionResult(t("Created {p0}.", { p0: name }));
        onPreview({ path, name, scope, source: "agents", description: "" }, "name");
        invalidateSkills();
        window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
        setAdding(false);
        setReload((value) => value + 1);
      })
      .catch((err: unknown) => {
        setCreateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setBusy(false));
  };

  /** Copies a skill into the personal skills of the other end: `from` and `to`
   * are machines, null being this computer. */
  const onTransfer = async (
    skill: DiscoveredSkill,
    from: Machine | null,
    to: Machine | null,
  ): Promise<void> => {
    if (deletePending.current) return;
    const targetName = to?.name ?? t("this computer");
    const move = {
      skill,
      // Listed without the project folder when that lives on another machine.
      sourceCwd: from ? from.cwd : remoteProject ? "" : cwd,
      targetCwd: "",
      ...(to ? { targetMachine: to.environmentId } : {}),
    };
    setActionError(null);
    setTransferring(skill.path);
    setActionResult("");
    try {
      try {
        await transferSkill({ ...move, overwrite: false });
      } catch (err) {
        if (!(err instanceof SkillExistsError)) throw err;
        const replace = await confirmNative(
          t("A skill named {p0} already exists on {p1}. Replace it?", {
            p0: err.skillName,
            p1: targetName,
          }),
          "Replace",
        );
        if (!replace) return;
        await transferSkill({ ...move, overwrite: true });
      }
      setActionResult(
        t("Copied {p0} to personal skills on {p1}.", { p0: skill.name, p1: targetName }),
      );
      setReload((value) => value + 1);
    } catch (err) {
      setActionError(
        `Could not copy ${skill.name} to ${targetName}. ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setTransferring(null);
    }
  };

  const onDelete = async (
    skill: DiscoveredSkill,
    machine: Machine | null = null,
  ): Promise<void> => {
    if (deletePending.current) return;
    deletePending.current = true;
    setDeleting(skill.path);
    setActionResult("");
    setActionError(null);
    try {
      const confirmed = await confirmNative(
        t(
          "Delete {p0} from {p1}? Its entire folder and supporting files will be permanently deleted. This cannot be undone.\n\n{p2}",
          { p0: skill.name, p1: machine?.name ?? t("this computer"), p2: skill.path },
        ),
        "Delete",
      );
      if (!confirmed) return;
      await deleteSkill(skill.path, machine?.cwd ?? (remoteProject ? "" : cwd));
      // Read current preferences because a switch may have changed while awaiting confirmation.
      const disabled = loadDisabledSkillPaths();
      try {
        saveDisabledSkillPaths(disabled.filter((path) => path !== skill.path));
      } catch {
        invalidateSkills();
        window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
      }
      setPreviewSkill((current) => (current?.path === skill.path ? null : current));
      setCopyMenu((current) => (current?.skill.path === skill.path ? null : current));
      setActionsMenu((current) => (current?.skill.path === skill.path ? null : current));
      setActionResult(
        t("Deleted {p0} from {p1}.", { p0: skill.name, p1: machine?.name ?? t("this computer") }),
      );
      setReload((value) => value + 1);
    } catch (err) {
      setActionError(
        `Could not delete ${skill.name}. ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      deletePending.current = false;
      setDeleting(null);
    }
  };

  const renderRow = (skill: DiscoveredSkill, machine: Machine | null = null) => {
    const disabled = disabledPaths.includes(skill.path);
    const selected = previewSkill?.path === skill.path;
    const modified = drafts[skill.path] !== undefined;
    return (
      <div key={skill.path} className={styles.row} data-selected={selected || undefined}>
        <div className={styles.rowTitle}>
          <Button
            variant="item"
            selected={selected}
            className={styles.name}
            aria-label={skill.name}
            ref={registerPreviewButton(`name:${skill.path}`)}
            aria-controls={previewOpen ? previewId : undefined}
            aria-expanded={selected}
            tooltip={skill.description || skill.name}
            disabled={saving}
            onClick={() => onPreview(skill, "name", machine)}
          >
            <span className={styles.truncate}>{skill.name}</span>
            {modified ? <span title={t("Draft")}>·</span> : null}
          </Button>
          {!machine ? (
            <Toggle
              label={t("Include {p0} in {p1} catalog", {
                p0: skill.name,
                p1: PRODUCT_IDENTITY.displayName,
              })}
              on={!disabled}
              onChange={(enabled) => onToggle(skill.path, enabled)}
            />
          ) : null}
        </div>
        <div className={styles.rowActions}>
          <Button
            variant="ghost"
            iconOnly
            label={t("Preview skill {p0}", { p0: skill.name })}
            tooltip={t("Preview skill")}
            ref={registerPreviewButton(`icon:${skill.path}`)}
            aria-controls={previewOpen ? previewId : undefined}
            aria-expanded={selected}
            disabled={saving}
            onClick={() => onPreview(skill, "icon", machine)}
          >
            <Eye className="size-3.5" aria-hidden="true" />
          </Button>
          {canTransferSkill(skill) && (machine || machines.length > 0) ? (
            <Button
              variant="ghost"
              iconOnly
              label={
                machine
                  ? t("Copy {p0} to this computer", { p0: skill.name })
                  : machines.length === 1
                    ? t("Copy {p0} to {p1}", { p0: skill.name, p1: machines[0].name })
                    : t("Copy {p0} to another machine", { p0: skill.name })
              }
              tooltip={
                modified
                  ? t("Save or discard the draft before transferring.")
                  : machine
                    ? t("Copy to this computer")
                    : t("Copy to another machine")
              }
              loading={transferring === skill.path}
              disabled={modified || transferring !== null || deleting !== null || saving}
              aria-haspopup={!machine && machines.length > 1 ? "menu" : undefined}
              onClick={(event) => {
                setActionsMenu(null);
                if (machine) void onTransfer(skill, machine, null);
                else if (machines.length === 1) void onTransfer(skill, null, machines[0]);
                else setCopyMenu({ skill, anchor: event.currentTarget });
              }}
            >
              <CloudUpload className="size-3.5" aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            iconOnly
            label={t("Actions for {p0}", { p0: skill.name })}
            tooltip={t("Actions for {p0}", { p0: skill.name })}
            aria-haspopup="menu"
            aria-expanded={actionsMenu?.skill.path === skill.path}
            onClick={(event) => {
              setCopyMenu(null);
              setActionsMenu({ skill, machine, anchor: event.currentTarget });
            }}
          >
            <MoreHorizontal className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  };

  const renderList = (
    all: DiscoveredSkill[] | null,
    shown: DiscoveredSkill[],
    failure: string | null,
    machine: Machine | null = null,
  ) =>
    failure ? (
      <Alert tone="danger" role="alert">
        {failure}
      </Alert>
    ) : all === null ? (
      <Alert tone="info" role="status">
        {t("Loading skills…")}
      </Alert>
    ) : shown.length === 0 ? (
      <p className={styles.message}>
        {all.length
          ? t("No matching skills")
          : machine
            ? t("No skills on this machine.")
            : t("No skills yet. Add skill creates a starter SKILL.md.")}
      </p>
    ) : (
      shown.map((skill) => renderRow(skill, machine))
    );

  const actionFeedback = (
    <>
      {actionError ? (
        <Alert tone="danger" role="alert">
          {actionError}
        </Alert>
      ) : null}
      {actionResult ? (
        <Alert tone="info" role="status">
          {actionResult}
        </Alert>
      ) : null}
      {busy || deleting || transferring ? (
        <Alert tone="info" role="status">
          {busy ? t("Creating…") : deleting ? t("Deleting…") : t("Copying…")}
        </Alert>
      ) : null}
    </>
  );

  return (
    <div className={styles.page}>
      <section className={styles.library} aria-label={t("Skills")}>
        <header className={styles.libraryHeader}>
          <div className={styles.headingRow}>
            {header ? <div className={styles.heading}>{header}</div> : <h1>{t("Skills")}</h1>}
            <Button
              variant="ghost"
              iconOnly
              label={t("Refresh skills")}
              tooltip={t("Rescan skill folders")}
              disabled={(skills === null && !error) || saving}
              onClick={() => {
                invalidateSkills();
                window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
                setReload((value) => value + 1);
              }}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              ref={addSkillButton}
              variant="secondary"
              disabled={busy}
              aria-label={adding ? t("Close skill form") : t("Add skill")}
              onClick={() => {
                setAdding((value) => !value);
                setCreateError(null);
              }}
            >
              {adding ? t("Close") : t("Add skill")}
            </Button>
          </div>
          <div className={styles.count}>
            {skills === null ? "…" : t("{p0} skills shown", { p0: shownCount })}
          </div>
          <TextField
            ref={filterInput}
            type="search"
            label={t("Filter skills")}
            hideLabel
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search skills")}
            aria-label={t("Filter skills")}
            spellCheck={false}
            autoComplete="off"
          />
        </header>
        {!previewSkill ? actionFeedback : null}
        <div ref={lockOverscroll} className={styles.list}>
          {adding ? (
            <CreateSkillForm
              key={cwd}
              query={query}
              cwd={cwd}
              monospace={false}
              showScopeHelp
              error={createError}
              busy={busy}
              onCancel={() => {
                setAdding(false);
                setCreateError(null);
                addSkillButton.current?.focus();
              }}
              onCreate={onCreate}
            />
          ) : null}
          <details open className={styles.machine}>
            <summary>
              {t("This computer")} <span>{filtered.length}</span>
            </summary>
            {renderList(skills, filtered, error)}
          </details>
          {machineShown.map(({ machine, all, shown }) => (
            <details
              open
              key={machine.environmentId}
              className={styles.machine}
              aria-label={t("Skills on {p0}", { p0: machine.name })}
            >
              <summary>
                {machine.name} <span>{shown.length}</span>
              </summary>
              {renderList(all, shown, machineLists[machine.environmentId]?.error ?? null, machine)}
            </details>
          ))}
          <AdvancedSettings
            title={t("Advanced: catalog visibility and skill folders")}
            settingIds={["skill-folders"]}
          >
            <p
              id="setting-skill-folders"
              data-setting-id="skill-folders"
              tabIndex={-1}
              className={styles.message}
            >
              {t(
                "Hidden skills stay on disk and are excluded from {p0}'s file-skill catalog. Provider-managed skills and native commands are unaffected. Project skills live in {p1}, personal skills in {p2}; harness folders are also included.",
                { p0: PRODUCT_IDENTITY.displayName, p1: ".agents/skills", p2: "~/.agents/skills" },
              )}
            </p>
          </AdvancedSettings>
        </div>
        <footer className={styles.libraryFooter} title={cwd}>
          <FolderOpen className="size-3.5" aria-hidden="true" />
          <span className={styles.truncate}>{cwd}</span>
        </footer>
      </section>
      <div className={styles.workspace}>
        {previewSkill ? actionFeedback : null}
        {previewSkill ? (
          <aside id={previewId} aria-label={t("Skill preview")} className={styles.detail}>
            <header className={styles.detailHeader}>
              <div className={styles.headingRow}>
                <h2>{previewSkill.name}</h2>
                <Button
                  ref={closePreview}
                  variant="ghost"
                  iconOnly
                  label={t("Close skill preview")}
                  tooltip={t("Close preview (Escape)")}
                  disabled={saving}
                  onClick={() => setPreviewSkill(null)}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
              <p className={styles.meta}>
                {previewSkill.scope === "user"
                  ? t("Personal")
                  : previewSkill.scope === "builtin"
                    ? PRODUCT_IDENTITY.displayName
                    : t("Project")}{" "}
                · {previewSkill.source} · {previewMachine?.name ?? t("This computer")}
              </p>
              <p className={styles.path} title={previewSkill.path}>
                {previewSkill.path}
              </p>
              {previewSkill.description ? (
                <p className={styles.description}>{previewSkill.description}</p>
              ) : null}
              {!canDeleteSkill(previewSkill) ? (
                <p className={styles.meta}>
                  {t("Managed skill: deletion is controlled by the provider, plugin or app.")}
                </p>
              ) : null}
              {previewMachine ? (
                <p className={styles.meta}>{t("Copy this skill to this computer to edit it.")}</p>
              ) : null}
              <div className={styles.toolbar}>
                <span className={styles.fileLabel}>SKILL.md</span>
                <Segmented
                  label={t("Markdown view")}
                  value={editing ? "edit" : previewMode}
                  options={[
                    ...(editable ? [{ value: "edit", label: t("Edit") }] : []),
                    { value: "preview", label: t("Preview") },
                    { value: "source", label: t("Source") },
                  ]}
                  onChange={(mode) => {
                    setEditing(mode === "edit");
                    if (mode === "preview" || mode === "source") setPreviewMode(mode);
                  }}
                />
                {editable && drafts[previewSkill.path] !== undefined ? (
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() =>
                      setDrafts((current) => {
                        const next = { ...current };
                        delete next[previewSkill.path];
                        return next;
                      })
                    }
                  >
                    {t("Discard changes")}
                  </Button>
                ) : null}
                {editable ? (
                  <Button
                    variant="primary"
                    loading={saving}
                    disabled={!dirty || previewText === null}
                    onClick={() => void onSave()}
                  >
                    {t("Save")}
                  </Button>
                ) : null}
              </div>
            </header>
            <div key={previewSkill.path} className={styles.document}>
              {previewError ? (
                <Alert tone="danger" role="alert">
                  {previewError}
                </Alert>
              ) : draft === null ? (
                <Alert tone="info" role="status">
                  {t("Loading skill…")}
                </Alert>
              ) : editing && editable ? (
                <NoteMarkdownEditor
                  value={draft}
                  viewRef={editorView}
                  minHeight={320}
                  label={t("Skill instructions")}
                  onChange={(text) =>
                    setDrafts((current) => ({ ...current, [previewSkill.path]: text }))
                  }
                  onSave={() => void onSave()}
                />
              ) : previewMode === "preview" ? (
                <SkillDocumentPreview text={draft} />
              ) : (
                <MarkdownSource text={draft} />
              )}
            </div>
            <footer className={styles.detailFooter}>
              <span>{dirty ? t("Unsaved changes") : t("Saved")}</span>
              <span>{editing ? t("Ctrl/Cmd+S to save") : t("Markdown")}</span>
            </footer>
          </aside>
        ) : (
          <EmptyState
            title={t("Select a skill")}
            description={t("Choose a skill to view or edit its instructions.")}
          />
        )}
      </div>
      {actionsMenu ? (
        <DropdownMenu
          anchor={actionsMenu.anchor}
          label={t("Actions for {p0}", { p0: actionsMenu.skill.name })}
          align="end"
          onClose={() => setActionsMenu(null)}
          onPick={(id) => {
            const { skill, machine } = actionsMenu;
            if (id === "copy") onCopyPath(skill.path);
            else if (id === "reveal") onReveal(skill.path);
            else if (id === "delete") void onDelete(skill, machine);
          }}
          items={[
            {
              kind: "item",
              id: "copy",
              label: t("Copy path of {p0}", { p0: actionsMenu.skill.name }),
              icon: <Copy className="size-3.5" />,
            },
            ...(!actionsMenu.machine
              ? [
                  {
                    kind: "item" as const,
                    id: "reveal",
                    label: t("Reveal {p0} in file explorer", { p0: actionsMenu.skill.name }),
                    icon: <FolderOpen className="size-3.5" />,
                  },
                ]
              : []),
            ...(canDeleteSkill(actionsMenu.skill)
              ? [
                  {
                    kind: "item" as const,
                    id: "delete",
                    label: t("Delete {p0}", { p0: actionsMenu.skill.name }),
                    title: t("Delete skill permanently"),
                    danger: true,
                    disabled: deleting !== null || transferring !== null || saving,
                    icon: <Trash2 className="size-3.5" />,
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {copyMenu ? (
        <DropdownMenu
          anchor={copyMenu.anchor}
          label={t("Copy {p0} to", { p0: copyMenu.skill.name })}
          align="end"
          onClose={() => setCopyMenu(null)}
          onPick={(id) => {
            const machine = machines.find((item) => item.environmentId === id);
            if (machine) void onTransfer(copyMenu.skill, null, machine);
          }}
          items={machines.map((machine) => ({
            kind: "item",
            id: machine.environmentId,
            label: machine.name,
          }))}
        />
      ) : null}
    </div>
  );
}
