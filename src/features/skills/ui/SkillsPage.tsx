import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  CloudUpload,
  Copy,
  Eye,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "../../../shared/ui/icons";
import { confirmNative } from "../../source-control/model/gitConfirmation";
import { canTransferSkill, SkillExistsError, transferSkill } from "../model/transferSkill";
import { CreateSkillForm } from "./SkillPicker";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { MarkdownModeToggle, useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";
import { MarkdownSource } from "../../sessions/ui/AgentMarkdown";
import { SkillDocumentPreview } from "./SkillDocumentPreview";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  exportSkill,
  deleteSkill,
  listSkills,
  readTextFile,
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
import { Popover } from "../../../shared/ui/Popover";
import { canDeleteSkill } from "../model/deleteSkill";

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
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [disabledPaths, setDisabledPaths] = useState<string[]>(() => loadDisabledSkillPaths());
  const [actionError, setActionError] = useState<string | null>(null);
  // Path of the skill being copied to the other machine, if any.
  const [transferring, setTransferring] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<DiscoveredSkill | null>(null);
  // The machine a previewed skill is read from; null for this computer.
  const [previewMachine, setPreviewMachine] = useState<Machine | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useMarkdownMode(`skill:${previewSkill?.path ?? ""}`);
  const previewOpen = previewSkill !== null;

  const onPreview = (
    skill: DiscoveredSkill,
    trigger: "name" | "icon",
    machine: Machine | null = null,
  ): void => {
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
    const next = enabled ? disabledPaths.filter((item) => item !== path) : [...disabledPaths, path];
    try {
      saveDisabledSkillPaths(next);
      setActionError(null);
    } catch {
      setActionError("Could not save the skill preference. Try again.");
    }
  };

  const onReveal = (path: string): void => {
    setActionError(null);
    void revealItemInDir(path).catch((err: unknown) => {
      setActionError(
        `Could not open the folder: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };

  const onCopyPath = (path: string): void => {
    setActionError(null);
    void copyText(path).catch(() => {
      setActionError("Could not copy the path to the clipboard.");
    });
  };

  const onCreate = (name: string, scope: "project" | "user"): void => {
    setBusy(true);
    setCreateError(null);
    void createBlankSkill({ cwd, name, scope })
      .then(() => {
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
    const targetName = to?.name ?? "this computer";
    const move = {
      skill,
      // Listed without the project folder when that lives on another machine.
      sourceCwd: from ? from.cwd : remoteProject ? "" : cwd,
      targetCwd: "",
      ...(to ? { targetMachine: to.environmentId } : {}),
    };
    setActionError(null);
    setTransferring(skill.path);
    try {
      try {
        await transferSkill({ ...move, overwrite: false });
      } catch (err) {
        if (!(err instanceof SkillExistsError)) throw err;
        const replace = await confirmNative(
          `A skill named ${err.skillName} already exists on ${targetName}. Replace it?`,
          "Replace",
        );
        if (!replace) return;
        await transferSkill({ ...move, overwrite: true });
      }
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
    setActionError(null);
    try {
      const confirmed = await confirmNative(
        `Delete ${skill.name} from ${machine?.name ?? "this computer"}? Its entire folder and supporting files will be permanently deleted. This cannot be undone.\n\n${skill.path}`,
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

  const renderDelete = (skill: DiscoveredSkill, machine: Machine | null = null): ReactNode =>
    canDeleteSkill(skill) ? (
      <button
        type="button"
        aria-label={t("Delete {p0}", { p0: skill.name })}
        title={deleting === skill.path ? t("Deleting…") : t("Delete skill permanently")}
        disabled={deleting !== null || transferring !== null}
        onClick={() => void onDelete(skill, machine)}
        className="grid size-6 shrink-0 place-items-center rounded text-content/40 hover:bg-red-400/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
      >
        <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    ) : null;

  /** This computer's skills: rows to preview, switch off or locate. */
  const renderSkills = (
    all: DiscoveredSkill[] | null,
    shown: DiscoveredSkill[],
    failure: string | null,
  ): ReactNode =>
    failure ? (
      <p role="alert" className="text-[12px] text-red-400">
        {failure}
      </p>
    ) : all == null ? (
      <p className="text-[12px] text-content/45">{t("Loading skills…")}</p>
    ) : (
      // About ten rows tall; a longer list scrolls inside its own box so one
      // machine's skills never push the next machine off the page.
      <div className="max-h-[49rem] overflow-y-auto overscroll-contain rounded-lg border border-content/10">
        {shown.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-content/45">
            {all.length === 0
              ? t("No skills yet. Add skill creates a starter SKILL.md.")
              : t("No matching skills")}
          </p>
        ) : (
          shown.map((skill) => {
            const disabled = disabledPaths.includes(skill.path);
            return (
              <div
                key={skill.path}
                className={`border-b border-content/5 px-3 py-2 last:border-b-0 ${previewSkill?.path === skill.path ? "bg-content/5" : ""} ${
                  disabled ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="mr-auto min-w-0 truncate rounded text-left font-sans text-[12px] text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    title={t("Preview {p0}", { p0: skill.name })}
                    ref={registerPreviewButton(`name:${skill.path}`)}
                    aria-controls={previewOpen ? previewId : undefined}
                    aria-expanded={previewSkill?.path === skill.path}
                    onClick={() => onPreview(skill, "name")}
                  >
                    {skill.name}
                  </button>
                  <span className="shrink-0 rounded-full bg-content/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-content/60">
                    {skill.scope === "user"
                      ? t("Personal")
                      : skill.scope === "builtin"
                        ? `${PRODUCT_IDENTITY.displayName}`
                        : t("Project")}
                  </span>
                  <span className="w-20 shrink-0 truncate text-right font-sans text-[11px] text-content/40">
                    {skill.source}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-label={t("Include {p0} in {p1} catalog", {
                      p0: skill.name,
                      p1: PRODUCT_IDENTITY.displayName,
                    })}
                    aria-checked={!disabled}
                    onClick={() => onToggle(skill.path, disabled)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${disabled ? "bg-content/20" : "bg-active"}`}
                  >
                    <span
                      className={`absolute top-0.5 size-4 rounded-full bg-white transition-[left] ${disabled ? "left-0.5" : "left-4.5"}`}
                    />
                  </button>
                </div>
                {skill.description ? (
                  <p
                    className="mt-0.5 truncate text-[12px] text-content/55"
                    title={skill.description}
                  >
                    {skill.description}
                  </p>
                ) : null}
                <div className="mt-0.5 flex items-center gap-1">
                  <p
                    className="min-w-0 flex-1 truncate font-sans text-[11px] text-content/35"
                    title={skill.path}
                  >
                    {skill.path}
                  </p>
                  <button
                    type="button"
                    aria-label={t("Preview skill {p0}", { p0: skill.name })}
                    title={t("Preview skill")}
                    ref={registerPreviewButton(`icon:${skill.path}`)}
                    aria-controls={previewOpen ? previewId : undefined}
                    aria-expanded={previewSkill?.path === skill.path}
                    onClick={() => onPreview(skill, "icon")}
                    className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Eye className="size-3" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("Copy path of {p0}", { p0: skill.name })}
                    title={t("Copy path")}
                    onClick={() => onCopyPath(skill.path)}
                    className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
                  >
                    <Copy className="size-3" strokeWidth={1.75} />
                  </button>
                  {machines.length > 0 && canTransferSkill(skill) ? (
                    <button
                      type="button"
                      aria-label={
                        transferring === skill.path
                          ? t("Copying {p0}…", { p0: skill.name })
                          : machines.length === 1
                            ? t("Copy {p0} to {p1}", { p0: skill.name, p1: machines[0].name })
                            : t("Copy {p0} to another machine", { p0: skill.name })
                      }
                      title={
                        transferring === skill.path
                          ? t("Copying…")
                          : machines.length === 1
                            ? t("Copy to {p0}", { p0: machines[0].name })
                            : t("Copy to another machine")
                      }
                      aria-haspopup={machines.length > 1 ? "menu" : undefined}
                      disabled={transferring !== null || deleting !== null}
                      onClick={(event) =>
                        machines.length === 1
                          ? void onTransfer(skill, null, machines[0])
                          : setCopyMenu({ skill, anchor: event.currentTarget })
                      }
                      className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content disabled:opacity-40"
                    >
                      <CloudUpload className="size-3" strokeWidth={1.75} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={t("Reveal {p0} in file explorer", { p0: skill.name })}
                    title={t("Reveal in file manager")}
                    onClick={() => onReveal(skill.path)}
                    className="grid size-5 shrink-0 place-items-center rounded text-content/40 hover:bg-content/10 hover:text-content"
                  >
                    <FolderOpen className="size-3" strokeWidth={1.75} />
                  </button>
                  {renderDelete(skill)}
                </div>
              </div>
            );
          })
        )}
      </div>
    );

  /** A connected machine's skills: compact name rows with a Transfer button. */
  const renderMachine = (
    machine: Machine,
    all: DiscoveredSkill[] | null,
    shown: DiscoveredSkill[],
  ): ReactNode => {
    const failure = machineLists[machine.environmentId]?.error ?? null;
    if (failure)
      return (
        <p role="alert" className="text-[12px] text-red-400">
          {failure}
        </p>
      );
    if (all == null) return <p className="text-[12px] text-content/45">{t("Loading skills…")}</p>;
    return (
      // About ten compact rows; a longer list scrolls inside its own box.
      <div className="max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-content/10">
        {shown.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-content/45">
            {all.length === 0 ? t("No skills on this machine.") : t("No matching skills")}
          </p>
        ) : (
          shown.map((skill) => (
            <div
              key={skill.path}
              className={`flex items-center gap-2 border-b border-content/5 px-3 py-1.5 last:border-b-0 ${previewSkill?.path === skill.path ? "bg-content/5" : ""}`}
            >
              <button
                type="button"
                className="mr-auto min-w-0 truncate rounded text-left font-sans text-[12px] text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title={skill.description || t("Open {p0}", { p0: skill.name })}
                ref={registerPreviewButton(`name:${skill.path}`)}
                aria-controls={previewOpen ? previewId : undefined}
                aria-expanded={previewSkill?.path === skill.path}
                onClick={() => onPreview(skill, "name", machine)}
              >
                {skill.name}
              </button>
              <span className="shrink-0 text-[11px] text-content/40">
                {skill.scope === "user" ? t("Personal") : t("Project")} · {skill.source}
              </span>
              {renderDelete(skill, machine)}
              {canTransferSkill(skill) ? (
                <button
                  type="button"
                  aria-label={
                    transferring === skill.path
                      ? t("Copying {p0}…", { p0: skill.name })
                      : t("Copy {p0} to this computer", { p0: skill.name })
                  }
                  title={transferring === skill.path ? t("Copying…") : t("Copy to this computer")}
                  disabled={transferring !== null || deleting !== null}
                  onClick={() => void onTransfer(skill, machine, null)}
                  className="shrink-0 rounded-md border border-content/10 px-2 py-0.5 text-[11px] text-content/70 hover:bg-content/10 disabled:opacity-40"
                >
                  {transferring === skill.path ? t("Copying…") : t("Transfer")}
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="@container/skills flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col @3xl/skills:flex-row">
        <div
          ref={lockOverscroll}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none"
        >
          <div className={`mx-auto w-full max-w-5xl py-8 ${previewOpen ? "px-4" : "px-8"}`}>
            {header}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="shrink-0 text-[12px] text-content/40 tabular-nums">
                  {skills == null ? "…" : `${shownCount} ${shownCount === 1 ? "skill" : "skills"}`}
                </span>
                <label className="flex h-7 w-52 min-w-0 flex-1 items-center gap-2 rounded-md border border-content/10 px-2 text-content/45 focus-within:border-content/20">
                  <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <input
                    ref={filterInput}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("Filter")}
                    aria-label={t("Filter skills")}
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-content outline-none placeholder:text-content/35"
                  />
                </label>
                <button
                  type="button"
                  aria-label={t("Refresh skills")}
                  title={t("Rescan skill folders")}
                  disabled={skills === null && !error}
                  onClick={() => {
                    invalidateSkills();
                    window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
                    setReload((value) => value + 1);
                  }}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
                >
                  <RefreshCw className="size-3.5" strokeWidth={1.75} />
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label={adding ? t("Close skill form") : t("Add skill")}
                  ref={addSkillButton}
                  disabled={busy}
                  className="rounded-md border border-content/10 px-2.5 py-1 text-[12px] text-content/70 hover:bg-content/10 disabled:opacity-40"
                  onClick={() => {
                    setAdding((value) => !value);
                    setCreateError(null);
                  }}
                  title={t("Create a starter SKILL.md you can edit")}
                >
                  {adding ? t("Close") : t("Add skill")}
                </button>
              </div>
            </div>

            {adding ? (
              <div className="mb-4 overflow-hidden rounded-lg border border-content/10 bg-content/[0.03]">
                <CreateSkillForm
                  key={cwd}
                  query={query}
                  cwd={cwd}
                  monospace={false}
                  error={createError}
                  busy={busy}
                  onCancel={() => {
                    setAdding(false);
                    setCreateError(null);
                    addSkillButton.current?.focus();
                  }}
                  onCreate={onCreate}
                />
              </div>
            ) : null}

            {actionError ? (
              <p role="alert" className="pb-3 text-[12px] text-red-400">
                {actionError}
              </p>
            ) : null}

            {machines.length > 0 ? (
              <h3 className="pb-2 text-[12px] font-medium text-content/60">{t("This computer")}</h3>
            ) : null}
            {renderSkills(skills, filtered, error)}
            {machineShown.map(({ machine, all, shown }) => (
              <section
                key={machine.environmentId}
                aria-label={t("Skills on {p0}", { p0: machine.name })}
              >
                <h3 className="pt-6 pb-2 text-[12px] font-medium text-content/60">
                  {machine.name}
                </h3>
                {renderMachine(machine, all, shown)}
              </section>
            ))}

            <p className="pt-3 text-[12px] text-content/40">
              {t("Hidden skills stay on disk and are excluded from ")}
              {PRODUCT_IDENTITY.displayName}
              {t(
                "'s file-skill catalog. Provider-managed skills and native commands are unaffected. Skills live in",
              )}{" "}
              <span className="font-sans">{t(".agents/skills")}</span>
              {t(" for this project and ")}
              <span className="font-sans">{"~/.agents/skills"}</span>
              {t(" for you personally; harness folders are also picked up.")}
            </p>
          </div>
        </div>
        {previewSkill ? (
          <aside
            id={previewId}
            aria-label={t("Skill preview")}
            className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-stroke @3xl/skills:max-w-[720px] @3xl/skills:border-t-0 @3xl/skills:border-l"
          >
            <header className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-2">
              <h2 className="min-w-0 flex-1 break-words text-[16px] font-semibold text-content">
                {previewSkill.name}
              </h2>
              {previewMachine && canTransferSkill(previewSkill) ? (
                <button
                  type="button"
                  aria-label={
                    transferring === previewSkill.path
                      ? t("Copying {p0}…", { p0: previewSkill.name })
                      : t("Copy {p0} to this computer", { p0: previewSkill.name })
                  }
                  title={t("Copy to this computer")}
                  disabled={transferring !== null || deleting !== null}
                  onClick={() => void onTransfer(previewSkill, previewMachine, null)}
                  className="shrink-0 rounded-md border border-content/10 px-2 py-0.5 text-[12px] text-content/70 hover:bg-content/10 disabled:opacity-40"
                >
                  {transferring === previewSkill.path ? t("Copying…") : t("Transfer")}
                </button>
              ) : null}
              {renderDelete(previewSkill, previewMachine)}
              <button
                ref={closePreview}
                type="button"
                aria-label={t("Close skill preview")}
                title={t("Close preview (Escape)")}
                onClick={() => setPreviewSkill(null)}
                className="grid size-6 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            </header>
            <div className="shrink-0 space-y-3 border-b border-stroke px-4 pt-1 pb-3">
              <p className="select-text break-all text-[11px] text-content/50">
                {previewMachine ? `${previewMachine.name} · ` : ""}
                {previewSkill.path}
              </p>
              <div className="flex justify-end">
                <MarkdownModeToggle mode={previewMode} onChange={setPreviewMode} />
              </div>
            </div>
            <div key={previewSkill.path} className="min-h-0 min-w-0 flex-1 select-text">
              {previewError ? (
                <p role="alert" className="break-words px-4 py-5 text-[12px] text-red-400">
                  {previewError}
                </p>
              ) : previewText === null ? (
                <p role="status" className="px-4 py-5 text-[12px] text-content/50">
                  {t("Loading skill…")}
                </p>
              ) : previewMode === "preview" ? (
                <SkillDocumentPreview text={previewText} />
              ) : (
                <MarkdownSource text={previewText} />
              )}
            </div>
          </aside>
        ) : null}
      </div>
      {copyMenu ? (
        <Popover
          anchor={copyMenu.anchor}
          align="end"
          width={220}
          onDismiss={() => setCopyMenu(null)}
          role="menu"
          aria-label={t("Copy {p0} to", { p0: copyMenu.skill.name })}
          className="p-1"
        >
          {machines.map((machine) => (
            <button
              key={machine.environmentId}
              type="button"
              role="menuitem"
              className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12px] text-content hover:bg-content/8"
              onClick={() => {
                const skill = copyMenu.skill;
                setCopyMenu(null);
                void onTransfer(skill, null, machine);
              }}
            >
              <span className="min-w-0 truncate">{machine.name}</span>
            </button>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}
