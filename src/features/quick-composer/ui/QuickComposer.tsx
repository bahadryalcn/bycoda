import { Alert } from "../../../shared/ui/Alert";
import { ShortcutKbd } from "../../../shared/ui/ShortcutKbd";
import { Button } from "../../../shared/ui/Button";
import { PromptField } from "../../../shared/ui/PromptField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { projectDisplayName } from "../../projects/model/projectNames";
import { t, useLocale } from "../../../shared/i18n";
import { useComposerSpelling } from "../../settings/model/composerSpelling";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useWorkspaceCreation } from "../../workspaces/model/workspaceCreation";
import { WorkspaceCreationStatus } from "../../workspaces/ui/WorkspaceCreationStatus";
import { QuickWorkspaceControls } from "./QuickWorkspaceControls";
import {
  workspaceForProject,
  quickWorkspaceLaunch,
  type QuickWorkspace,
} from "../model/quickWorkspace";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { prettyParent } from "../../../shared/lib/paths";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { ChevronDown, Search, Plus, X, ImagePlus, Maximize2 } from "../../../shared/ui/icons";
import { QuickProjectIcon, loadQuickProjectAppearance } from "./QuickProjectIcon";
import {
  getModelSnapshot,
  subscribeModels,
  saveLastModelSettings,
  saveRecentModelChoice,
} from "../../sessions/model/models";
import {
  HARNESS_TITLE,
  RUNTIME_MODE_LABEL,
  unavailableRuntimeModes,
  type HarnessId,
  type RuntimeMode,
  harnessSupportsAttachments,
} from "../../sessions/model/session";
import { Popover } from "../../../shared/ui/Popover";
import { AttachmentChip } from "../../sessions/ui/AttachmentChip";
import {
  attachmentTokens,
  insertAtSelection,
  removeAttachmentFromText,
  tokensForIncoming,
} from "../../sessions/model/attachmentTokens";
import { quickLaunchAttachments } from "../model/quickAttachments";
import { useQuickAttachments } from "./useQuickAttachments";
import { isScreenRecordingBlocked } from "../model/screenCaptureAccess";
import { openPrivacySettings } from "../../../platform/tauri/privacySettings";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import { QuickPermissionIcon, QuickPermissions } from "./QuickPermissions";
import { QuickModelSelector } from "./QuickModelSelector";
import { useQuickPromptBridge } from "./useQuickPromptBridge";
import { useQuickNativeListeners } from "./useQuickNativeListeners";
import { MODE_COMMANDS, useQuickPickers } from "./useQuickPickers";
import { useQuickPickerMotion } from "./useQuickPickerMotion";
import { OPERATOR_COMMAND } from "../../sessions/model/operatorCommand";
import { ORCHESTRATOR_COMMAND } from "../../sessions/model/orchestratorCommand";
import { PLAN_COMMAND } from "../../sessions/model/plan";
import { DRAFT_COMMAND } from "../../sessions/model/draftCommand";
import {
  leadingModeCommand,
  MODE_COMMAND_STYLES,
  ModeCommandText,
} from "../../sessions/ui/modeCommands";
import {
  initialQuickChoice,
  initialQuickProject,
  loadQuickProjects,
  quickLaunchRefusal,
  rememberQuickProject,
  resolveQuickModel,
  type QuickLaunch,
} from "../model/quickComposer";
import { quickSessionModelSettings, quickSessionRuntimeMode } from "../model/quickSessionDefaults";
import { nativeQuickLaunches } from "../model/nativeQuickLaunch";
import {
  quickComposerClosure,
  type QuickComposerClosureRuntime,
  type QuickComposerDraft,
} from "../model/quickComposerClosure";

/** Tallest the prompt grows before it scrolls, in px. */
const PROMPT_MAX_HEIGHT = 220;

const MODE_NAMES: ReadonlySet<string> = new Set(
  [OPERATOR_COMMAND, ...MODE_COMMANDS].map((command) => command.name),
);
/** Sized for the 16px prompt, as the main composer's indent is for 14px. */
const MODE_INDENT = "15px";
/** The mode a prompt starts with, and the prompt the session should get. */
export function quickPromptMode(text: string): {
  prompt: string;
  mode: string | null;
} {
  const match = text.match(/^\/([a-z]+)(?=\s|$)\s*/);
  const mode = match?.[1] && MODE_NAMES.has(match[1]) ? match[1] : null;
  if (!mode || mode === OPERATOR_COMMAND.name) return { prompt: text, mode };
  return { prompt: text.slice(match![0].length), mode };
}

export function QuickComposer({
  onShown,
  closure = quickComposerClosure,
}: {
  onShown: () => void;
  /** Trusted renderer composition/test isolation, never a renderer RPC grant. */
  closure?: QuickComposerClosureRuntime;
}) {
  useLocale();
  const spelling = useComposerSpelling();
  const [projects, setProjects] = useState(loadQuickProjects);
  const [projectAppearance, setProjectAppearance] = useState(loadQuickProjectAppearance);
  const [availableHarnesses, setAvailableHarnesses] = useState<HarnessId[] | null>(null);
  const [initial] = useState<QuickComposerDraft>(() => {
    const cwd = initialQuickProject(projects);
    return {
      prompt: "",
      attachments: [],
      cwd,
      choice: initialQuickChoice(),
      modelSettings: {},
      pickedRuntimeMode: null,
      workspaceChoice: { cwd },
    };
  });
  const owner = useMemo(() => closure.bind(closure.window(initial)), [closure, initial]);
  useSyncExternalStore(owner.subscribe, owner.version);
  const { cwd, choice, workspaceChoice, modelSettings, pickedRuntimeMode, prompt } = owner.draft();
  const setField = useCallback(
    <K extends keyof QuickComposerDraft>(key: K, action: SetStateAction<QuickComposerDraft[K]>) => {
      if (!owner.canMutate()) return;
      owner.update((draft) => {
        const value =
          typeof action === "function"
            ? (action as (before: QuickComposerDraft[K]) => QuickComposerDraft[K])(draft[key])
            : action;
        return value === draft[key] ? draft : { ...draft, [key]: value };
      });
    },
    [owner],
  );
  const setCwd = useCallback(
    (value: SetStateAction<string | null>) => setField("cwd", value),
    [setField],
  );
  const setChoice = useCallback(
    (value: QuickComposerDraft["choice"]) => setField("choice", value),
    [setField],
  );
  const setWorkspaceChoice = useCallback(
    (value: QuickWorkspace) => setField("workspaceChoice", value),
    [setField],
  );
  const setModelSettings = useCallback(
    (value: Record<string, string>) => setField("modelSettings", value),
    [setField],
  );
  const setPickedRuntimeMode = useCallback(
    (value: RuntimeMode) => setField("pickedRuntimeMode", value),
    [setField],
  );
  const setPrompt = useCallback(
    (value: SetStateAction<string>) => {
      if (!owner.canMutate()) return;
      const next = typeof value === "function" ? value(owner.draft().prompt) : value;
      // Match actual DOM and retained state in the same admitted turn. A pending
      // controlled React commit is not an attachment/result capture barrier.
      if (promptRef.current) promptRef.current.value = next;
      setField("prompt", next);
    },
    [owner, setField],
  );
  const workspace = workspaceForProject(workspaceChoice, cwd);
  const workspaceCreation = useWorkspaceCreation(
    cwd ?? "",
    !!cwd && !workspace.tree,
    workspace.mode,
    workspace.base,
  );
  // Pending is bounded by the policy-read timeout; only an explicit worktree choice
  // makes a failed read a hard stop. Automatic falls back to the current checkout.
  const workspaceBlocked =
    !workspace.tree &&
    (workspaceCreation.pending || (!!workspaceCreation.error && workspace.mode === "worktree"));
  const [gitOpen, setGitOpen] = useState(false);
  // Re-render when a workspace window's live catalog lands.
  const catalogVersion = useSyncExternalStore(subscribeModels, getModelSnapshot);
  // Only what the user picked is stored. Until then the mode follows the
  // selected harness's default for a new session, so it tracks the limits a
  // workspace window reports after the panel opened.
  const leadingMode = leadingModeCommand(prompt, MODE_NAMES);
  const [error, setError] = useState<string | null>(null);
  const [uiBusy, setBusy] = useState(false);
  const busy = uiBusy || owner.launching;
  const submitting = useRef(false);
  const attachmentsSupported = harnessSupportsAttachments(choice.harness);
  const frameRef = useRef<HTMLDivElement>(null);
  const attachments = useQuickAttachments(
    attachmentsSupported && !busy,
    setError,
    (added, previous) => insertPromptText(tokensForIncoming(previous, added)),
    owner,
    frameRef,
  );
  const pickerRef = useRef<HTMLDivElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useQuickPromptBridge(owner, promptRef);

  /** Text goes at the caret when the prompt has focus, otherwise at the end. */
  function insertPromptText(insertion: string) {
    if (!owner.canMutate()) return;
    const field = promptRef.current;
    if (!insertion) return;
    if (!field) {
      setPrompt((text) => `${text}${text && !/\s$/.test(text) ? " " : ""}${insertion}`);
      return;
    }
    const focused = document.activeElement === field;
    const edit = insertAtSelection(
      field.value,
      focused ? { start: field.selectionStart, end: field.selectionEnd } : null,
      insertion,
    );
    setPrompt(edit.text);
    // A controlled value moves the caret to the end when it is set.
    requestAnimationFrame(() => field.setSelectionRange(edit.caret, edit.caret));
  }

  const focusPrompt = useCallback(() => {
    requestAnimationFrame(() => {
      const field = promptRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    });
  }, []);

  const {
    picker,
    query,
    highlight,
    queryRef,
    projectOptions,
    commandOptions,
    optionCount,
    setQuery,
    setHighlight,
    reset: resetPickers,
    hide: hidePicker,
    openPicker,
    closePicker,
    chooseAt,
    syncPromptCommand,
  } = useQuickPickers({
    owner,
    promptRef,
    projects,
    cwd,
    busy,
    gitOpen,
    focusPrompt,
    setPrompt,
    setCwd,
    setWorkspaceChoice,
  });
  const resetTransient = useCallback(() => {
    resetPickers();
    setError(null);
  }, [resetPickers]);
  useQuickNativeListeners({
    owner,
    onShown,
    focusPrompt,
    resetTransient,
    setProjects,
    setProjectAppearance,
    setCwd,
    setChoice,
    setModelSettings,
    setAvailableHarnesses,
  });

  // Scroll only the list. scrollIntoView also scrolls the clipped card/root
  // while the native window is still catching up with the expanded content.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !row) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) {
      list.scrollTop += rowRect.top - listRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      list.scrollTop += rowRect.bottom - listRect.bottom;
    }
  }, [highlight, picker, query, catalogVersion]);

  useLayoutEffect(() => {
    const field = promptRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
  }, [prompt, leadingMode?.name]);

  const onGitOpenChange = useCallback(
    (open: boolean) => {
      setGitOpen(open);
      if (open) resetPickers();
    },
    [resetPickers],
  );
  useQuickPickerMotion(frameRef, pickerRef, picker);

  const resolvedModel = resolveQuickModel(choice);
  const model = resolvedModel ?? {
    ...choice,
    id: choice.model,
    name: "Loading model…",
  };
  const settings = quickSessionModelSettings(model, cwd ?? undefined, modelSettings);
  const runtimeMode = quickSessionRuntimeMode(model.harness, cwd ?? undefined, pickedRuntimeMode);
  useLayoutEffect(() => {
    owner.effective({
      model: resolvedModel ? { harness: model.harness, id: model.id } : null,
      settings,
      runtimeMode,
      workspace: {
        ...workspace,
        resolvedMode: workspaceCreation.mode,
        ...(workspace.base || workspaceCreation.base
          ? { base: workspace.base || workspaceCreation.base }
          : {}),
      },
      workspacePending: workspaceCreation.pending,
      ...(workspaceCreation.error ? { workspaceError: workspaceCreation.error } : {}),
    });
  });
  const removeAttachment = (id: string) => {
    if (!owner.canMutate()) return;
    setPrompt((current) =>
      removeAttachmentFromText(
        current,
        attachments.files,
        attachments.files.findIndex((file) => file.id === id),
      ),
    );
    attachments.remove(id);
  };

  const dismiss = () =>
    void invoke("quick_composer_dismiss").catch((reason) => setError(String(reason)));

  const submit = async (reveal: boolean) => {
    if (!owner.canMutate() || owner.pending) return;
    const current = owner.draft();
    const recoveringLaunch = nativeQuickLaunches.has(owner.rendererWindowId);
    const submittedPrompt = promptRef.current?.value ?? current.prompt;
    const selectedModel = resolveQuickModel(current.choice);
    const selectedWorkspace = workspaceForProject(current.workspaceChoice, current.cwd);
    const selectedSettings = selectedModel
      ? quickSessionModelSettings(selectedModel, current.cwd ?? undefined, current.modelSettings)
      : {};
    const selectedRuntime = quickSessionRuntimeMode(
      current.choice.harness,
      current.cwd ?? undefined,
      current.pickedRuntimeMode,
    );
    const launchMode = quickPromptMode(submittedPrompt.trim());
    const text = launchMode.prompt.trim();
    if (
      (!recoveringLaunch && !text && !current.attachments.length) ||
      (!recoveringLaunch && !current.cwd) ||
      submitting.current ||
      attachments.loading ||
      gitOpen ||
      (!recoveringLaunch && workspaceBlocked) ||
      (!recoveringLaunch && !selectedModel) ||
      (!recoveringLaunch &&
        selectedModel &&
        current.attachments.length > 0 &&
        !harnessSupportsAttachments(selectedModel.harness))
    )
      return;
    const intent = launchMode.mode === PLAN_COMMAND.name ? ("plan" as const) : undefined;
    const refusal =
      !recoveringLaunch && selectedModel
        ? quickLaunchRefusal(selectedModel.harness, selectedRuntime, intent)
        : null;
    if (refusal) {
      setError(refusal);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    const picked = selectedModel
      ? { harness: selectedModel.harness, model: selectedModel.id }
      : current.choice;
    const selectedCwd = current.cwd ?? "";
    // The first explicit action may submit once. Closure retry only observes;
    // a later explicit Start reconciles the retained original Native tuple.
    let explicit = true;
    const lineage: { intentId?: string } = {};
    try {
      const baseRequest = {
        prompt: text,
        ...(launchMode.mode === DRAFT_COMMAND.name ? { draft: true } : {}),
        ...(launchMode.mode === PLAN_COMMAND.name
          ? { intent: "plan" as const }
          : launchMode.mode === ORCHESTRATOR_COMMAND.name
            ? { intent: "orchestrate" as const }
            : {}),
        cwd: selectedCwd,
        ...picked,
        modelSettings: selectedSettings,
        runtimeMode: selectedRuntime,
        attachments: quickLaunchAttachments(current.attachments),
        reveal,
      };
      await owner.prepare(async (accepted) => {
        const launch = nativeQuickLaunches.run({
          key: owner.rendererWindowId,
          intentId: owner.intentId,
          rawPrompt: submittedPrompt,
          explicit,
          lineage,
          prepare: async () =>
            ({
              ...baseRequest,
              ...(await accepted.stage("launch-workspace", () =>
                quickWorkspaceLaunch(selectedWorkspace),
              )),
            }) as QuickLaunch,
        });
        explicit = false;
        const delivered = await launch;
        let cleanup = Promise.resolve();
        accepted.apply(() => {
          rememberQuickProject(delivered.request.cwd);
          saveLastModelSettings(delivered.request.modelSettings ?? {});
          if (delivered.request.model)
            saveRecentModelChoice(delivered.request.harness, delivered.request.model);
          const latestPrompt = owner.currentPrompt();
          const covered = !owner.composing && latestPrompt === delivered.rawPrompt;
          if (covered) setPrompt("");
          else owner.externalPrompt(latestPrompt);
          resetPickers();
          if (covered) cleanup = attachments.clearAfterHandoff(delivered.request.attachments);
        });
        await cleanup;
        accepted.apply(() => {
          nativeQuickLaunches.complete(owner.rendererWindowId, delivered);
          owner.nextIntent();
        });
      }, "launch");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const onPromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (picker) closePicker();
      else dismiss();
      return;
    }
    if (!owner.canMutate()) {
      event.preventDefault();
      return;
    }
    if (picker === "commands") {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (optionCount === 0) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((index) => (index + step + optionCount) % optionCount);
        return;
      }
      if (
        optionCount > 0 &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === "Enter" || event.key === "Tab")
      ) {
        event.preventDefault();
        chooseAt(Math.min(highlight, optionCount - 1));
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void submit(event.metaKey);
      return;
    }
    if (event.metaKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      openPicker("project");
      return;
    }
    if (event.metaKey && event.key === ".") {
      event.preventDefault();
      openPicker("model");
    }
  };

  const onQueryKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isImeComposition(event.nativeEvent)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (optionCount === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((index) => (index + step + optionCount) % optionCount);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      chooseAt(Math.min(highlight, optionCount - 1));
    }
  };

  const canSubmit = Boolean(
    (nativeQuickLaunches.has(owner.rendererWindowId) ||
      ((quickPromptMode(prompt.trim()).prompt.trim() || attachments.files.length) &&
        cwd &&
        !workspaceBlocked &&
        resolvedModel &&
        (attachmentsSupported || !attachments.files.length))) &&
    !busy &&
    !owner.pending &&
    !attachments.loading &&
    !gitOpen,
  );

  return (
    // Selectors expand below the toolbar without moving the prompt.
    <div
      ref={frameRef}
      data-ui-focus-group=""
      data-external-drop-owner="quick-attachments"
      onPaste={attachments.onPaste}
      onDragOver={attachments.onDragOver}
      onDragLeave={attachments.onDragLeave}
      onDrop={attachments.onDrop}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        if (picker) closePicker();
        else dismiss();
      }}
      className="relative flex max-h-[520px] flex-col overflow-clip rounded-(--ui-radius-popup) border border-stroke bg-[color-mix(in_oklab,var(--color-background-base)_45%,transparent)] text-content"
    >
      <div
        title={t("Drag to move")}
        className="group absolute inset-x-0 top-0 z-(--layer-pane-sheet) flex h-3 cursor-grab items-start justify-center pt-1 active:cursor-grabbing"
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          void getCurrentWindow()
            .startDragging()
            .catch(() => undefined);
        }}
      >
        <span className="pointer-events-none h-0.5 w-6 rounded-full bg-(--ui-text-muted) opacity-50 transition-opacity group-hover:opacity-100" />
      </div>
      <Button
        iconOnly
        label={t("Close composer")}
        variant="ghost"
        motion="none"
        type="button"
        aria-label={t("Close composer")}
        tooltip={t("Close")}
        shortcut="Esc"
        onClick={dismiss}
        // Above the drag strip.
        className="absolute right-2 top-2 z-(--layer-hover-card) grid place-items-center"
      >
        <X className="icon-xs" />
      </Button>
      <div className="flex shrink-0 items-center gap-2 px-5 pt-3 pr-9">
        <QuickWorkspaceControls
          key={cwd}
          value={workspace}
          resolvedMode={workspaceCreation.mode}
          resolvedBase={workspaceCreation.base}
          enabled={!busy && !picker}
          canOpen={owner.canMutate}
          prepare={(operation) => owner.prepare(() => operation())}
          onChange={setWorkspaceChoice}
          onError={setError}
          onOpenChange={onGitOpenChange}
          onClose={focusPrompt}
        />
        <Button
          selected={picker === "project"}
          variant="ghost"
          motion="none"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openPicker("project")}
          disabled={projects.length === 0}
          tooltip={t("Project")}
          shortcut="Meta+P"
          aria-expanded={picker === "project"}
          className={`ml-auto flex min-w-0 max-w-[40%] items-center gap-1.5 `}
        >
          {cwd ? (
            <QuickProjectIcon
              projectPath={cwd}
              appearance={projectAppearance}
              className="size-3 shrink-0"
            />
          ) : null}
          <span className="truncate">{cwd ? projectDisplayName(cwd) : t("No project")}</span>
          <ChevronDown className="icon-xs shrink-0 opacity-60" />
        </Button>
      </div>
      {attachments.files.length ? (
        <div
          aria-label={t("Attachments")}
          className="flex max-h-28 shrink-0 flex-wrap gap-1.5 overflow-y-auto px-5 pt-4 pb-1"
        >
          {attachments.files.map((file, index) => (
            <AttachmentChip
              key={file.id}
              attachment={file}
              token={attachmentTokens(attachments.files)[index]}
              onInsertToken={
                busy
                  ? undefined
                  : () => insertPromptText(attachmentTokens(attachments.files)[index])
              }
              onRemove={busy ? undefined : () => removeAttachment(file.id)}
            />
          ))}
        </div>
      ) : null}
      <PromptField
        label={t("Prompt")}
        framed={false}
        frameClassName="shrink-0"
        autosize={false}
        minRows={2}
        textSize="title"
        inset={{
          blockStart: "1rem",
          blockEnd: "0.5rem",
          inlineStart: "1.25rem",
          inlineEnd: "2.25rem",
        }}
        indent={leadingMode ? MODE_INDENT : undefined}
        editorClassName="scrollbar-none select-text"
        overlayRef={highlightRef}
        overlay={
          <>
            {leadingMode ? (
              <>
                <ModeCommandText
                  text={prompt}
                  mode={leadingMode}
                  indent={MODE_INDENT}
                  iconClassName="size-4"
                />
                {prompt.slice(leadingMode.end)}
              </>
            ) : (
              prompt
            )}
            {prompt.endsWith("\n") ? "\n" : null}
          </>
        }
        ref={promptRef}
        value={prompt}
        onChange={(event) => {
          setPrompt(event.target.value);
          syncPromptCommand(event.currentTarget);
        }}
        onClick={(event) => syncPromptCommand(event.currentTarget)}
        onKeyDown={onPromptKeyDown}
        onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            syncPromptCommand(event.currentTarget);
        }}
        placeholder={
          cwd
            ? t("Start a {p0} session in {p1}…", {
                p0: HARNESS_TITLE[model.harness],
                p1: projectDisplayName(cwd),
              })
            : t("Open a project in {p0} first", {
                p0: PRODUCT_IDENTITY.displayName,
              })
        }
        disabled={!cwd}
        aria-autocomplete="list"
        aria-controls={picker === "commands" ? "quick-composer-commands" : undefined}
        aria-expanded={picker === "commands"}
        aria-activedescendant={
          picker === "commands" && commandOptions[highlight]
            ? `quick-command-${commandOptions[highlight].invocation}`
            : undefined
        }
        spellCheck={spelling}
        autoCorrect={spelling ? "on" : "off"}
      />

      {attachments.files.length && !attachmentsSupported ? (
        <Alert tone="warning">
          {t("Choose a provider that supports attachments, or remove the attached files.")}
        </Alert>
      ) : null}
      {!workspace.tree &&
      (workspaceCreation.pending ||
        workspaceCreation.error ||
        workspaceCreation.mode === "worktree") ? (
        <WorkspaceCreationStatus
          preview={workspaceCreation.mode === "worktree" ? workspaceCreation.preview : undefined}
          pending={workspaceCreation.pending}
          error={workspaceCreation.error}
          onRetry={workspaceCreation.refresh}
          onUseCurrentCheckout={
            workspaceCreation.updateRequired
              ? () => setWorkspaceChoice({ cwd, mode: "current" })
              : undefined
          }
        />
      ) : null}
      {error ? (
        <Alert
          tone="danger"
          className="mx-3 mb-2 min-w-0 break-words"
          action={
            isScreenRecordingBlocked(error) ? (
              <Button
                type="button"
                onClick={() => void openPrivacySettings("screen-recording").catch(() => {})}
              >
                {t("Open Privacy Settings")}
              </Button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      ) : null}
      <div className="flex shrink-0 items-center gap-1.5 border-t border-stroke px-3 py-2">
        <Button
          iconOnly
          label={t("Add attachment")}
          selected={picker === "attachments"}
          variant="ghost"
          motion="none"
          type="button"
          ref={plusRef}
          aria-label={t("Add attachment")}
          aria-expanded={picker === "attachments"}
          tooltip={
            attachmentsSupported
              ? t("Attach files or take a screenshot")
              : t("This provider does not support attachments")
          }
          disabled={!attachmentsSupported || attachments.loading || busy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openPicker("attachments")}
          className={`grid shrink-0 place-items-center `}
        >
          <Plus className="icon-sm" />
        </Button>
        <Button
          selected={picker === "model"}
          variant="ghost"
          motion="none"
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openPicker("model")}
          tooltip={t("Model")}
          shortcut="Meta+."
          aria-expanded={picker === "model"}
          className={`flex min-w-0 max-w-[40%] items-center gap-1.5 `}
        >
          <HarnessIcon harness={model.harness} className="size-3.5 shrink-0" />
          <span className="truncate">{model.name}</span>
          <ChevronDown className="icon-xs shrink-0 opacity-60" />
        </Button>
        {model.harness !== "fx" ? (
          <Button
            selected={picker === "permissions"}
            variant="ghost"
            motion="none"
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openPicker("permissions")}
            tooltip={t("Permissions")}
            aria-label={t("Permissions")}
            aria-expanded={picker === "permissions"}
            className={`flex min-w-0 items-center gap-1.5 `}
          >
            <QuickPermissionIcon mode={runtimeMode} className="size-3.5 shrink-0" />
            <span className="truncate max-[450px]:hidden">{RUNTIME_MODE_LABEL[runtimeMode]}</span>
            <ChevronDown className="icon-xs shrink-0 opacity-60" />
          </Button>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-3 text-ui-micro text-(--ui-text-secondary)">
          {attachments.loading ? (
            <span role="status">{t("Adding attachment…")}</span>
          ) : (
            <>
              <span className="max-[600px]:hidden">
                <Kbd>↵</Kbd>
                {t(" start")}
              </span>
              <span className="max-[600px]:hidden">
                <Kbd>⌘↵</Kbd>
                {t(" start and open")}
              </span>
            </>
          )}
          <Button
            variant="primary"
            tone="accent"
            motion="none"
            type="button"
            onClick={() => void submit(false)}
            disabled={!canSubmit}
            loading={busy}
            className=""
          >
            {leadingMode?.name === DRAFT_COMMAND.name ? t("Save draft") : t("Start")}
          </Button>
        </span>
      </div>

      {picker === "attachments" ? (
        <Popover
          anchor={plusRef}
          side="top"
          align="start"
          width={220}
          gap={4}
          autoFocus
          tabIndex={-1}
          onDismiss={closePicker}
          className="p-1"
        >
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={attachments.loading || !attachmentsSupported}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              hidePicker();
              void attachments.chooseFiles().then(focusPrompt);
            }}
            className="flex w-full items-center gap-2"
          >
            <ImagePlus className="icon-sm" />
            {t("Choose files…")}
          </Button>
          <Button
            variant="ghost"
            motion="none"
            type="button"
            disabled={attachments.loading || !attachmentsSupported}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              hidePicker();
              void attachments.takeScreenshot().then(focusPrompt);
            }}
            className="flex w-full items-center gap-2"
          >
            <Maximize2 className="icon-sm" />
            {t("Take screenshot…")}
          </Button>
        </Popover>
      ) : null}
      {picker && picker !== "attachments" ? (
        <div ref={pickerRef} key={picker} className="flex min-h-0 flex-col">
          {picker === "commands" ? (
            <div
              ref={listRef}
              id="quick-composer-commands"
              role="listbox"
              aria-label={t("Commands")}
              className="shrink-0 border-t border-stroke p-2"
            >
              {commandOptions.length === 0 ? (
                <p className="px-2 py-2 text-ui-caption text-(--ui-text-secondary)">
                  {t("No matching commands")}
                </p>
              ) : (
                commandOptions.map((command, index) => (
                  <Button
                    fullWidth
                    variant="item"
                    motion="none"
                    key={command.invocation}
                    id={`quick-command-${command.invocation}`}
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    tabIndex={-1}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseAt(index)}
                  >
                    <CommandLabel name={command.name} />
                    <span className="text-ui-micro leading-4 text-(--ui-text-secondary)">
                      {command.description}
                    </span>
                  </Button>
                ))
              )}
            </div>
          ) : null}
          {picker === "model" ? (
            <QuickModelSelector
              cwd={cwd ?? undefined}
              model={model}
              values={settings}
              availableHarnesses={availableHarnesses}
              onChange={(selected) => {
                setChoice({ harness: selected.harness, model: selected.id });
              }}
              onSettingsChange={setModelSettings}
              onClose={closePicker}
            />
          ) : null}

          {picker === "permissions" ? (
            <QuickPermissions
              value={runtimeMode}
              unavailable={unavailableRuntimeModes(model.harness)}
              onChange={setPickedRuntimeMode}
              onClose={closePicker}
            />
          ) : null}
          {picker === "project" ? (
            <div className="flex min-h-0 flex-col border-t border-stroke">
              <div className="flex shrink-0 items-center gap-2 px-4 py-2 text-(--ui-text-secondary)">
                <Search className="icon-sm shrink-0" />
                <SearchInput
                  ref={queryRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(0);
                  }}
                  onKeyDown={onQueryKeyDown}
                  onBlur={(event) => {
                    if (!frameRef.current?.contains(event.relatedTarget as Node | null)) {
                      closePicker();
                    }
                  }}
                  placeholder={t("Find a project")}
                  aria-label={t("Find a project")}
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1"
                />
              </div>
              <div
                ref={listRef}
                role="listbox"
                aria-label={t("Projects")}
                className="min-h-0 max-h-64 overflow-y-auto overscroll-none px-2 pb-2"
              >
                {optionCount === 0 ? (
                  <p className="px-2 py-2 text-ui-caption text-(--ui-text-secondary)">
                    {t("No matches")}
                  </p>
                ) : (
                  projectOptions.map((path, index) => (
                    <Button
                      fullWidth
                      variant="item"
                      motion="none"
                      key={path}
                      type="button"
                      role="option"
                      aria-selected={index === highlight}
                      tabIndex={-1}
                      onMouseEnter={() => setHighlight(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseAt(index)}
                    >
                      <QuickProjectIcon
                        projectPath={path}
                        appearance={projectAppearance}
                        className="size-3 shrink-0"
                      />
                      <span className="truncate">{projectDisplayName(path)}</span>
                      <span className="ml-auto truncate pl-3 text-ui-micro text-(--ui-text-secondary)">
                        {prettyParent(path)}
                      </span>
                    </Button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CommandLabel({ name }: { name: string }) {
  useLocale();
  const style = MODE_COMMAND_STYLES[name];
  return (
    <span className="flex items-center gap-1.5">
      {style ? (
        <style.Icon className={`size-3.5 shrink-0 ${style.menu?.iconClassName ?? ""}`} />
      ) : null}
      {name.charAt(0).toUpperCase() + name.slice(1)}
    </span>
  );
}

function Kbd({ children }: { children: string }) {
  useLocale();
  return <ShortcutKbd size="xs">{children}</ShortcutKbd>;
}
