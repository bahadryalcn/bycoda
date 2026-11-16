import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useThemeGeneratorModel } from "./useThemeGeneratorModel";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { lazy, Suspense, useEffect, useState, type KeyboardEvent } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Spinner } from "../../../../../shared/ui/Spinner";
import { ImageLightbox } from "../../../../../shared/ui/ImageLightbox";
import { Dices, Maximize2 } from "../../../../../shared/ui/icons";
import { randomThemePrompt } from "../../../model/themePromptIdeas";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { canRunHarnessTextPrompt } from "../../../../../integrations/harness";
import { HARNESSES } from "../../../../sessions";
import { defaultModelSettings, resolveModel } from "../../../../sessions/public/models";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../../../providers/public/providerAccounts";
import {
  addBackgroundLibraryImage,
  libraryImageSrc,
  type BackgroundLibraryImage,
} from "../../../model/backgroundLibrary";
import {
  randomThemeSuggestions,
  suggestionAreas,
  suggestionSwatches,
  type ThemeSuggestion,
  type ThemeSuggestionArea,
} from "../../../model/themeSuggestions";
import { SettingsFeedback } from "../../../../../shared/ui/settings";
import { SaveLookButton } from "./SaveLookButton";
import { ImageProviderButton } from "./ImageProviderButton";
import { applyDrawnImageTuning, applyThemeSuggestion } from "./applyThemeSuggestion";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import {
  requestBackgroundImage,
  requestThemeSuggestions,
  themeSuggestionFailureDetail,
  type BackgroundImageProvider,
} from "./themeSuggestionRequest";
import { generatorSession, readGeneratorValue, useGeneratorState } from "./themeGeneratorSession";
import "./ThemeControls.css";
import { isImeComposition } from "../../../../../shared/lib/keyboard";

const ModelPicker = lazy(() =>
  import("../../../../sessions")
    .then((entry) => entry.loadModelPicker())
    .then((module) => ({ default: module.ModelPicker })),
);

/** The image state of one suggestion chip: drawing, ready (with the stored file) or failed. */
export type ChipImage =
  | { status: "loading" }
  | { status: "done"; image: BackgroundLibraryImage }
  | { status: "error"; detail: string };

/**
 * What choosing a chip does with its image: a drawing in flight is applied when it lands ("wait"),
 * a finished one is reused ("apply"), and a missing or failed one is drawn ("draw").
 */
export function chipImageAction(image: ChipImage | undefined): "wait" | "apply" | "draw" {
  if (image?.status === "loading") return "wait";
  if (image?.status === "done") return "apply";
  return "draw";
}

const areaLabel = (area: ThemeSuggestionArea) => {
  switch (area) {
    case "theme":
      return t("Theme");
    case "typography":
      return t("Typography");
    case "interface":
      return t("Interface");
    case "background":
      return t("Background");
    case "motion":
      return t("Motion");
  }
};

/**
 * One compact toolbar: describe a theme (or roll a prompt), or roll colors at random; choosing a
 * suggestion chip applies it at once. Image generation is a separate explicit action.
 */
export function ThemeGenerator({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const [preview, setPreview] = useState<{ image: BackgroundLibraryImage; name: string } | null>(
    null,
  );
  // Everything below survives closing Settings (see themeGeneratorSession.ts).
  const [prompt, setPrompt] = useGeneratorState("prompt", "");
  const [choice, setChoice] = useThemeGeneratorModel();
  const [suggestions, setSuggestions] = useGeneratorState<ThemeSuggestion[]>("suggestions", []);
  const [busy, setBusy] = useGeneratorState("busy", false);
  /** `null` while nothing failed; otherwise the Host's reason, or "" when it gave none. */
  const [failure, setFailure] = useGeneratorState<string | null>("failure", null);
  const [withImage, setWithImage] = useGeneratorState("withImage", false);
  const [, setLookName] = useGeneratorState("selectedLookName", "");
  const [imageProvider, setImageProvider] = useGeneratorState<BackgroundImageProvider>(
    "imageProvider",
    "codex",
  );
  const [imageFailure, setImageFailure] = useGeneratorState<string | null>("imageFailure", null);
  /** Image state per suggestion index; cleared when the suggestions change. */
  const [chipImages, setChipImages] = useGeneratorState<Record<number, ChipImage>>(
    "chipImages",
    {},
  );
  const [retryTarget, setRetryTarget] = useGeneratorState<
    { suggestion: ThemeSuggestion; index: number } | undefined
  >("retryTarget", undefined);
  const [selectedIndex, setSelectedIndex] = useGeneratorState<number | null>("selectedIndex", null);
  /** Counters live in the session (not refs) so work that finishes after closing still checks them. */
  const session = generatorSession;
  // Background work applies through the newest mounted Appearance, or the last one if closed.
  useEffect(() => session.bindAppearance(appearance), [session, appearance]);
  const available = canRunHarnessTextPrompt(choice.harness);
  const trimmed = prompt.trim();

  const generate = async () => {
    if (!trimmed || !available || busy) return;
    const version = session.nextEpoch();
    setBusy(true);
    setFailure(null);
    try {
      const next = await requestThemeSuggestions({
        prompt: trimmed,
        harness: choice.harness,
        model: choice.model,
        modelSettings: choice.modelSettings,
        providerAccountId: choice.providerAccountId,
      });
      if (version !== session.epoch()) return;
      if (next.length === 0) throw new Error(t("The model returned no usable theme."));
      resetChips();
      setSuggestions(next);
    } catch (error) {
      if (version === session.epoch()) {
        setFailure(themeSuggestionFailureDetail(error));
      }
    } finally {
      if (version === session.epoch()) setBusy(false);
    }
  };

  const resetChips = () => {
    session.bumpBatch();
    session.select(null);
    setSelectedIndex(null);
    setChipImages({});
    setImageFailure(null);
    setRetryTarget(undefined);
  };

  /** Puts a drawn library image in place and tunes it so text stays readable. */
  const applyImage = async (image: BackgroundLibraryImage, suggestion: ThemeSuggestion) => {
    session.invalidateImageIntent();
    const intent = session.imageIntent();
    const live = session.appearance() as AppearanceSettings;
    const stored = await live.onChooseChatBackground(image.path, {
      libraryId: image.id,
      isCurrent: () => intent === session.imageIntent(),
    });
    if (intent !== session.imageIntent()) return;
    if (!stored) throw new Error(t("Could not use the generated image."));
    if (intent === session.imageIntent()) applyDrawnImageTuning(live, suggestion);
  };

  /**
   * Each chip draws its own image once. Every finished image stays on its chip and in the library,
   * so owners can explicitly use a finished image later.
   */
  const drawImage = async (suggestion: ThemeSuggestion, index: number) => {
    const owner = session.batch();
    const mark = (image: ChipImage) => {
      if (owner === session.batch()) setChipImages((current) => ({ ...current, [index]: image }));
    };
    if (
      readGeneratorValue<Record<number, ChipImage>>("chipImages", {})[index]?.status === "loading"
    )
      return;
    mark({ status: "loading" });
    try {
      const imagePrompt =
        suggestion.imagePrompt ?? `${trimmed || suggestion.name}, ${suggestion.accent}`;
      const path = await requestBackgroundImage({
        prompt: imagePrompt,
        provider: imageProvider,
      });
      const image = await addBackgroundLibraryImage(path, {
        source: "generated",
        prompt: imagePrompt,
      });
      if (owner !== session.batch()) return;
      mark({ status: "done", image });
      // The chosen look waits for its drawing; a chip drawn in the background only keeps it.
      if (session.selected() === index)
        await applyImage(image, suggestion).catch((error: unknown) =>
          setImageFailure(themeSuggestionFailureDetail(error)),
        );
    } catch (error) {
      if (owner !== session.batch()) return;
      mark({ status: "error", detail: themeSuggestionFailureDetail(error) });
      if (session.selected() === index) {
        setRetryTarget({ suggestion, index });
        setImageFailure(themeSuggestionFailureDetail(error));
      }
    }
  };

  const startImage = (suggestion: ThemeSuggestion, index: number) => {
    setImageFailure(null);
    setRetryTarget(undefined);
    // drawImage() reports its own failures; the handler only keeps an unexpected one visible.
    drawImage(suggestion, index).catch((error: unknown) =>
      setImageFailure(themeSuggestionFailureDetail(error)),
    );
  };

  /**
   * Applies the whole look. Its image follows: a finished drawing is used, one in flight is used
   * when it lands, image mode draws one, and otherwise the previous look's image is removed.
   */
  const choose = (suggestion: ThemeSuggestion, index: number) => {
    session.invalidateImageIntent();
    applyThemeSuggestion(appearance, suggestion);
    setLookName(suggestion.name);
    session.select(index);
    setSelectedIndex(index);
    setImageFailure(null);
    setRetryTarget(undefined);
    const image = chipImages[index];
    const action = chipImageAction(image);
    if (action === "apply" && image?.status === "done") {
      applyImage(image.image, suggestion).catch((error: unknown) =>
        setImageFailure(themeSuggestionFailureDetail(error)),
      );
    } else if (action === "draw" && withImage) {
      startImage(suggestion, index);
    } else if (action === "draw" && appearance.chatBackgroundPath) {
      appearance
        .onClearChatBackground()
        .catch((error: unknown) => setImageFailure(themeSuggestionFailureDetail(error)));
    }
  };

  const random = () => {
    const next = randomThemeSuggestions();
    resetChips();
    setSuggestions(next);
    setFailure(null);
    const first = next[0];
    if (first) choose(first, 0);
  };

  // generate() reports its own failures; the handler only keeps an unexpected one from going unhandled.
  const startGenerate = () => {
    generate().catch((error: unknown) => setFailure(themeSuggestionFailureDetail(error)));
  };

  const rollPrompt = () => setPrompt(randomThemePrompt(prompt));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) startGenerate();
  };

  const dismiss = () => {
    setFailure(null);
    setImageFailure(null);
  };
  const detail = failure ?? imageFailure ?? "";
  const signedOut = /authenticat|log ?in|credential|expired|unauthori/i.test(detail);
  const failureFeedback =
    failure !== null || imageFailure !== null ? (
      <SettingsFeedback
        state="error"
        onDismiss={dismiss}
        action={
          failure === null && retryTarget
            ? {
                label: t("Retry"),
                onClick: () => startImage(retryTarget.suggestion, retryTarget.index),
              }
            : undefined
        }
      >
        {[
          failure !== null
            ? t("Theme generation failed.")
            : t("Background image generation failed."),
          failure ?? imageFailure,
          signedOut
            ? failure !== null
              ? t("Pick a signed-in account in the model picker, or sign in to the provider again.")
              : t("Check the selected image provider and sign in again.")
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      </SettingsFeedback>
    ) : selectedIndex !== null && chipImages[selectedIndex]?.status === "loading" ? (
      <SettingsFeedback state="loading" immediate>
        {t("Drawing a background image…")}
      </SettingsFeedback>
    ) : null;

  return (
    <div className="theme-generator">
      <div className="theme-generator-bar">
        <div className="theme-generator-prompt">
          <TextField
            fieldClassName="theme-generator-input"
            fieldVariant="compact"
            label={t("Describe a theme")}
            hideLabel
            value={prompt}
            placeholder={t("For example “midnight ocean” or “warm kiln”")}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button
            iconOnly
            label={t("Random prompt")}
            size="sm"
            variant="ghost"
            onClick={rollPrompt}
          >
            <Dices />
          </Button>
        </div>
        <Suspense fallback={<LoadingText />}>
          <ModelPicker
            harness={choice.harness}
            model={choice.model}
            values={choice.modelSettings ?? {}}
            accountId={choice.providerAccountId}
            accountChoices
            allowedHarnesses={HARNESSES.filter(canRunHarnessTextPrompt)}
            onChange={(harness, model, accountId) => {
              setChoice({
                ...choice,
                harness,
                model,
                modelSettings: defaultModelSettings(resolveModel(harness, model)),
                // The Host runs the prompt under this bycoda account; without one it would use
                // the provider's own default login, which may be signed out.
                providerAccountId: supportsProviderAccounts(harness)
                  ? (accountId ?? defaultProviderAccountId(harness))
                  : undefined,
              });
            }}
            onSettingsChange={(modelSettings) => {
              setChoice({ ...choice, modelSettings });
            }}
          />
        </Suspense>
        <div className="theme-generator-actions">
          <ImageProviderButton
            value={withImage ? imageProvider : "none"}
            onChange={(value) => {
              if (value === "none") session.invalidateImageIntent();
              setWithImage(value !== "none");
              if (value !== "none") setImageProvider(value);
            }}
          />
          <SaveLookButton appearance={appearance} iconOnly />
          <Button size="sm" tooltip={t("Roll a random palette without a model")} onClick={random}>
            {t("Random look")}
          </Button>
          <Button
            variant="primary"
            tone="accent"
            size="sm"
            loading={busy}
            loadingLabel={t("Generating…")}
            disabled={!trimmed || !available}
            disabledReason={
              available
                ? undefined
                : t("Choose a model that supports text actions to generate a theme.")
            }
            onClick={startGenerate}
          >
            {t("Generate themes")}
          </Button>
        </div>
      </div>
      {suggestions.length > 0 ? (
        <div className="theme-suggestions" role="group" aria-label={t("Suggested themes")}>
          {suggestions.map((suggestion, index) => {
            const [canvas, surface, line, accent] = suggestionSwatches(suggestion);
            const image = chipImages[index];
            const areas = suggestionAreas(suggestion).map(areaLabel);

            return (
              <div key={`${suggestion.name}-${index}`} className="theme-suggestion-card">
                <Button
                  size="sm"
                  variant="item"
                  className="theme-suggestion"
                  pressed={selectedIndex === index}
                  aria-label={t("Apply {p1}", { p1: suggestion.name })}
                  tooltip={t("Changes: {p1}", { p1: areas.join(", ") })}
                  onClick={() => choose(suggestion, index)}
                >
                  <span className="theme-swatch-strip" aria-hidden="true">
                    <span
                      {...surfaceAttributes({ variant: "user-color" })}
                      style={{ "--surface-user-color": canvas } as React.CSSProperties}
                    />
                    <span
                      {...surfaceAttributes({ variant: "user-color" })}
                      style={{ "--surface-user-color": surface } as React.CSSProperties}
                    />
                    <span
                      {...surfaceAttributes({ variant: "user-color" })}
                      style={{ "--surface-user-color": line } as React.CSSProperties}
                    />
                    <span
                      {...surfaceAttributes({ variant: "user-color" })}
                      style={{ "--surface-user-color": accent } as React.CSSProperties}
                    />
                  </span>
                  {image && image.status !== "error" ? (
                    <span className="theme-suggestion-thumb" aria-hidden="true">
                      {image.status === "loading" ? (
                        <Spinner size="xs" />
                      ) : (
                        <img
                          src={libraryImageSrc(image.image)}
                          alt=""
                          decoding="async"
                          draggable={false}
                        />
                      )}
                    </span>
                  ) : null}
                  <Text truncate>{suggestion.name}</Text>
                </Button>
                {image?.status === "done" ? (
                  <Button
                    iconOnly
                    size="sm"
                    variant="ghost"
                    label={t("Preview {p0}", { p0: suggestion.name })}
                    onClick={() => setPreview({ image: image.image, name: suggestion.name })}
                  >
                    <Maximize2 />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {failureFeedback}
      {preview ? (
        <ImageLightbox
          src={libraryImageSrc(preview.image)}
          alt={preview.name}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
