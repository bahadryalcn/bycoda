import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Alert } from "../../../shared/ui/Alert";
import { TextField } from "../../../shared/ui/TextField";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { ContinuousList, CollectionFooter } from "../../../shared/ui/ContinuousList";
import { Badge } from "../../../shared/ui/Badge";
import { SkillCapabilityStatus } from "./SkillCapabilityStatus";
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
import { Spinner } from "../../../shared/ui/Spinner";
import { confirmNative } from "../../source-control/model/gitConfirmation";
import { canTransferSkill, SkillExistsError, transferSkill } from "../model/transferSkill";
import { CreateSkillForm } from "./SkillPicker";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";
import { MarkdownSource } from "../../sessions/ui/AgentMarkdown";
import { SkillDocumentPreview } from "./SkillDocumentPreview";
import { RecommendedSkills } from "./RecommendedSkills";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  exportSkill,
  deleteSkill,
  listSkills,
  getSkillPolicy,
  setSkillEnabled,
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
import { machineFailure } from "../model/skillMachineFailure";
import { listMachineSkills } from "../model/machineSkills";
import { canDeleteSkill } from "../model/deleteSkill";
import { Segmented, Toggle } from "../../settings/ui/settingsControls";
import { cacheSkillPolicy, cachedSkillPolicy } from "../model/skillPreferences";
import {
  parseSkillPolicy,
  skillDisabled,
  type SkillPolicy,
} from "../../../integrations/harness/core/skillPolicy";
import { runMachineCommand } from "../../connections/model/remoteCommands";

/** A connected machine whose skills are listed: `cwd` is its open project
 * (a `remote://` path), or empty for its personal skills only. */
type Machine = { environmentId: string; name: string; cwd: string };

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
  const [localLoading, setLocalLoading] = useState(true);
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
    Record<string, { skills: DiscoveredSkill[] | null; error: string | null; loading?: boolean }>
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
  // Keep one mounted creation form when switching to an existing skill. Its
  // name/scope draft survives selection and responsive layout changes.
  const [showCreate, setShowCreate] = useState(false);
  const [showRecommended, setShowRecommended] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refreshScope = useRef("all");
  const localScope = useRef(cwd);
  const machineScopes = useRef(new Map<string, string>());
  const policyScopes = useRef("");
  const requestRefresh = (target = "all") => {
    refreshScope.current = target;
    setReload((value) => value + 1);
  };
  const [disabledPaths, setDisabledPaths] = useState<string[]>(() => loadDisabledSkillPaths());
  const [policies, setPolicies] = useState<Record<string, SkillPolicy>>({});
  const [policyTarget, setPolicyTarget] = useState<string | null>(null);
  const policySaving = policyTarget !== null;
  const policyPending = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState("");
  const [policyErrors, setPolicyErrors] = useState<Record<string, string>>({});
  // Path of the skill being copied to the other machine, if any.
  const [transferring, setTransferring] = useState<string | null>(null);
  const transferPending = useRef(false);
  const [previewSkill, setPreviewSkill] = useState<DiscoveredSkill | null>(null);
  // The machine a previewed skill is read from; null for this computer.
  const [previewMachine, setPreviewMachine] = useState<Machine | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRead, setPreviewRead] = useState(0);
  const [previewMode, setPreviewMode] = useMarkdownMode(`skill:${previewSkill?.path ?? ""}`);
  const previewOpen = previewSkill !== null;
  const [editing, setEditing] = useState(false);
  const [split, setSplit] = useState(false);
  const [drafts, setDrafts] = useRetainedState<Record<string, string>>(
    `skills:${pathKey(cwd)}:drafts`,
    {},
  );
  const [draftBases, setDraftBases] = useRetainedState<Record<string, string>>(
    `skills:${pathKey(cwd)}:draft-bases`,
    {},
  );
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const editorView = useRef<EditorView | null>(null);
  const editable = previewSkill !== null && !previewMachine && canDeleteSkill(previewSkill);
  const editingSource = editable && (editing || previewMode === "source");
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
      if ((await readTextFile(path)) !== (draftBases[path] ?? previewText))
        throw new Error(
          t("SKILL.md changed on disk. Reopen the skill before saving; your draft is kept."),
        );
      await writeTextFile(path, content);
      setPreviewText(content);
      setDraftBases((current) => ({ ...current, [path]: content }));
      setDrafts((current) => {
        if (current[path] !== content) return current;
        const next = { ...current };
        delete next[path];
        return next;
      });
      invalidateSkills();
      window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
      setActionResult(t("Skill saved."));
      requestRefresh("local");
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
    setShowCreate(false);
    setActionsMenu(null);
    setEditing(trigger === "name" && !machine && canDeleteSkill(skill));
    setSplit(false);
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
  }, [previewSkill, previewMachine, previewRead]);

  useEffect(() => {
    let cancelled = false;
    const remote = isRemoteProjectPath(cwd);
    const changedScope = localScope.current !== cwd;
    localScope.current = cwd;
    if (
      !changedScope &&
      skills !== null &&
      !localLoading &&
      refreshScope.current !== "all" &&
      refreshScope.current !== "local"
    )
      return;
    if (changedScope) setSkills(null);
    setLocalLoading(true);
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
      })
      .finally(() => {
        if (!cancelled) setLocalLoading(false);
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
    for (const machine of machines) {
      const changedScope = machineScopes.current.get(machine.environmentId) !== machine.cwd;
      machineScopes.current.set(machine.environmentId, machine.cwd);
      if (
        !changedScope &&
        machineLists[machine.environmentId]?.skills &&
        !machineLists[machine.environmentId]?.loading &&
        refreshScope.current !== "all" &&
        refreshScope.current !== machine.environmentId
      )
        continue;
      setMachineLists((current) => ({
        ...current,
        [machine.environmentId]: {
          skills: changedScope ? null : (current[machine.environmentId]?.skills ?? null),
          error: null,
          loading: true,
        },
      }));
      const settle = (value: { skills: DiscoveredSkill[] | null; error: string | null }) => {
        if (!cancelled)
          setMachineLists((current) => ({
            ...current,
            [machine.environmentId]: { ...value, loading: false },
          }));
      };
      listMachineSkills(machine.environmentId, machine.cwd)
        .then((skills) => settle({ skills, error: null }))
        .catch((err: unknown) => {
          if (!cancelled)
            setMachineLists((current) => ({
              ...current,
              [machine.environmentId]: {
                skills: current[machine.environmentId]?.skills ?? null,
                error: machineFailure(machine, err),
                loading: false,
              },
            }));
        });
    }
    return () => {
      cancelled = true;
    };
    // `machines` is keyed by `machinesKey`: a new list of the same machines must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machinesKey, reload]);

  useEffect(() => {
    const onChange = (): void => {
      setDisabledPaths(loadDisabledSkillPaths());
      setPolicies((current) => ({ ...current, local: cachedSkillPolicy() }));
    };
    window.addEventListener(SKILLS_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    let focusFrame = 0;
    const onFocus = () => {
      if (focusFrame) return;
      focusFrame = requestAnimationFrame(() => {
        focusFrame = 0;
        requestRefresh();
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener(SKILLS_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
      window.removeEventListener("focus", onFocus);
      cancelAnimationFrame(focusFrame);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const topologyChanged = policyScopes.current !== machinesKey;
    policyScopes.current = machinesKey;
    const settle = (key: string, value: unknown) => {
      const policy = parseSkillPolicy(value);
      if (!cancelled) {
        setPolicies((current) => ({ ...current, [key]: policy }));
        setPolicyErrors((current) => ({ ...current, [key]: "" }));
        if (key === "local") {
          cacheSkillPolicy(policy);
          setDisabledPaths(policy.disabledPaths);
          invalidateSkills();
        }
      }
    };
    if (
      topologyChanged ||
      !policies.local ||
      refreshScope.current === "all" ||
      refreshScope.current === "local"
    )
      void getSkillPolicy("", loadDisabledSkillPaths())
        .then((value) => settle("local", value))
        .catch((error: unknown) => {
          if (!cancelled) setPolicyErrors((current) => ({ ...current, local: String(error) }));
        });
    for (const machine of machines) {
      if (
        !topologyChanged &&
        policies[machine.environmentId] &&
        refreshScope.current !== "all" &&
        refreshScope.current !== machine.environmentId
      )
        continue;
      void runMachineCommand(machine.environmentId, "skill_policy_get", {
        cwd: machine.cwd,
        legacyDisabledPaths: loadDisabledSkillPaths(),
      })
        .then((value) => settle(machine.environmentId, value))
        .catch((error: unknown) => {
          if (!cancelled)
            setPolicyErrors((current) => ({
              ...current,
              [machine.environmentId]: machineFailure(machine, error),
            }));
        });
    }
    return () => {
      cancelled = true;
    };
    // Machine identity and cwd are represented by machinesKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machinesKey, reload]);

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

  const onToggle = async (
    skill: DiscoveredSkill,
    enabled: boolean,
    machine: Machine | null,
  ): Promise<void> => {
    if (policyPending.current) return;
    policyPending.current = true;
    setPolicyTarget(JSON.stringify([machine?.environmentId ?? "local", skill.path]));
    setActionResult("");
    try {
      const policy = parseSkillPolicy(
        machine
          ? await runMachineCommand(machine.environmentId, "skill_policy_set", {
              cwd: machine.cwd,
              name: skill.name,
              enabled,
            })
          : await setSkillEnabled("", skill.name, enabled),
      );
      setPolicies((current) => ({ ...current, [machine?.environmentId ?? "local"]: policy }));
      setPolicyErrors((current) => ({ ...current, [machine?.environmentId ?? "local"]: "" }));
      if (!machine) {
        cacheSkillPolicy(policy);
        setDisabledPaths(policy.disabledPaths);
        invalidateSkills();
        window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
      }
      setActionError(null);
      setActionResult(t("Skill preference saved for all providers on this machine."));
    } catch (error) {
      setPolicyErrors((current) => ({
        ...current,
        [machine?.environmentId ?? "local"]:
          `Could not save the skill preference. ${String(error)}`,
      }));
    } finally {
      policyPending.current = false;
      setPolicyTarget(null);
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
        setActionError(t("Could not copy the path to the clipboard."));
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
        requestRefresh("local");
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
    if (deletePending.current || transferPending.current || savePending.current) return;
    if (drafts[skill.path] !== undefined) {
      setActionError(t("Save or discard the draft before transferring."));
      return;
    }
    transferPending.current = true;
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
      requestRefresh(to?.environmentId ?? "local");
    } catch (err) {
      setActionError(
        `${t("Copy could not be confirmed for {p0} on {p1}. Check the target before trying again.", { p0: skill.name, p1: targetName })} ${err instanceof Error ? err.message : String(err)}`,
      );
      requestRefresh(to?.environmentId ?? "local");
    } finally {
      transferPending.current = false;
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
      requestRefresh(machine?.environmentId ?? "local");
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
    const machineId = machine?.environmentId ?? "local";
    const policy = policies[machineId];
    const disabled = policy ? skillDisabled(policy, skill) : disabledPaths.includes(skill.path);
    const selected = previewSkill?.path === skill.path;
    const modified = drafts[skill.path] !== undefined;
    return (
      <div
        key={skill.path}
        className={styles.row}
        data-selected={selected || undefined}
        aria-busy={policyTarget === JSON.stringify([machineId, skill.path])}
      >
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
            tooltipWhen={
              skill.description && skill.description !== skill.name ? "always" : "overflow"
            }
            disabled={saving}
            onClick={() => onPreview(skill, "name", machine)}
          >
            <span className={styles.skillName}>{skill.name}</span>
            {modified ? <span title={t("Draft")}>·</span> : null}
          </Button>
          {skill.modelInvocable === false || skill.userInvocable === false ? (
            <Badge size="sm">
              {skill.modelInvocable === false
                ? skill.userInvocable === false
                  ? t("Invocation disabled")
                  : t("Manual only")
                : t("Automatic only")}
            </Badge>
          ) : null}
          {policy ? (
            <Toggle
              label={t("Enable {p0} in {p1}", {
                p0: skill.name,
                p1: PRODUCT_IDENTITY.displayName,
              })}
              on={!disabled}
              disabled={policySaving}
              onChange={(enabled) => void onToggle(skill, enabled, machine)}
            />
          ) : null}
          {policyTarget === JSON.stringify([machineId, skill.path]) ? (
            <Spinner size="xs" label={t("Saving…")} />
          ) : null}
          <SkillCapabilityStatus
            disabled={disabled}
            policyKnown={!!policy && !policyErrors[machineId]}
          />
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
            <Eye className="icon-sm" aria-hidden="true" />
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
              <CloudUpload className="icon-sm" aria-hidden="true" />
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
            <MoreHorizontal className="icon-sm" aria-hidden="true" />
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
  ) => (
    <>
      {all === null ? (
        !failure ? (
          <Alert inline tone="info" role="status">
            {t("Loading skills…")}
          </Alert>
        ) : null
      ) : shown.length === 0 ? (
        all.length ? (
          <EmptyState
            context="list"
            kind="filtered"
            icon={null}
            description={t("No matching skills")}
            onReset={() => setQuery("")}
            resetLabel={t("Clear search")}
          />
        ) : (
          <p className={styles.message}>
            {machine
              ? t("No skills on this machine.")
              : t("No skills yet. Add skill creates a starter SKILL.md.")}
          </p>
        )
      ) : (
        <ContinuousList
          className={styles.continuousSkills}
          error={failure}
          onRetry={() => requestRefresh(machine?.environmentId ?? "local")}
          items={shown}
          itemKey={(skill) => skill.path}
          renderItem={(skill) => renderRow(skill, machine)}
          stateKey={`skills:${pathKey(machine?.cwd ?? cwd)}:${machine?.environmentId ?? "local"}`}
          requiredKey={previewSkill?.path ?? null}
          estimateSize={52}
        />
      )}
      {all === null || shown.length === 0 ? (
        <CollectionFooter
          error={failure}
          onRetry={() => requestRefresh(machine?.environmentId ?? "local")}
        />
      ) : null}
    </>
  );

  const actionFeedback = (
    <>
      {actionError ? (
        <Alert inline tone="danger" role="alert">
          {actionError}
        </Alert>
      ) : null}
      {actionResult ? (
        <Alert inline tone="info" role="status">
          {actionResult}
        </Alert>
      ) : null}
      {busy || deleting || transferring ? (
        <Alert inline tone="info" role="status">
          {busy ? t("Creating…") : deleting ? t("Deleting…") : t("Copying…")}
        </Alert>
      ) : null}
    </>
  );

  const filterField = (
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
  );

  return (
    <div className={styles.page}>
      {showRecommended ? (
        <RecommendedSkills
          cwd={cwd}
          machines={machines}
          onInstalled={() => requestRefresh()}
          onClose={() => setShowRecommended(false)}
        />
      ) : null}
      <section className={styles.library} aria-label={t("Skills")}>
        <header className={styles.libraryHeader}>
          <div className={styles.headingRow}>
            {/* Embedded in Settings the frame header already names the page: no second title row. */}
            {header ? header : <h1>{t("Skills")}</h1>}
            {header ? <div className={styles.filter}>{filterField}</div> : null}
            <Button
              variant="ghost"
              iconOnly
              label={t("Refresh skills")}
              tooltip={t("Rescan skill folders")}
              disabled={(skills === null && !error) || saving}
              loading={localLoading || Object.values(machineLists).some((entry) => entry.loading)}
              onClick={() => {
                invalidateSkills();
                window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
                requestRefresh();
              }}
            >
              <RefreshCw className="icon-sm" aria-hidden="true" />
            </Button>
            <Button
              ref={addSkillButton}
              variant="secondary"
              disabled={busy}
              aria-label={showCreate ? t("Close skill form") : t("Add skill")}
              onClick={() => {
                setAdding(!showCreate);
                setShowCreate(!showCreate);
                setCreateError(null);
              }}
            >
              {showCreate ? t("Close") : t("Add skill")}
            </Button>
          </div>
          <div className={styles.count}>
            {skills === null ? "…" : t("{p0} skills shown", { p0: shownCount })}
            <Button variant="secondary" onClick={() => setShowRecommended(true)}>
              {t("Discover skills")}
            </Button>
          </div>
          {header ? null : filterField}
        </header>
        {!previewSkill ? actionFeedback : null}
        <div ref={lockOverscroll} className={styles.list}>
          <details open className={styles.machine} aria-busy={localLoading}>
            <summary>
              {t("This computer")} <span>{skills === null ? "…" : filtered.length}</span>
            </summary>
            {policyErrors.local ? (
              <Alert
                inline
                tone="danger"
                action={<Button onClick={() => requestRefresh("local")}>{t("Retry")}</Button>}
              >
                {policyErrors.local}
              </Alert>
            ) : null}
            {renderList(skills, filtered, error)}
          </details>
          {machineShown.map(({ machine, all, shown }) => (
            <details
              open
              key={machine.environmentId}
              className={styles.machine}
              aria-busy={machineLists[machine.environmentId]?.loading}
              aria-label={t("Skills on {p0}", { p0: machine.name })}
            >
              <summary>
                {machine.name} <span>{all === null ? "…" : shown.length}</span>
              </summary>
              {policyErrors[machine.environmentId] ? (
                <Alert
                  inline
                  tone="danger"
                  action={
                    <Button onClick={() => requestRefresh(machine.environmentId)}>
                      {t("Retry")}
                    </Button>
                  }
                >
                  {policyErrors[machine.environmentId]}
                </Alert>
              ) : null}
              {renderList(all, shown, machineLists[machine.environmentId]?.error ?? null, machine)}
            </details>
          ))}
          <details className={styles.policy}>
            <summary>{t("Advanced: skill controls and folders")}</summary>
            <p
              id="setting-skill-folders"
              data-setting-id="skill-folders"
              tabIndex={-1}
              className={styles.message}
            >
              {t(
                "Disabled skills stay on disk. {p0} blocks their names across all sources on the selected machine, including search, reads and explicit invocations. Project skills live in {p1}, personal skills in {p2}; harness folders are also included.",
                { p0: PRODUCT_IDENTITY.displayName, p1: ".agents/skills", p2: "~/.agents/skills" },
              )}
            </p>
            <p className={styles.message}>
              {t(
                "Changes apply to subsequent turns. Running turns and previously loaded context cannot be erased. Enabling in bycoda does not override provider restrictions.",
              )}
            </p>
            <p className={styles.message}>
              {t(
                "Native skill controls: Codex, Claude, OpenCode, Pi and OMP. Cursor, Grok, FX, Hermes, Antigravity and generic ACP receive current restrictions as instructions; their native skill loading cannot be controlled individually through the connected protocol.",
              )}
            </p>
          </details>
        </div>
        <OverflowTooltip label={cwd}>
          <footer className={styles.libraryFooter}>
            <FolderOpen className="icon-sm" aria-hidden="true" />
            <span className={styles.truncate}>{cwd}</span>
          </footer>
        </OverflowTooltip>
      </section>
      <div className={styles.workspace}>
        {adding ? (
          <section className={styles.creation} hidden={!showCreate} aria-label={t("Add skill")}>
            <h2 className="text-ui-heading font-medium">{t("Add skill")}</h2>
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
                setShowCreate(false);
                setCreateError(null);
                // The library is hidden while the narrow creation pane is open.
                // Restore focus after React makes its trigger visible again.
                requestAnimationFrame(() => addSkillButton.current?.focus());
              }}
              onCreate={onCreate}
            />
          </section>
        ) : null}
        {previewSkill ? actionFeedback : null}
        {previewSkill ? (
          <aside
            id={previewId}
            aria-label={t("Skill preview")}
            className={styles.detail}
            hidden={showCreate}
          >
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
                  <X className="icon-sm" aria-hidden="true" />
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
              <p className={styles.path}>{previewSkill.path}</p>
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
                  value={split ? "split" : editingSource ? "edit" : previewMode}
                  options={[
                    ...(editable ? [{ value: "edit", label: t("Edit") }] : []),
                    { value: "preview", label: t("Preview") },
                    ...(!editable ? [{ value: "source", label: t("Source") }] : []),
                    { value: "split", label: t("Split") },
                  ]}
                  onChange={(mode) => {
                    setEditing(mode === "edit");
                    setSplit(mode === "split");
                    if (mode === "preview" || mode === "source" || mode === "edit")
                      setPreviewMode(mode === "edit" ? "preview" : mode);
                  }}
                />
                {editable && drafts[previewSkill.path] !== undefined ? (
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setDraftBases((current) => {
                        const next = { ...current };
                        delete next[previewSkill.path];
                        return next;
                      });
                      setDrafts((current) => {
                        const next = { ...current };
                        delete next[previewSkill.path];
                        return next;
                      });
                    }}
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
                <Alert
                  inline
                  tone="danger"
                  role="alert"
                  action={
                    <Button onClick={() => setPreviewRead((value) => value + 1)}>
                      {t("Retry")}
                    </Button>
                  }
                >
                  {previewError}
                </Alert>
              ) : draft === null ? (
                <Alert inline tone="info" role="status">
                  {t("Loading skill…")}
                </Alert>
              ) : editingSource || split ? (
                <div className={split ? styles.split : styles.editPane}>
                  <section
                    className={styles.rawPane}
                    aria-label={editable ? t("Skill instructions") : t("Source")}
                  >
                    {editable ? (
                      <NoteMarkdownEditor
                        value={draft}
                        viewRef={editorView}
                        minHeight={320}
                        label={t("Skill instructions")}
                        onChange={(text) => {
                          setDraftBases((current) => ({
                            ...current,
                            [previewSkill.path]:
                              drafts[previewSkill.path] === undefined
                                ? (previewText ?? "")
                                : (current[previewSkill.path] ?? previewText ?? ""),
                          }));
                          setDrafts((current) => ({ ...current, [previewSkill.path]: text }));
                        }}
                        onSave={() => void onSave()}
                      />
                    ) : (
                      <MarkdownSource text={draft} />
                    )}
                  </section>
                  {split ? (
                    <section className={styles.previewPane} aria-label={t("Preview")}>
                      <SkillDocumentPreview
                        text={draft}
                        className={styles.reading}
                        cwd={previewMachine?.cwd ?? cwd}
                        documentPath={previewSkill.path}
                      />
                    </section>
                  ) : null}
                </div>
              ) : previewMode === "preview" ? (
                <SkillDocumentPreview
                  text={draft}
                  className={styles.reading}
                  cwd={previewMachine?.cwd ?? cwd}
                  documentPath={previewSkill.path}
                />
              ) : (
                <MarkdownSource text={draft} />
              )}
            </div>
            <footer className={styles.detailFooter}>
              <span>
                {previewError
                  ? t("Could not read skill")
                  : previewText === null
                    ? t("Loading skill…")
                    : saving
                      ? t("Saving…")
                      : dirty
                        ? t("Unsaved changes")
                        : t("Saved")}
              </span>
              <span>
                {editingSource || (split && editable) ? t("Ctrl/Cmd+S to save") : t("Markdown")}
              </span>
            </footer>
          </aside>
        ) : showCreate ? null : (
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
              icon: <Copy className="icon-sm" />,
            },
            ...(!actionsMenu.machine
              ? [
                  {
                    kind: "item" as const,
                    id: "reveal",
                    label: t("Reveal {p0} in file explorer", { p0: actionsMenu.skill.name }),
                    icon: <FolderOpen className="icon-sm" />,
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
                    icon: <Trash2 className="icon-sm" />,
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
