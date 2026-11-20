import {
  describeRemoteError,
  presentRemoteError,
  type RemoteErrorView,
} from "../../connections/public/remoteFailure";
import { errorText } from "../../../shared/lib/errors";
import { SkillAdvancedDialog } from "./SkillAdvancedDialog";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Code } from "../../../shared/ui/Code";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SkillActionsMenu } from "./SkillActionsMenu";
import { SkillsLibraryToolbar } from "./SkillsLibraryToolbar";
import { useSkillGroups } from "../index";
import { SkillGroupNavList } from "./SkillGroupNavList";
import { SkillGroupEditor } from "./SkillGroupEditor";
import { SkillGroupDialogs, type GroupEdit } from "./SkillGroupDialogs";
import { AutoGroupDialog } from "./AutoGroupDialog";
import { useSkillGroupView } from "./useSkillGroupView";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Heading } from "../../../shared/ui/Heading";
import { Alert } from "../../../shared/ui/Alert";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { SkillList } from "./SkillList";
import { TextField } from "../../../shared/ui/TextField";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { Button } from "../../../shared/ui/Button";
import { CollectionFooter } from "../../../shared/ui/ContinuousList";
import { Badge } from "../../../shared/ui/Badge";
import { SkillRow } from "./SkillRow";
import { SkillMachinesPanel, type MachineListState } from "./SkillMachinesPanel";
import { CreateSkillDialog } from "./CreateSkillDialog";
import { Tabs, TabList, Tab } from "../../../shared/ui/Tabs";
import { NoteMarkdownEditor } from "../../notes/ui/NoteMarkdownEditor";
import type { EditorView } from "@codemirror/view";
import styles from "./SkillsPage.module.css";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import {
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { RefreshCw, X } from "../../../shared/ui/icons";
import { Spinner } from "../../../shared/ui/Spinner";
import { confirmNative } from "../../source-control/model/gitConfirmation";
import { canTransferSkill, SkillExistsError, transferSkill } from "../model/transferSkill";
import { useMarkdownMode } from "../../sessions/ui/MarkdownModeToggle";
import { MarkdownSource } from "../../sessions/ui/AgentMarkdown";
import { cachedLocalSkills, loadLocalSkills } from "../model/localSkillsCache";
import { SkillDocumentPreview } from "./SkillDocumentPreview";
import { RecommendedSkills } from "./RecommendedSkills";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  exportSkill,
  deleteSkill,
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
import {
  cachedMachineSkills,
  listMachineSkills,
  machineSkillsTruncated,
} from "../model/machineSkills";
import { canDeleteSkill } from "../model/deleteSkill";
import { skillPreviewStatus, type SkillPreviewStatus } from "../model/skillPreviewStatus";
import { RevealedSetting, Segmented, Toggle } from "../../../shared/ui/settings";
import { cacheSkillPolicy, cachedSkillPolicy } from "../model/skillPreferences";
import {
  parseSkillPolicy,
  skillDisabled,
  type SkillPolicy,
} from "../../../integrations/harness/core/skillPolicy";
import { runMachineCommand } from "../../connections/model/remoteCommands";

import {
  filterSkillEntries,
  installedNames,
  mergeSkillLibrary,
  skillPresence,
  type SkillCopy,
  type SkillListFilter,
  type SkillMachine as Machine,
} from "../model/skillLibrary";

export function SkillsPage({
  cwd,
  header,
  revealRequest,
}: {
  cwd: string;
  header?: ReactNode;
  revealRequest?: number;
}): ReactNode {
  useLocale();
  const skillGroups = useSkillGroups();
  const groupView = useSkillGroupView();
  const openGroup = skillGroups.find((group) => group.id === groupView.groupId) ?? null;
  const groupedNames = new Set(skillGroups.flatMap((group) => group.skillNames));
  const [groupEdit, setGroupEdit] = useState<GroupEdit | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const revealed = useContext(RevealedSetting);
  const [advancedOpen, setAdvancedOpen] = useState(revealed === "skill-folders");
  const [lastReveal, setLastReveal] = useState({
    id: revealed,
    request: revealRequest,
  });
  if (lastReveal.id !== revealed || lastReveal.request !== revealRequest) {
    setLastReveal({ id: revealed, request: revealRequest });
    if (revealed === "skill-folders") setAdvancedOpen(true);
  }
  const previewId = useId();
  const previewOpener = useRef<string | null>(null);
  const previewButtons = useRef(new Map<string, HTMLButtonElement>());
  const filterInput = useRef<HTMLInputElement>(null);
  const closePreview = useRef<HTMLButtonElement>(null);
  const [skills, setSkills] = useState(() => cachedLocalSkills(cwd));
  const [localLoading, setLocalLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const deletePending = useRef(false);
  // Every connected machine's skills are listed under this computer's; the
  // machine that owns the open project also lists that project's skills.
  const remoteProject = remoteProjectFor(cwd);
  const projectMachine = remoteProject?.environmentId;
  const { machines: connected } = useRemoteMachines();
  const otherMachineName = t("Other machine");
  const machines = useMemo<Machine[]>(() => {
    const list = remoteProjectMachines(connected).map((machine) => ({
      environmentId: machine.environmentId,
      name: machine.name,
      cwd: machine.environmentId === projectMachine ? cwd : "",
    }));
    if (projectMachine && !list.some((entry) => entry.environmentId === projectMachine))
      list.push({
        environmentId: projectMachine,
        name: knownRemoteMachine(projectMachine)?.name ?? otherMachineName,
        cwd,
      });
    return list;
  }, [connected, projectMachine, cwd, otherMachineName]);
  const [machineLists, setMachineLists] = useState<
    Record<
      string,
      {
        skills: DiscoveredSkill[] | null;
        truncated?: boolean;
        error: string | null;
        loading?: boolean;
      }
    >
  >({});
  const [query, setQuery] = useRetainedState(`skills:${pathKey(cwd)}:query`, "");
  const [listFilter, setListFilter] = useRetainedState<SkillListFilter>(
    `skills:${pathKey(cwd)}:filter`,
    "all",
  );
  const [detailTab, setDetailTab] = useState<"document" | "machines">("document");
  const [actionsMenu, setActionsMenu] = useState<{
    skill: DiscoveredSkill;
    machine: Machine | null;
    anchor: HTMLElement;
    groupId?: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
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
  const clearFeedback = () => {
    setActionError(null);
    setActionResult("");
  };
  const [policyErrors, setPolicyErrors] = useState<Record<string, string>>({});
  // Path of the skill being copied to the other machine, if any.
  const [transferring, setTransferring] = useState<string | null>(null);
  const transferPending = useRef(false);
  const [previewSkill, setPreviewSkill] = useState<DiscoveredSkill | null>(null);
  // The machine a previewed skill is read from; null for this computer.
  const [previewMachine, setPreviewMachine] = useState<Machine | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<RemoteErrorView | null>(null);
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
  const [savedDocument, setSavedDocument] = useState<{
    path: string;
    content: string;
  } | null>(null);
  const savePending = useRef(false);
  const editorView = useRef<EditorView | null>(null);
  const editable = previewSkill !== null && !previewMachine && canDeleteSkill(previewSkill);
  const editingSource = editable && (editing || previewMode === "source");
  const draft = previewSkill ? (drafts[previewSkill.path] ?? previewText) : null;
  const dirty = draft !== null && previewText !== null && draft !== previewText;
  const previewStatus = skillPreviewStatus({
    readError: previewError !== null,
    loaded: previewText !== null,
    saving,
    dirty,
    editable,
    savedDraft:
      previewSkill !== null &&
      savedDocument?.path === previewSkill.path &&
      savedDocument.content === draft,
  });
  const previewStatusText: Record<SkillPreviewStatus, string> = {
    failed: t("Could not read skill"),
    loading: t("Loading skill…"),
    saving: t("Saving…"),
    dirty: t("Unsaved changes"),
    "read-only": t("Read-only"),
    saved: t("Saved"),
    clean: t("All changes saved"),
  };

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
      setSavedDocument({ path, content });
      requestRefresh("local");
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  };

  const onPreview = (skill: DiscoveredSkill, machine: Machine | null = null): void => {
    if (savePending.current) return;
    setActionsMenu(null);
    setEditing(!machine && canDeleteSkill(skill));
    setSplit(false);
    previewOpener.current = `name:${skill.path}`;
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

  const restorePreviewFocus = useEffectEvent(() => {
    // A rescan replaces row elements, so restore by skill and trigger identity.
    const opener = previewButtons.current.get(previewOpener.current ?? "");
    const target = opener ?? filterInput.current;
    if (target?.isConnected) target.focus();
  });
  // Move focus into the preview and restore it when the preview closes.
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
      restorePreviewFocus();
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
          if (!file) throw new Error(t("SKILL.md is missing."));
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
          // The headline is translated; the raw cause sits behind Details, sanitized by describeRemoteError.
          setPreviewError(describeRemoteError(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewSkill, previewMachine, previewRead]);

  const skipLocalRefresh = useEffectEvent(
    () =>
      skills !== null &&
      !localLoading &&
      refreshScope.current !== "all" &&
      refreshScope.current !== "local",
  );
  // Only scope changes and explicit refreshes can start a load.
  useEffect(() => {
    let cancelled = false;
    const changedScope = localScope.current !== cwd;
    localScope.current = cwd;
    if (!changedScope && skipLocalRefresh()) return;
    if (changedScope) setSkills(cachedLocalSkills(cwd));
    setLocalLoading(true);
    setError(null);
    // This computer's own skills always; with a remote project, without the
    // project folder, which lives on the other machine.
    loadLocalSkills(cwd)
      .then((next) => {
        if (cancelled) return;
        setSkills(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorText(err));
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
          skills: changedScope
            ? cachedMachineSkills(machine.environmentId, machine.cwd)
            : (current[machine.environmentId]?.skills ??
              cachedMachineSkills(machine.environmentId, machine.cwd)),
          truncated: machineSkillsTruncated(machine.environmentId, machine.cwd),
          error: null,
          loading: true,
        },
      }));
      const settle = (value: {
        skills: DiscoveredSkill[] | null;
        truncated: boolean;
        error: string | null;
      }) => {
        if (!cancelled)
          setMachineLists((current) => ({
            ...current,
            [machine.environmentId]: { ...value, loading: false },
          }));
      };
      // Opening reuses the remembered inventory; an explicit reload forces a fresh read.
      const refresh =
        reload > 0 &&
        (refreshScope.current === "all" || refreshScope.current === machine.environmentId);
      listMachineSkills(machine.environmentId, machine.cwd, { refresh })
        .then((skills) =>
          settle({
            skills,
            truncated: machineSkillsTruncated(machine.environmentId, machine.cwd),
            error: null,
          }),
        )
        .catch((err: unknown) => {
          if (!cancelled)
            setMachineLists((current) => ({
              ...current,
              [machine.environmentId]: {
                skills: current[machine.environmentId]?.skills ?? null,
                truncated: current[machine.environmentId]?.truncated,
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
          if (!cancelled)
            setPolicyErrors((current) => ({
              ...current,
              local: presentRemoteError(error, { explicit: true }),
            }));
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

  // This computer first, then each connected machine: the order of presence marks.
  const lists = useMemo<MachineListState[]>(
    () => [
      {
        machine: null,
        skills,
        error,
        policyKnown: !!policies.local,
      },
      ...machines.map((machine) => {
        const id = machine.environmentId;
        return {
          machine,
          skills: machineLists[id]?.skills ?? null,
          truncated: machineLists[id]?.truncated ?? false,
          error: machineLists[id]?.error ?? null,
          policyKnown: !!policies[id],
        };
      }),
    ],
    [skills, error, machines, machineLists, policies],
  );
  const isOff = ({ skill, machine }: SkillCopy): boolean => {
    const policy = policies[machine?.environmentId ?? "local"];
    if (policy) return skillDisabled(policy, skill);
    return !machine && disabledPaths.includes(skill.path);
  };
  const entries = useMemo(() => mergeSkillLibrary(lists), [lists]);
  const shownEntries = filterSkillEntries(entries, query, listFilter, isOff, lists);
  const groups = (["project", "user", "builtin"] as const)
    .map((scope) => ({
      scope,
      entries: shownEntries.filter((entry) => entry.scope === scope),
    }))
    .filter((group) => group.entries.length > 0);
  const machineNames = lists.map((list) => list.machine?.name ?? t("This PC"));
  const libraryLoading = skills === null && !error;
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
      setPolicies((current) => ({
        ...current,
        [machine?.environmentId ?? "local"]: policy,
      }));
      setPolicyErrors((current) => ({
        ...current,
        [machine?.environmentId ?? "local"]: "",
      }));
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
        [machine?.environmentId ?? "local"]: t("Could not save the skill preference. {p0}", {
          p0: presentRemoteError(error, { explicit: true }),
        }),
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
      setActionError(t("Could not open the folder: {p0}", { p0: errorText(err) }));
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
        onPreview({ path, name, scope, source: "agents", description: "" });
        setDetailTab("document");
        invalidateSkills();
        window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
        setCreating(false);
        requestRefresh("local");
      })
      .catch((err: unknown) => {
        setCreateError(errorText(err));
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
        t("Copied {p0} to personal skills on {p1}.", {
          p0: skill.name,
          p1: targetName,
        }),
      );
      requestRefresh(to?.environmentId ?? "local");
    } catch (err) {
      setActionError(
        `${t("Copy could not be confirmed for {p0} on {p1}. Check the target before trying again.", { p0: skill.name, p1: targetName })} ${presentRemoteError(err, { explicit: true })}`,
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
          {
            p0: skill.name,
            p1: machine?.name ?? t("this computer"),
            p2: skill.path,
          },
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
      setActionsMenu((current) => (current?.skill.path === skill.path ? null : current));
      setActionResult(
        t("Deleted {p0} from {p1}.", {
          p0: skill.name,
          p1: machine?.name ?? t("this computer"),
        }),
      );
      requestRefresh(machine?.environmentId ?? "local");
    } catch (err) {
      setActionError(
        t("Could not delete {p0}. {p1}", {
          p0: skill.name,
          p1: presentRemoteError(err, { explicit: true }),
        }),
      );
    } finally {
      deletePending.current = false;
      setDeleting(null);
    }
  };

  const renderRow = (entry: (typeof shownEntries)[number], groupId?: string) => {
    const { skill, machine } = entry.primary;
    const machineId = machine?.environmentId ?? "local";
    const selected = previewSkill?.path === skill.path;
    const presence = skillPresence(entry.name, lists);
    return (
      <SkillRow
        entry={entry}
        selected={selected}
        modified={drafts[skill.path] !== undefined}
        off={isOff(entry.primary)}
        busy={policyTarget === JSON.stringify([machineId, skill.path])}
        cells={
          machines.length
            ? lists.map((list, index) => ({
                machine: list.machine,
                name: list.machine?.name ?? t("This computer"),
                state: presence[index],
              }))
            : null
        }
        previewId={previewId}
        previewOpen={previewOpen}
        disabled={saving}
        actionsOpen={actionsMenu?.skill.path === skill.path}
        nameRef={registerPreviewButton(`name:${skill.path}`)}
        onOpen={() => onPreview(skill, machine)}
        onActions={(anchor) => setActionsMenu({ skill, machine, anchor, groupId })}
        copy={{
          transferable: canTransferSkill(skill),
          blocked:
            drafts[skill.path] !== undefined
              ? t("Save or discard the draft before transferring.")
              : null,
          loading: transferring === skill.path,
          disabled: transferring !== null || deleting !== null || saving,
          onCopy: (target) => {
            setActionsMenu(null);
            void onTransfer(skill, machine, target);
          },
        }}
      />
    );
  };

  const machineAlerts = lists.flatMap((list) => {
    const id = list.machine?.environmentId ?? "local";
    const failure = (list.machine ? list.error : null) ?? policyErrors[id];
    if (!failure && list.machine && list.truncated && list.skills)
      return [
        <InlineMessage key={`${id}:truncated`} tone="warning">
          {t("{p0} has more skills than can be listed. Some are not shown.", {
            p0: list.machine.name,
          })}
        </InlineMessage>,
      ];
    if (!failure) return [];
    return [
      <InlineError key={id} action={{ label: t("Retry"), onClick: () => requestRefresh(id) }}>
        {failure}
      </InlineError>,
    ];
  });
  const feedbackBusy = busy
    ? t("Creating…")
    : deleting
      ? t("Deleting…")
      : transferring
        ? t("Copying…")
        : "";
  const actionFeedback =
    actionError || actionResult || feedbackBusy ? (
      <div {...surfaceAttributes({ frame: "pane", edge: "block-start" }, styles.feedback)}>
        {actionError ? (
          <InlineError secondaryAction={{ label: t("Dismiss"), onClick: clearFeedback }}>
            {actionError}
          </InlineError>
        ) : feedbackBusy ? (
          <InlineMessage tone="info">{feedbackBusy}</InlineMessage>
        ) : (
          <InlineMessage
            tone="success"
            secondaryAction={{ label: t("Dismiss"), onClick: clearFeedback }}
          >
            {actionResult}
          </InlineMessage>
        )}
      </div>
    ) : null;
  const filterField = (
    <TextField
      ref={filterInput}
      type="search"
      label={t("Filter skills")}
      hideLabel
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder={
        skills === null ? t("Search skills") : t("Search {p0} skills", { p0: entries.length })
      }
      aria-label={t("Filter skills")}
      spellCheck={false}
      autoComplete="off"
    />
  );
  const shownCopy: SkillCopy | null = previewSkill
    ? { skill: previewSkill, machine: previewMachine }
    : null;
  const shownOn = previewMachine?.environmentId ?? "local";
  const showMachines = machines.length > 0 && detailTab === "machines";
  return (
    <Text
      as="div"
      size="inherit"
      tone="primary"
      {...surfaceAttributes({ variant: "canvas" }, styles.page)}
    >
      {showRecommended ? (
        <RecommendedSkills
          cwd={cwd}
          machines={machines}
          installed={installedNames(lists)}
          onInstalled={() => requestRefresh()}
          onClose={() => setShowRecommended(false)}
        />
      ) : null}
      {creating ? (
        <CreateSkillDialog
          cwd={cwd}
          error={createError}
          busy={busy}
          onCancel={() => {
            setCreating(false);
            setCreateError(null);
          }}
          onCreate={onCreate}
        />
      ) : null}
      <section
        {...surfaceAttributes(
          { variant: "workspace-panel", frame: "pane", edge: "responsive-end" },
          styles.library,
        )}
        aria-label={t("Skills")}
      >
        <header className={styles.libraryHeader}>
          <div className={styles.headingRow}>
            {/* Embedded in Settings the frame header already names the page: no second title row. */}
            {header ? header : <Heading size="page">{t("Skills")}</Heading>}
            {header ? <div className={styles.filter}>{filterField}</div> : null}
            <Button
              variant="ghost"
              iconOnly
              label={t("Refresh skills")}
              tooltip={t("Rescan skill folders")}
              disabled={libraryLoading || saving}
              loading={localLoading || Object.values(machineLists).some((entry) => entry.loading)}
              onClick={() => {
                invalidateSkills();
                window.dispatchEvent(new Event(SKILLS_CHANGE_EVENT));
                requestRefresh();
              }}
            >
              <RefreshCw className="icon-sm" aria-hidden="true" />
            </Button>
          </div>
          {header ? null : filterField}
          <SkillsLibraryToolbar
            view={groupView.view}
            onView={groupView.setView}
            filter={listFilter}
            onFilter={setListFilter}
            showMissing={machines.length > 0}
            busy={busy}
            onNewSkill={() => setCreating(true)}
            onDiscover={() => setShowRecommended(true)}
            onNewGroup={() => setGroupEdit({ kind: "create", skillNames: [] })}
            onFolders={() => setAdvancedOpen(true)}
          />
        </header>
        {groupView.view === "groups" || groupError ? (
          <div className="flex flex-col gap-2 px-2 pt-2">
            {groupView.view === "groups" ? (
              <div className="flex flex-wrap items-center gap-2">
                <AutoGroupDialog
                  cwd={cwd}
                  skills={entries.map((entry) => ({
                    name: entry.name,
                    description: entry.primary.skill.description,
                  }))}
                />
              </div>
            ) : null}
            {groupError ? <Alert tone="danger">{groupError}</Alert> : null}
          </div>
        ) : null}
        <SkillList
          groupedContent={
            groupView.view === "groups" ? (
              <SkillGroupNavList
                groups={skillGroups}
                ungroupedCount={entries.filter((entry) => !groupedNames.has(entry.name)).length}
                query={query}
                selectedId={openGroup?.id ?? null}
                onSelect={groupView.selectGroup}
                onNewGroup={() => setGroupEdit({ kind: "create", skillNames: [] })}
              />
            ) : undefined
          }
          cwd={cwd}
          groups={groups}
          machineNames={machines.length && groupView.view !== "groups" ? machineNames : []}
          renderRow={renderRow}
          loading={localLoading}
        >
          {machineAlerts}
          {libraryLoading ? <LoadingText>{t("Loading skills…")}</LoadingText> : null}
          {skills === null && error ? (
            <CollectionFooter error={error} onRetry={() => requestRefresh("local")} />
          ) : null}
          {!libraryLoading &&
            groupView.view !== "groups" &&
            shownEntries.length === 0 &&
            (entries.length ? (
              <EmptyState
                context="list"
                kind="filtered"
                icon={null}
                description={t("No matching skills")}
                onReset={() => {
                  setQuery("");
                  setListFilter("all");
                }}
                resetLabel={t("Clear filters")}
              />
            ) : skills !== null ? (
              <EmptyState
                size="inline"
                description={t("No skills yet. New skill creates a starter SKILL.md.")}
              />
            ) : null)}
        </SkillList>
      </section>
      {advancedOpen ? <SkillAdvancedDialog onClose={() => setAdvancedOpen(false)} /> : null}
      <div className={styles.workspace}>
        {groupView.view === "groups" && openGroup ? (
          <SkillGroupEditor
            key={openGroup.id}
            group={openGroup}
            groups={skillGroups}
            entries={entries}
            onEdit={setGroupEdit}
            onClose={() => groupView.selectGroup(null)}
          />
        ) : groupView.view === "groups" ? (
          <EmptyState
            title={t("Select a group")}
            description={t("Choose a group to add or remove its skills.")}
          />
        ) : previewSkill && shownCopy ? (
          <aside id={previewId} aria-label={t("Skill preview")} className={styles.detail}>
            <header className={styles.detailHeader}>
              <div
                className={styles.headingRow}
                aria-busy={policyTarget === JSON.stringify([shownOn, previewSkill.path])}
              >
                <Heading size="page" level={2}>
                  {previewSkill.name}
                </Heading>
                {lists.find((list) => (list.machine?.environmentId ?? "local") === shownOn)
                  ?.policyKnown ? (
                  <Toggle
                    label={t("Enable {p0} in {p1}", {
                      p0: previewSkill.name,
                      p1: PRODUCT_IDENTITY.displayName,
                    })}
                    on={!isOff(shownCopy)}
                    disabled={policySaving}
                    onChange={(enabled) => void onToggle(previewSkill, enabled, previewMachine)}
                  />
                ) : null}
                {policyTarget === JSON.stringify([shownOn, previewSkill.path]) ? (
                  <Spinner size="xs" label={t("Saving…")} />
                ) : null}
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
              <Text as="p" size="caption" tone="secondary" leading="inherit">
                {previewSkill.scope === "user"
                  ? t("Personal")
                  : previewSkill.scope === "builtin"
                    ? PRODUCT_IDENTITY.displayName
                    : t("Project")}{" "}
                · {previewSkill.source} · {previewMachine?.name ?? t("This computer")}
                {previewSkill.modelInvocable === false || previewSkill.userInvocable === false ? (
                  <>
                    {" "}
                    <Badge size="sm">
                      {previewSkill.modelInvocable === false
                        ? previewSkill.userInvocable === false
                          ? t("Invocation disabled")
                          : t("Manual only")
                        : t("Automatic only")}
                    </Badge>
                  </>
                ) : null}
              </Text>
              <Text
                as="p"
                size="caption"
                tone="secondary"
                leading="inherit"
                className={styles.path}
              >
                {previewSkill.path}
              </Text>
              {previewSkill.description ? (
                <Text as="p" size="secondary" leading="relaxed" className={styles.description}>
                  {previewSkill.description}
                </Text>
              ) : null}
              {!canDeleteSkill(previewSkill) ? (
                <Text as="p" size="caption" tone="secondary" leading="inherit">
                  {t("Managed skill: deletion is controlled by the provider, plugin or app.")}
                </Text>
              ) : null}
              {previewMachine ? (
                <Text as="p" size="caption" tone="secondary" leading="inherit">
                  {t("Copy this skill to this computer to edit it.")}
                </Text>
              ) : null}
              {machines.length ? (
                <Tabs value={detailTab} onValueChange={setDetailTab} panels="none">
                  <TabList label={t("Skill details")} className={styles.detailTabs}>
                    <Tab value="document">SKILL.md</Tab>
                    <Tab value="machines">{t("Machines")}</Tab>
                  </TabList>
                </Tabs>
              ) : null}
              {showMachines ? null : (
                <div className={styles.toolbar}>
                  <Code size="caption" className={styles.fileLabel}>
                    {machines.length ? null : "SKILL.md"}
                  </Code>
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
                      loadingLabel={t("Saving…")}
                      success={
                        !dirty &&
                        savedDocument?.path === previewSkill.path &&
                        savedDocument.content === draft
                      }
                      successLabel={t("Saved")}
                      disabled={!dirty || previewText === null}
                      onClick={() => void onSave()}
                    >
                      {t("Save")}
                    </Button>
                  ) : null}
                </div>
              )}
            </header>
            {showMachines ? (
              <div className={styles.machinesPane}>
                <SkillMachinesPanel
                  shown={shownCopy}
                  lists={lists}
                  isOff={isOff}
                  policyTarget={policyTarget}
                  busy={transferring !== null || deleting !== null || saving}
                  transferBlocked={
                    drafts[previewSkill.path] !== undefined
                      ? t("Save or discard the draft before transferring.")
                      : null
                  }
                  onToggle={(copy, enabled) => void onToggle(copy.skill, enabled, copy.machine)}
                  onView={(copy) => onPreview(copy.skill, copy.machine)}
                  onCopy={(to) => void onTransfer(previewSkill, previewMachine, to)}
                />
              </div>
            ) : (
              <>
                <div key={previewSkill.path} className={styles.document}>
                  {previewError ? (
                    <InlineError
                      action={{
                        label: t("Retry"),
                        onClick: () => setPreviewRead((value) => value + 1),
                      }}
                      details={previewError.details || undefined}
                    >
                      {t("Could not read SKILL.md.")}
                    </InlineError>
                  ) : draft === null ? (
                    <LoadingText>{t("Loading skill…")}</LoadingText>
                  ) : editingSource || split ? (
                    <div className={split ? styles.split : styles.editPane}>
                      <section
                        {...surfaceAttributes(
                          split ? { frame: "pane", edge: "responsive-end" } : {},
                          styles.rawPane,
                        )}
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
                              setDrafts((current) => ({
                                ...current,
                                [previewSkill.path]: text,
                              }));
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
                <Text
                  as="footer"
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  className={styles.detailFooter}
                >
                  {/* A read failure is announced once, in the pane above, not again here. */}
                  <span>{previewError ? null : previewStatusText[previewStatus]}</span>
                  <span>
                    {editingSource || (split && editable) ? t("Ctrl/Cmd+S to save") : t("Markdown")}
                  </span>
                </Text>
              </>
            )}
          </aside>
        ) : (
          <EmptyState
            title={t("Select a skill")}
            description={t("Choose a skill to view or edit its instructions.")}
          />
        )}
        {actionFeedback}
      </div>
      {groupEdit ? (
        <SkillGroupDialogs
          edit={groupEdit}
          onClose={() => setGroupEdit(null)}
          onCreated={(group) => groupView.selectGroup(group.id)}
        />
      ) : null}
      {actionsMenu ? (
        <SkillActionsMenu
          target={actionsMenu}
          policyAvailable={!!policies[actionsMenu.machine?.environmentId ?? "local"]}
          off={isOff({
            skill: actionsMenu.skill,
            machine: actionsMenu.machine,
          })}
          policySaving={policySaving}
          deleteBlocked={deleting !== null || transferring !== null || saving}
          onClose={() => setActionsMenu(null)}
          onToggle={onToggle}
          onCopyPath={onCopyPath}
          onReveal={onReveal}
          onDelete={onDelete}
          onEdit={setGroupEdit}
          onError={setGroupError}
        />
      ) : null}
    </Text>
  );
}
