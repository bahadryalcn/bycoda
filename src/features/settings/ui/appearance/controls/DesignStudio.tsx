import { useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { t, useLocale } from "../../../../../shared/i18n";
import { Sheet } from "../../../../../shared/ui/Sheet";
import { Button } from "../../../../../shared/ui/Button";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { Select } from "../../../../../shared/ui/Select";
import { Badge } from "../../../../../shared/ui/Badge";
import { InfoPopover } from "../../../../../shared/ui/InfoPopover";
import { SettingsFeedback } from "../../../../../shared/ui/settings";
import { ErrorDetails } from "../../../../../shared/ui/ErrorDetails";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { canRunHarnessTextPrompt } from "../../../../../integrations/harness";
import { useAppearanceSettings, type AppearanceSettings } from "../../useAppearanceSettings";
import { captureAppearanceSnapshot } from "../../../model/appearanceSnapshot";
import {
  loadChatBackgroundPath,
  subscribeChatBackgroundPath,
  subscribeThemeStorage,
} from "../../../model/appearance";
import {
  loadProjectChatBackgroundSettings,
  subscribeProjectChatBackground,
} from "../../../../projects/public/projectChatBackground";
import {
  pickAndSaveChatBackground,
  validateChatBackgroundMedia,
} from "../../../../projects/public/chatBackground";
import { projectKey } from "../../../../../shared/lib/paths";
import { chatBackgroundKind } from "../../../../../shared/lib/chatBackgroundKind";
import { authoredSceneSource } from "../../../model/designSource";
import { SAVED_THEME_NAME_MAX, useSavedThemes, type SavedTheme } from "../../../model/savedThemes";
import {
  designIsCurrent,
  followSavedLibrary,
  type DesignDraft,
  type DesignKind,
} from "../../../model/designs";
import {
  createDesign,
  cancelDesignCreation,
  loadLandscapeExample,
  previewEditedSource,
} from "../../../runtime/createDesign";
import { applyDesign, openSavedDesign, saveDesign } from "../../../runtime/savedDesigns";
import { useGeneratorState, readGeneratorValue } from "./themeGeneratorSession";
import { useThemeGeneratorModel } from "./useThemeGeneratorModel";
import { AppearanceModelPicker } from "./AppearanceModelPicker";
import { DesignPreview } from "./DesignPreview";
import { SavedDesignLibrary } from "./SavedDesignLibrary";

type Props = {
  initialKind: DesignKind;
  appearance?: AppearanceSettings;
  project?: string;
  onClose: () => void;
  onApplied?: () => void;
};
export function DesignStudio(props: Props) {
  return props.appearance ? (
    <Studio {...props} appearance={props.appearance} />
  ) : (
    <OwnedStudio {...props} />
  );
}
function OwnedStudio(props: Props) {
  const appearance = useAppearanceSettings();
  return <Studio {...props} appearance={appearance} />;
}

function subscribeSelection(listener: () => void) {
  const releases = [
    subscribeChatBackgroundPath(listener),
    subscribeThemeStorage(listener),
    subscribeProjectChatBackground(listener),
  ];
  return () => releases.forEach((release) => release());
}
function selection(project?: string) {
  if (project) return JSON.stringify(loadProjectChatBackgroundSettings(projectKey(project)));
  const { image, motion, live } = captureAppearanceSnapshot();
  return JSON.stringify({ path: loadChatBackgroundPath(), image, motion, live });
}

function Studio({
  initialKind,
  appearance,
  project,
  onClose,
  onApplied,
}: Props & { appearance: AppearanceSettings }) {
  useLocale();
  const [kind, setKind] = useGeneratorState<DesignKind>("designKind", initialKind);
  const [prompt, setPrompt] = useGeneratorState("designPrompt", "");
  const [storedDraft, setDraft] = useGeneratorState<DesignDraft | null>("designDraft", null);
  const savedThemes = useSavedThemes();
  const draft = followSavedLibrary(storedDraft, savedThemes);
  const [dirty, setDirty] = useGeneratorState("designDirty", false);
  const [busy, setBusy] = useGeneratorState("designBusy", false);
  const [cancelling, setCancelling] = useGeneratorState("designCancelling", false);
  const [requestId, setRequestId] = useGeneratorState<string | null>("designRequestId", null);
  const [error, setError] = useGeneratorState<{ title: string; detail?: string } | null>(
    "designError",
    null,
  );
  const [creationFailed, setCreationFailed] = useGeneratorState("designCreationFailed", false);
  const [provider, setProvider] = useGeneratorState<"codex" | "gemini">(
    "designImageProvider",
    "codex",
  );
  const [choice] = useThemeGeneratorModel();
  const [working, setWorking] = useState(false);
  const operation = useRef(false);
  const [sourceOpen, setSourceOpen] = useGeneratorState("designSourceOpen", false);
  const [source, setSource] = useGeneratorState("designSourceEdit", "");
  const [sourcePath, setSourcePath] = useGeneratorState("designSourcePath", "");
  const [target, setTarget] = useState<"global" | "project">(project ? "project" : "global");
  const { confirm, dialog } = useConfirm();
  const scopedProject = target === "project" ? project : undefined;
  const currentSelection = useSyncExternalStore(
    subscribeSelection,
    () => selection(scopedProject),
    () => "null",
  );
  const blocked = busy || working;
  const current = !!draft && designIsCurrent(draft, JSON.parse(currentSelection), !!scopedProject);
  const sourcePending =
    draft?.kind === "scene" && sourcePath === draft.path && source !== (draft.source ?? "");
  const waitReason = t("Wait for the current action to finish.");
  const sourceReason = t("Update the preview before saving or applying source changes.");
  const blockedReason = blocked ? waitReason : sourcePending ? sourceReason : undefined;
  const createReason = working
    ? waitReason
    : sourcePending
      ? sourceReason
      : !prompt.trim()
        ? t("Describe the result first.")
        : t("Choose a model that supports text actions to create a design.");
  const saveReason = blockedReason ?? t("Enter a design name.");
  const fail = (cause: unknown) =>
    setError({
      title: t("Could not complete this action."),
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  const perform = async (action: () => Promise<void>) => {
    if (blocked || operation.current) return;
    operation.current = true;
    setWorking(true);
    setError(null);
    setCreationFailed(false);
    try {
      await action();
    } catch (cause) {
      fail(cause);
    } finally {
      operation.current = false;
      setWorking(false);
    }
  };
  /** Loading a design replaces the draft; unsaved edits are only discarded after a confirmation. */
  const replacing = (action: () => Promise<void>) => async () => {
    if (
      draft &&
      dirty &&
      !(await confirm({
        title: t("Replace the current draft?"),
        message: t("Unsaved changes to {p0} will be lost.", { p0: draft.name }),
        confirmLabel: t("Replace"),
      }))
    )
      return;
    await action();
  };
  const receive = (next: DesignDraft) => {
    setKind(next.kind);
    setDraft(next);
    setPrompt(next.prompt);
    setDirty(!next.saved);
    setSourceOpen(false);
    setSource(next.source ?? "");
    setSourcePath(next.path ?? "");
    setError(null);
  };

  const generate = async () => {
    if (blocked || sourcePending || readGeneratorValue("designBusy", false) || !prompt.trim())
      return;
    const id = crypto.randomUUID();
    setRequestId(id);
    setBusy(true);
    setCancelling(false);
    setError(null);
    setCreationFailed(false);
    try {
      const previousSource = draft?.kind === "scene" ? draft.source : undefined;
      if (previousSource && previousSource.length > 120_000)
        throw new Error(t("This source is too large for AI revision. Edit the source directly."));
      const next = await createDesign({
        requestId: id,
        kind,
        prompt: prompt.trim(),
        ...choice,
        imageProvider: provider,
        ...(kind === "scene" && previousSource ? { previousSource } : {}),
      });
      if (
        readGeneratorValue("designRequestId", null) !== id ||
        readGeneratorValue("designCancelling", false)
      )
        return;
      receive(next);
    } catch (cause) {
      if (!readGeneratorValue("designCancelling", false)) {
        fail(cause);
        setCreationFailed(true);
      }
    } finally {
      if (readGeneratorValue("designRequestId", null) === id) {
        setBusy(false);
        setCancelling(false);
        setRequestId(null);
      }
    }
  };
  const cancel = async () => {
    if (!requestId || cancelling) return;
    setCancelling(true);
    try {
      await cancelDesignCreation(requestId);
    } catch (cause) {
      fail(cause);
      setCancelling(false);
    }
  };
  const save = async (copy = false) => {
    if (!draft) return;
    const saved = await saveDesign(draft, !copy && !!draft.saved);
    setDraft({ ...draft, saved });
    setDirty(false);
  };
  const apply = async (next: DesignDraft) => {
    await applyDesign(appearance, next, scopedProject);
    onApplied?.();
  };
  const openTheme = async (theme: SavedTheme) => {
    const next = await openSavedDesign(theme);
    receive({ ...next, ...(next.source ? { source: authoredSceneSource(next.source) } : {}) });
  };
  const importBackground = async () => {
    const path = await pickAndSaveChatBackground();
    if (!path) return;
    await validateChatBackgroundMedia(path);
    const html = chatBackgroundKind(path) === "html";
    const nextKind = html ? "scene" : "image";
    setKind(nextKind);
    const look = captureAppearanceSnapshot();
    receive({
      kind: nextKind,
      name: t("Imported background"),
      prompt: "",
      path,
      look: { image: { ...look.image!, effect: "none" } },
      ...(html
        ? {
            source: authoredSceneSource(
              await invoke<string>("read_chat_background_html", { path }),
            ),
          }
        : {}),
    });
  };
  const captureCurrent = async () => {
    const look = captureAppearanceSnapshot();
    if (kind === "motion") {
      receive({ kind, name: t("Motion preset"), prompt: "", look: { motion: look.motion } });
      return;
    }
    const projectValue = scopedProject
      ? loadProjectChatBackgroundSettings(projectKey(scopedProject))
      : null;
    const path = projectValue?.path ?? loadChatBackgroundPath();
    if (!path) {
      if (look.live?.scene !== "none") {
        receive({
          kind: "motion",
          name: t("Live background"),
          prompt: "",
          look: { live: look.live },
        });
        return;
      }
      throw new Error(t("Create or import a background first."));
    }
    const html = chatBackgroundKind(path) === "html";
    receive({
      kind: html ? "scene" : "image",
      name: t("My background"),
      prompt: "",
      path,
      look: {
        image: {
          ...look.image!,
          ...(projectValue
            ? {
                scope: projectValue.scope,
                emptyOpacity: projectValue.emptyOpacity,
                sessionOpacity: projectValue.sessionOpacity,
                effect: projectValue.effect,
              }
            : {}),
        },
      },
      ...(html
        ? {
            source: authoredSceneSource(
              await invoke<string>("read_chat_background_html", { path }),
            ),
          }
        : {}),
    });
  };
  const placeholder =
    kind === "image"
      ? t("Soft clouds over a blue lake")
      : kind === "scene"
        ? t("Pine forest and a mountain lake at dusk")
        : t("Less motion, a calm crew and no tab animations");
  const createLabel =
    kind === "image"
      ? t("Create image")
      : kind === "scene"
        ? t("Create scene")
        : t("Create motion preset");
  return (
    <Sheet
      title={t("Create a design")}
      size="min(960px, 100vw)"
      onClose={() => {
        if (working) setError({ title: t("Finish the current action before closing.") });
        else onClose();
      }}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="design-studio-grid">
          <div className="flex min-w-0 flex-col gap-3">
            <Select
              label={t("Create")}
              value={kind}
              disabled={blocked}
              options={[
                { value: "image", label: t("Image") },
                { value: "scene", label: t("Live scene") },
                { value: "motion", label: t("Motion preset") },
              ]}
              onValueChange={(value) => setKind(value as DesignKind)}
            />
            <TextareaField
              label={t("Describe the result")}
              value={prompt}
              rows={3}
              maxLength={kind === "image" ? 600 : 2000}
              placeholder={placeholder}
              disabled={blocked}
              onChange={(event) => setPrompt(event.target.value)}
            />
            {kind === "image" ? (
              <Select
                label={t("Image provider")}
                value={provider}
                disabled={blocked}
                options={[
                  { value: "codex", label: "Codex ImageGen" },
                  { value: "gemini", label: "Gemini" },
                ]}
                onValueChange={(value) => setProvider(value as "codex" | "gemini")}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text tone="secondary" size="secondary">
                  {t("Model")}
                </Text>
                <AppearanceModelPicker />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={draft ? "secondary" : "primary"}
                tone="accent"
                loading={busy}
                loadingLabel={cancelling ? t("Cancelling…") : t("Creating…")}
                disabled={
                  working ||
                  sourcePending ||
                  !prompt.trim() ||
                  (kind !== "image" && !canRunHarnessTextPrompt(choice.harness))
                }
                disabledReason={createReason}
                onClick={() => void generate().catch(fail)}
              >
                {createLabel}
              </Button>
              {busy ? (
                <Button
                  disabled={cancelling}
                  disabledReason={waitReason}
                  onClick={() => void cancel().catch(fail)}
                >
                  {t("Cancel")}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={blocked || sourcePending}
                disabledReason={blockedReason}
                onClick={() => void perform(replacing(importBackground))}
              >
                {t("Import background")}
              </Button>
              <InfoPopover>{t("Import images, videos or self-contained HTML.")}</InfoPopover>
              <Button
                disabled={blocked || sourcePending}
                disabledReason={blockedReason}
                onClick={() => void perform(replacing(captureCurrent))}
              >
                {t("Use current design")}
              </Button>
            </div>
            <Button
              disabled={blocked || sourcePending}
              disabledReason={blockedReason}
              onClick={() =>
                void perform(
                  replacing(async () => {
                    const example = await loadLandscapeExample();
                    setKind("scene");
                    receive(example);
                  }),
                )
              }
            >
              {t("Try mountain lake")}
            </Button>
            {busy ? (
              <SettingsFeedback state="loading" immediate>
                {cancelling
                  ? t("Waiting for creation to stop…")
                  : t("Creating a preview. Your current design stays active.")}
              </SettingsFeedback>
            ) : null}
            {error ? (
              <SettingsFeedback
                state="error"
                action={
                  creationFailed && !busy
                    ? { label: t("Retry"), onClick: () => void generate().catch(fail) }
                    : undefined
                }
                extra={
                  error.detail ? (
                    <ErrorDetails title={error.title} detail={error.detail} />
                  ) : undefined
                }
              >
                {error.title}
              </SettingsFeedback>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Text weight="medium">{t("Preview")}</Text>
              {draft ? (
                <Badge size="sm">{dirty || !draft.saved ? t("Unsaved draft") : t("Saved")}</Badge>
              ) : null}
              {current ? (
                <Badge size="sm" tone="success">
                  {t("Current")}
                </Badge>
              ) : null}
            </div>
            <DesignPreview draft={draft} />
            {sourcePending ? (
              <SettingsFeedback state="warning">
                {t("Update the preview before saving or applying source changes.")}
              </SettingsFeedback>
            ) : null}
            {draft ? (
              <>
                <TextField
                  label={t("Design name")}
                  maxLength={SAVED_THEME_NAME_MAX}
                  value={draft.name}
                  disabled={blocked}
                  onChange={(event) => {
                    setDraft({ ...draft, name: event.target.value });
                    setDirty(true);
                  }}
                />
                <Select
                  label={t("Apply to")}
                  value={target}
                  disabled={blocked}
                  options={[
                    { value: "global", label: t("App") },
                    ...(project ? [{ value: "project", label: t("This project") }] : []),
                  ]}
                  onValueChange={(value) => setTarget(value as "global" | "project")}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={blocked || sourcePending || !draft.name.trim()}
                    disabledReason={saveReason}
                    onClick={() => {
                      if (draft.saved)
                        void confirm({
                          title: t("Save changes"),
                          message: t("Replace the saved version of {p0}?", {
                            p0: draft.saved.name,
                          }),
                          confirmLabel: t("Save"),
                          onConfirm: () => perform(() => save()),
                        }).catch(fail);
                      else void perform(() => save());
                    }}
                  >
                    {draft.saved ? t("Save changes") : t("Save")}
                  </Button>
                  {draft.saved ? (
                    <Button
                      disabled={blocked || sourcePending || !draft.name.trim()}
                      disabledReason={saveReason}
                      onClick={() => void perform(() => save(true))}
                    >
                      {t("Save a copy")}
                    </Button>
                  ) : null}
                  <Button
                    variant="primary"
                    tone="accent"
                    disabled={
                      blocked || sourcePending || (draft.kind === "motion" && target === "project")
                    }
                    disabledReason={
                      draft.kind === "motion" && target === "project"
                        ? t("Motion presets apply to the app.")
                        : undefined
                    }
                    onClick={() => void perform(() => apply(draft))}
                  >
                    {t("Apply")}
                  </Button>
                </div>
                {draft.kind === "scene" ? (
                  <Button
                    variant="ghost"
                    disabled={blocked}
                    disabledReason={waitReason}
                    onClick={() => {
                      if (sourcePath !== (draft.path ?? "")) {
                        setSource(draft.source ?? "");
                        setSourcePath(draft.path ?? "");
                      }
                      setSourceOpen(!sourceOpen);
                    }}
                  >
                    {t("Edit source")}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        {sourceOpen && draft ? (
          <div className="flex min-w-0 flex-col gap-2">
            <TextareaField
              label={t("HTML, CSS and JavaScript")}
              monospace
              rows={10}
              value={source}
              maxLength={2_097_152}
              disabled={blocked}
              onChange={(event) => {
                setSource(event.target.value);
                setDirty(true);
              }}
            />
            <Button
              disabled={blocked}
              disabledReason={waitReason}
              onClick={() =>
                void perform(async () => {
                  const next = await previewEditedSource(draft, source);
                  setDraft(next);
                  setSourcePath(next.path ?? "");
                  setDirty(true);
                })
              }
            >
              {t("Update preview")}
            </Button>
            {sourcePending ? (
              <Button
                variant="ghost"
                disabled={blocked}
                disabledReason={waitReason}
                onClick={() => setSource(draft.source ?? "")}
              >
                {t("Discard source changes")}
              </Button>
            ) : null}
          </div>
        ) : null}
        <SavedDesignLibrary
          disabled={blocked || sourcePending}
          disabledReason={blockedReason}
          onError={fail}
          onOpen={(theme) => perform(replacing(() => openTheme(theme)))}
          onApply={(theme) =>
            perform(
              replacing(async () => {
                const next = await openSavedDesign(theme);
                await apply(next);
                receive({
                  ...next,
                  ...(next.source ? { source: authoredSceneSource(next.source) } : {}),
                });
              }),
            )
          }
        />
        {dialog}
      </div>
    </Sheet>
  );
}
