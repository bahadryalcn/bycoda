import { useEffect, useState, useSyncExternalStore } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../../../shared/lib/productIdentity";
import { ImagePlus } from "../../../../../shared/ui/icons";
import { Button } from "../../../../../shared/ui/Button";
import { IS_LINUX } from "../../../../../platform/tauri/platform";
import { useColorScheme } from "../../../../../shared/hooks/useColorScheme";
import { workspaceBackgroundImage } from "../../../../../shared/theme/workspaceBackground";
import { GradientBlurBackground } from "../../GradientBlurBackground";
import { GradientBackgroundCard } from "../../GradientBackgroundCard";
import {
  loadWorkspaceBackground,
  saveWorkspaceBackground,
  subscribeWorkspaceBackground,
} from "../../../model/workspaceBackground";
import {
  CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT,
  CHAT_BACKGROUND_SCOPE_DEFAULT,
  CHAT_BACKGROUND_BLUR_DEFAULT,
  NEW_THREAD_BACKGROUND_EFFECT_DEFAULT,
  CHAT_BACKGROUND_BLUR_MAX,
  CHAT_BACKGROUND_BLUR_MIN,
  CHAT_BACKGROUND_OPACITY_MAX,
  CHAT_BACKGROUND_OPACITY_MIN,
  chatBackgroundSrc,
  NEW_THREAD_BACKGROUND_EFFECTS,
  NEW_THREAD_BACKGROUND_EFFECT_LABELS,
  NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS,
} from "../../../model/appearance";
import {
  LIVE_BACKGROUND_DEFAULT,
  LIVE_BACKGROUND_INTENSITY_DEFAULT,
  LIVE_BACKGROUND_INTENSITY_MAX,
  LIVE_BACKGROUND_INTENSITY_MIN,
  liveBackgroundLabel,
  saveLiveBackground,
  saveLiveBackgroundIntensity,
  useLiveBackground,
  useLiveBackgroundIntensity,
  type LiveBackground,
} from "../../../model/liveBackground";
import { Group, Row, Segmented, SettingsFeedback, Slider } from "../../settingsControls";
import { AppearanceSaveFeedback, type AppearanceSettings } from "../../useAppearanceSettings";
import { AppearanceSection } from "./AppearanceSection";
import { LayerStack } from "../controls/LayerStack";
import { GlassControl } from "../controls/GlassControl";
import { SceneStrip } from "../controls/SceneStrip";
import { BackgroundPreview } from "../controls/BackgroundPreview";
import { BackgroundLibrary } from "../controls/BackgroundLibrary";
import { ImageDropZone } from "../controls/ImageDropZone";
import { LiveBackgroundCanvas } from "../../LiveBackgroundCanvas";
import layerStyles from "../controls/LayerStack.module.css";
import imageStyles from "../controls/BackgroundImage.module.css";

export function BackgroundSection({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const light = useColorScheme() === "light";
  const background = useSyncExternalStore(subscribeWorkspaceBackground, loadWorkspaceBackground);
  const effect = useLiveBackground();
  const intensity = useLiveBackgroundIntensity();
  const [lastScene, setLastScene] = useState<LiveBackground>("threads");
  if (effect !== "none" && lastScene !== effect) setLastScene(effect);
  // Live art covers the window, so glass cannot show behind it.
  const covered = effect !== "none";
  const glassOn = IS_LINUX || appearance.windowGlass;
  const glassApplies = glassOn && !light && !covered;
  const imageSrc = chatBackgroundSrc(appearance.chatBackgroundPath);
  const livePercent = Math.round(intensity * 100);
  return (
    <AppearanceSection id="backgrounds" title={t("Backgrounds")}>
      <BackgroundPreview
        appearance={appearance}
        light={light}
        effect={effect}
        intensity={intensity}
        background={background}
      />
      <LayerStack
        label={t("Backgrounds")}
        description={t("Layers from back to front")}
        layers={[
          {
            id: "glass",
            name: t("Glass"),
            description: t("Transparency of the sidebar and main pane"),
            enabled: glassOn,
            dimmed: !glassApplies,
            onToggle:
              IS_LINUX || light
                ? undefined
                : () => appearance.onWindowGlass(!appearance.windowGlass),
            strength: covered
              ? t("Hidden (Live on)")
              : !glassOn
                ? t("Off")
                : `${t("On")} · ${Math.round(appearance.opacity * 100)}%`,
            thumbnail: (
              <span
                className={layerStyles.glassSwatch}
                style={{ "--glass-opacity": appearance.opacity } as React.CSSProperties}
              />
            ),
            settingIds: [
              "window-glass",
              "sidebar-opacity",
              "main-pane-glass",
              "main-pane-opacity",
              "blur",
            ],
            anchorIds: [
              ...(IS_LINUX ? [] : ["window-glass"]),
              ...(appearance.bodyGlass ? [] : ["main-pane-opacity"]),
            ],
            content: <GlassControl appearance={appearance} light={light} covered={covered} />,
          },
          {
            id: "color",
            name: t("Color"),
            description: t("Gradient or solid color behind the workspace"),
            enabled: background.enabled,
            onToggle: () =>
              saveWorkspaceBackground(
                { ...background, enabled: !background.enabled },
                { base: background, fields: ["enabled"] },
              ),
            strength: background.enabled ? `${background.strength}%` : t("None"),
            thumbnail: (
              <span
                className="workspace-background-preview"
                style={
                  {
                    "--workspace-background-image": workspaceBackgroundImage(background),
                    "--workspace-background-strength": background.strength / 100,
                  } as React.CSSProperties
                }
              />
            ),
            settingIds: [
              "workspace-background",
              "workspace-gradient-style",
              "workspace-gradient-colors",
              "workspace-gradient-angle",
              "workspace-gradient-strength",
            ],
            anchorIds: [
              "workspace-gradient-style",
              "workspace-gradient-colors",
              "workspace-gradient-angle",
              "workspace-gradient-strength",
            ],
            content: <GradientBackgroundCard />,
          },
          {
            id: "image",
            name: t("Image"),
            description: t("Picture behind chat panes, global or per project"),
            enabled: Boolean(appearance.chatBackgroundPath),
            strength: appearance.chatBackgroundPath
              ? `${t("On")} · ${appearance.chatBackgroundBlur}px`
              : t("None"),
            thumbnail: imageSrc ? <img src={imageSrc} alt="" /> : <ImagePlus aria-hidden />,
            settingIds: ["chat-background", "new-thread-background-effect"],
            content: <ChatBackgroundCard appearance={appearance} />,
          },
          {
            id: "live",
            name: t("Live"),
            description: t("Animated scene that moves behind the workspace"),
            enabled: effect !== "none",
            onToggle: () => saveLiveBackground(effect === "none" ? lastScene : "none"),
            strength:
              effect === "none" ? t("None") : `${liveBackgroundLabel(effect)} · ${livePercent}%`,
            thumbnail: (
              <LiveBackgroundCanvas
                effect={effect === "none" ? lastScene : effect}
                intensity={1}
                still
                demoSpeech
                className="absolute inset-0"
              />
            ),
            settingIds: ["live-background"],
            content: (
              <Group
                id="live-background"
                title={t("Live background")}
                modified={
                  effect !== LIVE_BACKGROUND_DEFAULT ||
                  intensity !== LIVE_BACKGROUND_INTENSITY_DEFAULT
                }
                resetLabel={t("Reset live background")}
                onReset={() => {
                  saveLiveBackground(LIVE_BACKGROUND_DEFAULT);
                  saveLiveBackgroundIntensity(LIVE_BACKGROUND_INTENSITY_DEFAULT);
                }}
              >
                <SceneStrip
                  value={effect}
                  onChange={saveLiveBackground}
                  label={t("Live background scene")}
                />
                <Row
                  label={t("Visibility")}
                  description={t("How strongly the scene shows through.")}
                  disabled={effect === "none"}
                  disabledReason={t("Choose a scene first.")}
                >
                  <Slider
                    label={t("Live background visibility")}
                    value={livePercent}
                    display={`${livePercent}%`}
                    min={Math.round(LIVE_BACKGROUND_INTENSITY_MIN * 100)}
                    max={Math.round(LIVE_BACKGROUND_INTENSITY_MAX * 100)}
                    onChange={(value) => saveLiveBackgroundIntensity(value / 100)}
                    disabled={effect === "none"}
                  />
                </Row>
              </Group>
            ),
          },
        ]}
      />
      <AppearanceSaveFeedback settingIds={["chat-background", "live-background"]} />
    </AppearanceSection>
  );
}

export function ChatBackgroundCard({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const src = chatBackgroundSrc(appearance.chatBackgroundPath);
  const hasImage = Boolean(appearance.chatBackgroundPath && src);
  const emptyVisibility = Math.round(appearance.chatBackgroundEmptyOpacity * 100);
  const sessionVisibility = Math.round(appearance.chatBackgroundSessionOpacity * 100);
  const busy = appearance.chatBackgroundBusy;
  const [preview, setPreview] = useState<"empty" | "conversation">("empty");
  const [decoded, setDecoded] = useState<{ src: string; state: "ready" | "error" } | null>(null);
  useEffect(() => {
    if (!src) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (active) setDecoded({ src, state: "ready" });
    };
    image.onerror = () => {
      if (active) setDecoded({ src, state: "error" });
    };
    image.src = src;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);
  const imageState = decoded?.src === src ? decoded.state : "loading";
  const modified =
    Math.round(appearance.chatBackgroundEmptyOpacity * 100) !==
      Math.round(CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT * 100) ||
    Math.round(appearance.chatBackgroundSessionOpacity * 100) !==
      Math.round(CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT * 100) ||
    appearance.chatBackgroundScope !== CHAT_BACKGROUND_SCOPE_DEFAULT ||
    appearance.chatBackgroundBlur !== CHAT_BACKGROUND_BLUR_DEFAULT ||
    appearance.newThreadBackgroundEffect !== NEW_THREAD_BACKGROUND_EFFECT_DEFAULT;
  const choose = (droppedPath?: string) =>
    void appearance.onChooseChatBackground(droppedPath).catch(console.error);

  return (
    <Group
      id="chat-background"
      title={t("Chat background")}
      description={t("An image behind your chat panes. It stays on this device.")}
      modified={modified}
      resetLabel={t("Reset background settings")}
      onReset={() => {
        appearance.onChatBackgroundEmptyOpacity(
          Math.round(CHAT_BACKGROUND_EMPTY_OPACITY_DEFAULT * 100),
        );
        appearance.onChatBackgroundSessionOpacity(
          Math.round(CHAT_BACKGROUND_SESSION_OPACITY_DEFAULT * 100),
        );
        appearance.onChatBackgroundScope(CHAT_BACKGROUND_SCOPE_DEFAULT);
        appearance.onChatBackgroundBlur(CHAT_BACKGROUND_BLUR_DEFAULT);
        appearance.onNewThreadBackgroundEffect(NEW_THREAD_BACKGROUND_EFFECT_DEFAULT);
      }}
    >
      <div className={imageStyles.layout}>
        <ImageDropZone hasImage={hasImage} busy={busy} onChoose={choose}>
          {hasImage ? (
            <div
              className={`relative isolate h-full w-full overflow-hidden ${imageState === "ready" ? "chat-pane-background" : ""}`}
              data-project-chat-background="false"
              data-session-empty={preview === "empty"}
            >
              {imageState === "loading" ? (
                <div className="p-2">
                  <SettingsFeedback state="loading">{t("Loading…")}</SettingsFeedback>
                </div>
              ) : imageState === "ready" &&
                appearance.newThreadBackgroundEffect === "gradient-blur" ? (
                <GradientBlurBackground className="gradient-blur-preview absolute inset-0" />
              ) : null}
              {imageState === "ready" && preview === "conversation" ? (
                <div
                  className="relative flex h-full flex-col items-end justify-center gap-1 p-2"
                  aria-hidden
                >
                  <span className="max-w-[80%] rounded-sm bg-(--ui-surface-selected) px-2 py-0.5 text-ui-micro text-content">
                    {t("Conversation")}
                  </span>
                  <span className="self-start rounded-sm bg-(--ui-surface) px-2 py-0.5 text-ui-micro text-(--ui-text-secondary)">
                    {PRODUCT_IDENTITY.displayName}
                  </span>
                </div>
              ) : null}
            </div>
          ) : undefined}
        </ImageDropZone>
        <div className={imageStyles.side}>
          <div className={imageStyles.actions}>
            {hasImage ? (
              <>
                <Button
                  className="shrink-0"
                  onClick={() => choose()}
                  disabled={busy}
                  loading={appearance.chatBackgroundOperation === "choose"}
                  loadingLabel={t("Loading…")}
                  stableWidth
                >
                  {t("Choose image")}
                </Button>
                <Button
                  className="shrink-0"
                  onClick={() => void appearance.onClearChatBackground().catch(console.error)}
                  disabled={busy}
                  variant="danger"
                  loading={appearance.chatBackgroundOperation === "remove"}
                  loadingLabel={t("Loading…")}
                  stableWidth
                >
                  {t("Remove")}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => choose()}
                loading={busy}
                loadingLabel={t("Loading…")}
                startIcon={<ImagePlus className="icon-sm" aria-hidden />}
                stableWidth
              >
                {t("Choose image")}
              </Button>
            )}
          </div>
          <div className={imageStyles.blur}>
            <Slider
              label={t("Chat background blur")}
              value={appearance.chatBackgroundBlur}
              display={`${appearance.chatBackgroundBlur}px`}
              min={CHAT_BACKGROUND_BLUR_MIN}
              max={CHAT_BACKGROUND_BLUR_MAX}
              onChange={appearance.onChatBackgroundBlur}
            />
            <p className={imageStyles.hint}>{t("Applies to global and project images.")}</p>
          </div>
        </div>
      </div>
      <BackgroundLibrary appearance={appearance} />
      {hasImage && imageState === "error" ? (
        <SettingsFeedback state="error">
          {t("Image could not be loaded. Choose another image or remove it.")}
        </SettingsFeedback>
      ) : null}
      {appearance.chatBackgroundError ? (
        <SettingsFeedback state="error">{appearance.chatBackgroundError}</SettingsFeedback>
      ) : null}
      {hasImage ? (
        <>
          <Row label={t("Preview")}>
            <Segmented
              label={t("Preview")}
              value={preview}
              onChange={setPreview}
              options={[
                { value: "empty", label: t("Empty only") },
                { value: "conversation", label: t("Conversation") },
              ]}
            />
          </Row>
          <Row
            stacked
            label={t("Background effect")}
            description={
              NEW_THREAD_BACKGROUND_EFFECT_DESCRIPTIONS[appearance.newThreadBackgroundEffect]
            }
          >
            <Segmented
              label={t("Background effect")}
              value={appearance.newThreadBackgroundEffect}
              options={NEW_THREAD_BACKGROUND_EFFECTS.map((effect) => ({
                value: effect,
                label: NEW_THREAD_BACKGROUND_EFFECT_LABELS[effect],
              }))}
              onChange={appearance.onNewThreadBackgroundEffect}
              optionIdPrefix="new-thread-background-effect"
            />
          </Row>
          <Row label={t("Show on")} description={t("Empty sessions only, or every conversation.")}>
            <Segmented
              label={t("Show background on")}
              value={appearance.chatBackgroundScope}
              options={[
                {
                  value: "empty",
                  get label() {
                    return t("Empty only");
                  },
                },
                {
                  value: "all",
                  get label() {
                    return t("All sessions");
                  },
                },
              ]}
              onChange={appearance.onChatBackgroundScope}
            />
          </Row>
          <Row
            label={t("Empty chat visibility")}
            description={t("Background strength before a chat has messages.")}
          >
            <Slider
              label={t("Empty chat background visibility")}
              value={emptyVisibility}
              display={`${emptyVisibility}%`}
              min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
              onChange={appearance.onChatBackgroundEmptyOpacity}
            />
          </Row>
          <Row
            label={t("Session visibility")}
            description={t("Background strength once the conversation has messages.")}
          >
            <Slider
              label={t("Session background visibility")}
              value={sessionVisibility}
              display={`${sessionVisibility}%`}
              min={Math.round(CHAT_BACKGROUND_OPACITY_MIN * 100)}
              max={Math.round(CHAT_BACKGROUND_OPACITY_MAX * 100)}
              onChange={appearance.onChatBackgroundSessionOpacity}
            />
          </Row>
        </>
      ) : null}
    </Group>
  );
}
