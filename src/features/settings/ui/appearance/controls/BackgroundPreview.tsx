import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Dices } from "../../../../../shared/ui/icons";
import { workspaceBackgroundImage } from "../../../../../shared/theme/workspaceBackground";
import { useDecorativeMotionEnabled } from "../../../model/decorativeMotion";
import {
  saveLiveBackground,
  saveLiveBackgroundIntensity,
  type LiveBackground,
} from "../../../model/liveBackground";
import { randomBackgroundCombination } from "../../../model/backgroundSuggestions";
import {
  saveWorkspaceBackground,
  type WorkspaceBackground,
} from "../../../model/workspaceBackground";
import { chatBackgroundSrc } from "../../../model/appearance";
import { IS_LINUX } from "../../../../../platform/tauri/platform";
import { LiveBackgroundCanvas } from "../../LiveBackgroundCanvas";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import styles from "./BackgroundPreview.module.css";

/**
 * Live composite of the real layers, bottom to top: Live, Image, Color, Glass. Glass shows only
 * when it applies; the legend under the stage lists every layer in that order and mutes the ones
 * that are off.
 */
export function BackgroundPreview({
  appearance,
  light,
  effect,
  intensity,
  background,
}: {
  appearance: AppearanceSettings;
  light: boolean;
  effect: LiveBackground;
  intensity: number;
  background: WorkspaceBackground;
}) {
  useLocale();
  const motionEnabled = useDecorativeMotionEnabled();
  const src = chatBackgroundSrc(appearance.chatBackgroundPath);
  const hasImage = Boolean(appearance.chatBackgroundPath && src);
  const hasLive = effect !== "none";
  const glassActive = (IS_LINUX || appearance.windowGlass) && !light && !hasLive;
  const layers = [
    { label: t("Live"), on: hasLive },
    { label: t("Image"), on: hasImage },
    { label: t("Color"), on: background.enabled },
    { label: t("Glass"), on: glassActive },
  ];

  const roll = () => {
    const combination = randomBackgroundCombination();
    saveLiveBackground(combination.scene);
    saveLiveBackgroundIntensity(combination.intensity);
    saveWorkspaceBackground(
      { ...background, ...combination.gradient },
      {
        base: background,
        fields: Object.keys(combination.gradient) as (keyof WorkspaceBackground)[],
      },
    );
  };

  return (
    <div className={styles.preview}>
      <div className={styles.stage} aria-hidden>
        {hasLive ? (
          <div className={styles.layer} style={{ opacity: intensity }}>
            <LiveBackgroundCanvas
              effect={effect}
              intensity={1}
              still={!motionEnabled}
              demoSpeech
              className="absolute inset-0"
            />
          </div>
        ) : null}
        {hasImage && src ? (
          <img
            className={styles.layer}
            src={src}
            alt=""
            style={{
              opacity: appearance.chatBackgroundEmptyOpacity,
              filter: `blur(${appearance.chatBackgroundBlur}px)`,
            }}
          />
        ) : null}
        {background.enabled ? (
          <div
            className={`${styles.layer} ${styles.color}`}
            style={{
              backgroundImage: workspaceBackgroundImage(background),
              opacity: background.strength / 100,
            }}
          />
        ) : null}
        <div className={styles.window}>
          <div
            className={styles.sidebar}
            data-glass={glassActive || undefined}
            style={{ "--glass-opacity": appearance.opacity } as React.CSSProperties}
          >
            <span data-selected />
            <span />
            <span />
          </div>
          <div className={styles.main}>
            <span />
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <ul className={styles.legend} aria-label={t("Layers from back to front")}>
          {layers.map((layer) => (
            <li key={layer.label} data-off={!layer.on || undefined}>
              {layer.label}
              {layer.on ? null : <span className="sr-only"> ({t("Off")})</span>}
            </li>
          ))}
        </ul>
        <Button size="sm" variant="secondary" startIcon={<Dices />} onClick={roll}>
          {t("Random combination")}
        </Button>
      </div>
    </div>
  );
}
