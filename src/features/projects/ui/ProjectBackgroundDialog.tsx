import { Text } from "../../../shared/ui/Text";
import { validateChatBackgroundMedia } from "../runtime/backgroundMedia";
import { chatBackgroundKind } from "../../../shared/lib/chatBackgroundKind";
import { ChatBackgroundMedia } from "../../settings/public/ChatBackgroundMedia";
import { DesignStudioButton } from "../../settings/public/DesignStudio";
import {
  BackgroundHistory,
  BackgroundName,
  rememberBackground,
} from "../../settings/public/BackgroundHistory";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { RemoteActionError } from "../../connections/public/RemoteActionError";
import { describeRemoteError, type RemoteErrorView } from "../../connections/public/remoteFailure";
import { Slider } from "../../../shared/ui/Slider";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { Row } from "../../../shared/ui/settings/SettingsRows";
import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  chatBackgroundSrc,
  loadChatBackgroundEmptyOpacity,
  loadChatBackgroundPath,
  loadChatBackgroundSessionOpacity,
  loadChatBackgroundScope,
  loadNewThreadBackgroundEffect,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS,
  NEW_THREAD_BACKGROUND_EFFECT_LABELS,
  NEW_THREAD_BACKGROUND_EFFECTS,
  subscribeChatBackgroundPath,
  type ChatBackgroundScope,
  type NewThreadBackgroundEffect,
} from "../../settings/public/appearance";

import {
  clearProjectChatBackground,
  saveChatBackgroundFrom,
  pickAndSaveProjectChatBackground,
  projectChatBackgroundSrc,
} from "../model/chatBackground";
import {
  clearProjectChatBackgroundSetting,
  loadProjectChatBackgroundSettings,
  projectChatBackgroundImageRevision,
  saveProjectChatBackgroundSettings,
} from "../model/projectChatBackground";
import { useProjectBackgroundEffect } from "./useProjectBackgroundEffect";
import { GradientBlurBackground } from "../../settings/public/GradientBlurBackground";

type Props = {
  project: string;
  name: string;
  onClose: () => void;
};

export function ProjectBackgroundDialog({ project, name, onClose }: Props) {
  const t = useT();
  // Only the starting values of the controls below: later edits are held in their state.
  const [initial] = useState(() => loadProjectChatBackgroundSettings(project));
  const [path, setPath] = useState(initial?.path ?? null);
  const [emptyOpacity, setEmptyOpacity] = useState(
    initial?.emptyOpacity ?? loadChatBackgroundEmptyOpacity(),
  );
  const [sessionOpacity, setSessionOpacity] = useState(
    initial?.sessionOpacity ?? loadChatBackgroundSessionOpacity(),
  );
  const [scope, setScope] = useState<ChatBackgroundScope>(
    initial?.scope ?? loadChatBackgroundScope(),
  );
  const [effect, setEffect] = useState<NewThreadBackgroundEffect>(
    initial?.effect ?? NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  );
  const [revision, setRevision] = useState(projectChatBackgroundImageRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RemoteErrorView | null>(null);
  const globalPath = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadChatBackgroundPath,
    loadChatBackgroundPath,
  );
  const effectPreviewSrc = useProjectBackgroundEffect(path, effect, revision);
  const previewSrc = path
    ? (effectPreviewSrc ?? projectChatBackgroundSrc(path, revision))
    : chatBackgroundSrc(globalPath);
  const globalEffect = useSyncExternalStore(
    subscribeChatBackgroundPath,
    loadNewThreadBackgroundEffect,
    loadNewThreadBackgroundEffect,
  );
  const previewEffect = path ? effect : globalEffect;

  const save = (
    nextPath: string,
    nextEmptyOpacity: number,
    nextSessionOpacity: number,
    nextScope: ChatBackgroundScope,
    nextEffect: NewThreadBackgroundEffect,
    imageChanged = false,
  ) => {
    try {
      if (!imageChanged && loadProjectChatBackgroundSettings(project)?.path !== path)
        throw new Error(t("Could not save changes. Your previous appearance remains active."));
      saveProjectChatBackgroundSettings(
        project,
        {
          path: nextPath,
          emptyOpacity: nextEmptyOpacity,
          sessionOpacity: nextSessionOpacity,
          scope: nextScope,
          effect: nextEffect,
        },
        imageChanged,
      );
      setRevision(projectChatBackgroundImageRevision());
      return true;
    } catch (cause) {
      setError(describeRemoteError(cause));
      return false;
    }
  };

  const choose = async (previousPath?: string) => {
    setBusy(true);
    setError(null);
    try {
      const previous = loadProjectChatBackgroundSettings(project);
      const nextPath = previousPath
        ? await saveChatBackgroundFrom(previousPath)
        : await pickAndSaveProjectChatBackground(project);
      if (!nextPath) return;
      await validateChatBackgroundMedia(nextPath);
      if (JSON.stringify(loadProjectChatBackgroundSettings(project)) !== JSON.stringify(previous))
        throw new Error(t("Could not save changes. Your previous appearance remains active."));
      rememberBackground([nextPath, previous?.path ?? null], project);
      if (!save(nextPath, emptyOpacity, sessionOpacity, scope, effect, true)) return;
      setPath(nextPath);
    } catch (cause) {
      setError(describeRemoteError(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    setBusy(true);
    setError(null);
    try {
      const previous = loadProjectChatBackgroundSettings(project);
      rememberBackground([previous?.path ?? null], project);
      clearProjectChatBackgroundSetting(project);
      try {
        await clearProjectChatBackground(project);
      } catch (cause) {
        if (previous) saveProjectChatBackgroundSettings(project, previous);
        throw cause;
      }
      setPath(null);
      setEmptyOpacity(loadChatBackgroundEmptyOpacity());
      setSessionOpacity(loadChatBackgroundSessionOpacity());
      setScope(loadChatBackgroundScope());
      setEffect(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
      setRevision(projectChatBackgroundImageRevision());
    } catch (cause) {
      setError(describeRemoteError(cause));
    } finally {
      setBusy(false);
    }
  };

  const updateOpacity = (kind: "empty" | "session", percent: number) => {
    const next = Math.min(
      CHAT_BACKGROUND_OPACITY_MAX,
      Math.max(CHAT_BACKGROUND_OPACITY_MIN, percent / 100),
    );
    const nextEmptyOpacity = kind === "empty" ? next : emptyOpacity;
    const nextSessionOpacity = kind === "session" ? next : sessionOpacity;
    if (kind === "empty") setEmptyOpacity(next);
    else setSessionOpacity(next);
    if (path) save(path, nextEmptyOpacity, nextSessionOpacity, scope, effect);
  };

  const updateScope = (next: ChatBackgroundScope) => {
    setScope(next);
    if (path) save(path, emptyOpacity, sessionOpacity, next, effect);
  };

  const updateEffect = (next: NewThreadBackgroundEffect) => {
    setEffect(next);
    if (path) save(path, emptyOpacity, sessionOpacity, scope, next);
  };

  return (
    <Modal
      title={t("Chat background")}
      description={name}
      size="sm"
      fitViewport
      closeDisabled={busy}
      onClose={busy ? () => {} : onClose}
    >
      <div className="flex flex-col gap-5">
        <div>
          {/* Without a background there is nothing to preview: the button below is the whole state. */}
          {chatBackgroundKind(path ?? globalPath) !== "image" ? (
            <Surface variant="card" padding="none" className="overflow-hidden">
              <div className="relative h-40">
                <ChatBackgroundMedia path={path ?? globalPath} />
              </div>
            </Surface>
          ) : previewSrc ? (
            <Surface variant="card" padding="none" className="overflow-hidden">
              {previewEffect === "gradient-blur" ? (
                <div className="relative h-40">
                  <GradientBlurBackground
                    className="gradient-blur-preview absolute inset-0"
                    style={
                      {
                        "--chat-background-image": `url(${JSON.stringify(previewSrc)})`,
                        opacity: emptyOpacity,
                      } as CSSProperties
                    }
                  />
                </div>
              ) : (
                <img
                  src={previewSrc}
                  alt=""
                  draggable={false}
                  className="h-40 w-full object-cover opacity-(--background-preview-opacity)"
                  style={{ "--background-preview-opacity": emptyOpacity } as React.CSSProperties}
                />
              )}
            </Surface>
          ) : null}
          <div className={`flex items-center gap-1${previewSrc ? " mt-2" : ""}`}>
            <Button
              variant="secondary"
              motion="none"
              type="button"
              loading={busy}
              onClick={() => void choose()}
              disabled={busy}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5"
            >
              {t("Choose background")}
            </Button>
            <DesignStudioButton
              project={project}
              label={t("Create background")}
              onApplied={() => {
                const next = loadProjectChatBackgroundSettings(project);
                setPath(next?.path ?? null);
                setEmptyOpacity(next?.emptyOpacity ?? loadChatBackgroundEmptyOpacity());
                setSessionOpacity(next?.sessionOpacity ?? loadChatBackgroundSessionOpacity());
                setScope(next?.scope ?? loadChatBackgroundScope());
                setEffect(next?.effect ?? NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
                setRevision(projectChatBackgroundImageRevision());
              }}
            />
            <InfoPopover>
              <Text as="p" size="caption" tone="secondary" leading="relaxed">
                {path
                  ? t("This background overrides the global background for this project.")
                  : t("This project currently follows the global Appearance setting.")}
              </Text>
            </InfoPopover>
          </div>
          <BackgroundName path={path ?? globalPath} />
          {error ? <RemoteActionError error={error} /> : null}
          <BackgroundHistory
            target={project}
            path={path ?? globalPath}
            look={
              path ? { image: { scope, emptyOpacity, sessionOpacity, effect, blur: 0 } } : undefined
            }
            disabled={busy}
            onChoose={(next) => {
              void choose(next);
            }}
          />
        </div>

        {path ? (
          <ProjectBackgroundRow
            label={t("Background effect")}
            info={
              <InfoPopover label={NEW_THREAD_BACKGROUND_EFFECT_LABELS[effect]}>
                <Text as="p" size="caption" tone="secondary" leading="relaxed">
                  {NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS[effect]}
                </Text>
              </InfoPopover>
            }
          >
            <div className="w-36 max-w-full">
              <SearchableSelect
                disabled={busy || chatBackgroundKind(path) !== "image"}
                hideLabel
                label={t("Project background effect")}
                variant="transparent"
                value={effect}
                options={NEW_THREAD_BACKGROUND_EFFECTS.map((option) => ({
                  value: option,
                  label: NEW_THREAD_BACKGROUND_EFFECT_LABELS[option],
                }))}
                onChange={(next) => updateEffect(next as NewThreadBackgroundEffect)}
                searchable={false}
                align="end"
              />
            </div>
          </ProjectBackgroundRow>
        ) : null}

        {/* These settings act on an image, so they appear only once one is chosen. */}
        {path ? (
          <>
            <ProjectBackgroundRow label={t("Show on")}>
              <SegmentedControl
                label={t("Show project background on")}
                value={scope}
                onValueChange={(next) => updateScope(next as ChatBackgroundScope)}
                options={[
                  { value: "empty", label: t("Empty only"), disabled: busy },
                  { value: "all", label: t("All sessions"), disabled: busy },
                ]}
              />
            </ProjectBackgroundRow>

            <ProjectBackgroundRow label={t("Empty chat visibility")}>
              <div className="flex w-56 max-w-full items-center gap-3">
                <Slider
                  disabled={busy}
                  hideLabel
                  label={t("Project background visibility in empty chats")}
                  min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
                  max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
                  value={Math.round(emptyOpacity * 100)}
                  onValueChange={(next) => updateOpacity("empty", next)}
                  className="min-w-0 flex-1"
                />
                <Text size="caption" tone="primary" className="w-10 shrink-0 text-end tabular-nums">
                  {Math.round(emptyOpacity * 100)}%
                </Text>
              </div>
            </ProjectBackgroundRow>

            <ProjectBackgroundRow label={t("Session visibility")}>
              <div className="flex w-56 max-w-full items-center gap-3">
                <Slider
                  disabled={busy}
                  hideLabel
                  label={t("Project background visibility in sessions")}
                  min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
                  max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
                  value={Math.round(sessionOpacity * 100)}
                  onValueChange={(next) => updateOpacity("session", next)}
                  className="min-w-0 flex-1"
                />
                <Text size="caption" tone="primary" className="w-10 shrink-0 text-end tabular-nums">
                  {Math.round(sessionOpacity * 100)}%
                </Text>
              </div>
            </ProjectBackgroundRow>
          </>
        ) : null}

        {path ? (
          <Button
            variant="item"
            motion="none"
            type="button"
            tone="danger"
            loading={busy}
            onClick={() => void removeImage()}
            disabled={busy}
            className="w-full"
          >
            {t("Remove")}
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

// Shared settings Row: its label column wraps and its control column wraps below the label when the
// modal is narrow or the locale's labels are long. The pane edge keeps the hairline between rows.
function ProjectBackgroundRow({
  label,
  info,
  children,
}: {
  label: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div {...surfaceAttributes({ frame: "pane", edge: "top" })}>
      <Row label={label} info={info}>
        {children}
      </Row>
    </div>
  );
}
