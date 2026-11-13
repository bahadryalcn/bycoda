import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { ClampText } from "../../../shared/ui/ClampText";
import { Alert } from "../../../shared/ui/Alert";
import { Slider } from "../../../shared/ui/Slider";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { useLocale, useT } from "../../../shared/i18n";
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
  const [error, setError] = useState<string | null>(null);
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
  };

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextPath = await pickAndSaveProjectChatBackground(project);
      if (!nextPath) return;
      save(nextPath, emptyOpacity, sessionOpacity, scope, effect, true);
      setPath(nextPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    setBusy(true);
    setError(null);
    try {
      const previous = loadProjectChatBackgroundSettings(project);
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
      setError(cause instanceof Error ? cause.message : String(cause));
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
      title={t("Background Image")}
      description={t("Choose a background image for {p0}", { p0: name })}
      size="sm"
      fitViewport
      closeDisabled={busy}
      onClose={busy ? () => {} : onClose}
    >
      <div className="flex flex-col gap-5">
        <div>
          <div
            className={`overflow-hidden rounded-(--ui-radius-card) border border-(--ui-card-border) ${previewEffect === "gradient-blur" ? "bg-background-base" : "bg-[var(--ui-surface-hover)]"}`}
          >
            {previewSrc ? (
              previewEffect === "gradient-blur" ? (
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
              )
            ) : (
              <Text as="div" size="caption" tone="muted" className="grid h-40 place-items-center">
                {t("No background selected")}
              </Text>
            )}
          </div>
          <Button
            variant="secondary"
            motion="none"
            type="button"
            loading={busy}
            onClick={() => void choose()}
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-1.5"
          >
            {path ? t("Change image") : t("Choose image")}
          </Button>
          <Text as="p" size="micro" tone="muted" leading="relaxed" className="mt-1.5">
            {path
              ? t("This image overrides the global background for this project.")
              : t("This project currently follows the global Appearance setting.")}
          </Text>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>

        {path ? (
          <div {...surfaceAttributes({ frame: "stroke", edge: "top" }, "pt-4")}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Text size="secondary" tone="primary" weight="medium">
                  {t("Background effect")}
                </Text>
                <ClampText as="p" lines={1} expandable={false} size="micro" tone="muted">
                  {NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS[effect]}
                </ClampText>
              </div>
              <div className="w-36 shrink-0">
                <SearchableSelect
                  disabled={busy}
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
            </div>
          </div>
        ) : null}

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
          <div className="flex w-56 items-center gap-3">
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
            <Text size="caption" tone="primary" className="w-10 shrink-0 text-right tabular-nums">
              {Math.round(emptyOpacity * 100)}%
            </Text>
          </div>
        </ProjectBackgroundRow>

        <ProjectBackgroundRow label={t("Session visibility")}>
          <div className="flex w-56 items-center gap-3">
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
            <Text size="caption" tone="primary" className="w-10 shrink-0 text-right tabular-nums">
              {Math.round(sessionOpacity * 100)}%
            </Text>
          </div>
        </ProjectBackgroundRow>

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
            {t("Remove background image")}
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

function ProjectBackgroundRow({ label, children }: { label: string; children: ReactNode }) {
  useLocale();
  return (
    <div
      {...surfaceAttributes(
        { frame: "stroke", edge: "top" },
        "flex items-center justify-between gap-4 pt-4",
      )}
    >
      <Text size="secondary" tone="primary" weight="medium">
        {label}
      </Text>
      {children}
    </div>
  );
}
