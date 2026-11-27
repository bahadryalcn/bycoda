import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { useThemeGeneratorModel } from "./useThemeGeneratorModel";
import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { t, useLocale } from "../../../../../shared/i18n";
import { ErrorDetails } from "../../../../../shared/ui/ErrorDetails";
import { Button } from "../../../../../shared/ui/Button";
import { ImageLightbox } from "../../../../../shared/ui/ImageLightbox";
import { Check, Dices, RefreshCw, Sparkles } from "../../../../../shared/ui/icons";
import { MediaToolbarButton } from "../../../../../shared/ui/MediaToolbar";
import { Divider } from "../../../../../shared/ui/Divider";
import { randomThemePrompt } from "../../../model/themePromptIdeas";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import { canRunHarnessTextPrompt } from "../../../../../integrations/harness";
import { AppearanceModelPicker } from "./AppearanceModelPicker";
import { DesignStudioButton } from "./DesignStudioButton";
import {
  addBackgroundLibraryImage,
  libraryImageSrc,
  loadCurrentLibraryImageId,
  subscribeBackgroundLibrary,
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
import { ImageProviderButton } from "./ImageProviderButton";
import { ThemeGenerationActivity } from "./ThemeGenerationActivity";
import {
  beginGenerationJob,
  isActiveGeneration,
  readGenerationJobs,
  useGenerationJobs,
} from "./themeGenerationJobs";
import { applyDrawnImageTuning, applyThemeSuggestion } from "./applyThemeSuggestion";
import type { AppearanceSettings } from "../../useAppearanceSettings";
import {
  requestBackgroundImage,
  requestThemeSuggestions,
  themeSuggestionFailureDetail,
  type BackgroundImageProvider,
  type ThemeSuggestionParams,
} from "./themeSuggestionRequest";
import {
  generatorSession,
  readGeneratorValue,
  useGeneratorState,
  writeGeneratorValue,
} from "./themeGeneratorSession";
import "./ThemeControls.css";
import { isImeComposition } from "../../../../../shared/lib/keyboard";

/** The image state of one suggestion chip: drawing, ready (with the stored file) or failed. */
export type ChipImage =
  | { status: "loading" }
  | { status: "done"; image: BackgroundLibraryImage }
  | { status: "error"; detail: string };

/**
 * The image state behind choosing a chip: a drawing in flight ("wait"), a finished one to review
 * ("review"), or none yet ("draw", which the card's Generate image action starts).
 */
export function chipImageAction(image: ChipImage | undefined): "wait" | "review" | "draw" {
  if (image?.status === "loading") return "wait";
  if (image?.status === "done") return "review";
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
    case "chat":
      return t("Chat");
    case "background":
      return t("Background");
    case "motion":
      return t("Motion");
  }
};

/**
 * Choosing a suggestion applies its appearance; generated images stay available for review.
 */
export function ThemeGenerator({ appearance }: { appearance: AppearanceSettings }) {
  useLocale();
  const [preview, setPreview] = useState<{
    image: BackgroundLibraryImage;
    name: string;
    candidate?: { suggestion: ThemeSuggestion; index: number; batch: number };
  } | null>(null);
  const [applyingImage, setApplyingImage] = useGeneratorState<string | null>("applyingImage", null);
  const currentImageId = useSyncExternalStore(
    subscribeBackgroundLibrary,
    loadCurrentLibraryImageId,
  );
  // Everything below survives closing Settings (see themeGeneratorSession.ts).
  const [prompt, setPrompt] = useGeneratorState("prompt", "");
  const [choice] = useThemeGeneratorModel();
  const [suggestions, setSuggestions] = useGeneratorState<ThemeSuggestion[]>("suggestions", []);
  const jobs = useGenerationJobs();
  const busy = jobs.some((job) => job.kind === "themes" && isActiveGeneration(job));
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
  const [selectedIndex, setSelectedIndex] = useGeneratorState<number | null>("selectedIndex", null);
  /** Counters live in the session (not refs) so work that finishes after closing still checks them. */
  const session = generatorSession;
  // Background work applies through the newest mounted Appearance, or the last one if closed.
  useEffect(() => session.bindAppearance(appearance), [session, appearance]);
  const available = canRunHarnessTextPrompt(choice.harness);
  const trimmed = prompt.trim();

  const generate = async (params: ThemeSuggestionParams) => {
    if (readGenerationJobs().some((job) => job.kind === "themes" && isActiveGeneration(job)))
      return;
    const job = beginGenerationJob({ kind: "themes", name: params.prompt }, () =>
      startGenerate(params),
    );
    try {
      const next = await requestThemeSuggestions(params, job.generation);
      if (!(await job.acceptResult())) return;
      if (next.length === 0) throw new Error(t("The model returned no usable theme."));
      resetChips();
      writeGeneratorValue("suggestionPrompt", params.prompt, "");
      setSuggestions(next);
      job.done();
    } catch (error) {
      if (await job.acceptResult()) job.fail(error);
    }
  };

  const resetChips = () => {
    session.bumpBatch();
    session.invalidateImageIntent();
    setSelectedIndex(null);
    setChipImages({});
    setImageFailure(null);
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
    if (intent !== session.imageIntent()) return false;
    if (!stored) throw new Error(t("Could not use the generated image."));
    applyDrawnImageTuning(live, suggestion);
    return true;
  };

  const applyCandidate = (image: BackgroundLibraryImage, suggestion: ThemeSuggestion) => {
    if (readGeneratorValue("applyingImage", null) !== null || appearance.chatBackgroundBusy) return;
    setImageFailure(null);
    setApplyingImage(image.id);
    applyImage(image, suggestion)
      .then((applied) => {
        if (applied) setPreview((current) => (current?.image.id === image.id ? null : current));
      })
      .finally(() => setApplyingImage(null))
      .catch((error: unknown) =>
        setImageFailure(
          themeSuggestionFailureDetail(error) || t("Could not use the generated image."),
        ),
      );
  };

  const isDrawing = (index: number, batch: number, requests = readGenerationJobs()) =>
    requests.some(
      (job) =>
        job.kind === "image" &&
        job.batch === batch &&
        job.index === index &&
        isActiveGeneration(job),
    );

  /** Keep the last candidate on its card until a replacement has been saved to the library. */
  const drawImage = async (
    suggestion: ThemeSuggestion,
    index: number,
    batch: number,
    imagePrompt: string,
    provider: BackgroundImageProvider,
  ) => {
    if (isDrawing(index, batch)) return;
    const job = beginGenerationJob(
      { kind: "image", name: suggestion.name, provider, batch, index },
      () => startImage(suggestion, index, batch, imagePrompt, provider),
    );
    let image: BackgroundLibraryImage;
    try {
      const path = await requestBackgroundImage({ prompt: imagePrompt, provider }, job.generation);
      if (!(await job.acceptResult())) return;
      job.saving();
      image = await addBackgroundLibraryImage(path, {
        source: "generated",
        prompt: imagePrompt,
      });
    } catch (error) {
      if (await job.acceptResult()) job.fail(error);
      return;
    }
    job.done(image);
    if (batch !== session.batch()) return;
    setChipImages((current) => ({ ...current, [index]: { status: "done", image } }));
  };

  const startImage = (
    suggestion: ThemeSuggestion,
    index: number,
    batch = session.batch(),
    imagePrompt = suggestion.imagePrompt ??
      `${readGeneratorValue("suggestionPrompt", "") || suggestion.name}, ${suggestion.accent}`,
    provider = imageProvider,
  ) => {
    setImageFailure(null);
    drawImage(suggestion, index, batch, imagePrompt, provider).catch((error: unknown) =>
      setImageFailure(themeSuggestionFailureDetail(error)),
    );
  };

  /**
   * Apply the theme now; an image is drawn only from the card's Generate image action and used
   * only from Use image. With images off, a look without one removes the previous look's image.
   */
  const choose = (suggestion: ThemeSuggestion, index: number) => {
    session.invalidateImageIntent();
    const image: ChipImage | undefined = isDrawing(index, session.batch())
      ? { status: "loading" }
      : readGeneratorValue<Record<number, ChipImage>>("chipImages", {})[index];
    const action = chipImageAction(image);
    applyThemeSuggestion(appearance, suggestion, {
      deferImageTuning: withImage || action !== "draw",
    });
    setLookName(suggestion.name);
    session.select(index);
    setSelectedIndex(index);
    setImageFailure(null);
    if (action === "draw" && !withImage && appearance.chatBackgroundPath) {
      appearance
        .onClearChatBackground()
        .catch((error: unknown) => setImageFailure(themeSuggestionFailureDetail(error)));
    }
  };

  const random = () => {
    const next = randomThemeSuggestions();
    resetChips();
    writeGeneratorValue("suggestionPrompt", "", "");
    setSuggestions(next);
    const first = next[0];
    if (first) choose(first, 0);
  };

  const startGenerate = (params: ThemeSuggestionParams) => {
    generate(params).catch((error: unknown) =>
      setImageFailure(themeSuggestionFailureDetail(error)),
    );
  };

  const submit = () => {
    if (!trimmed || !available) return;
    startGenerate({
      prompt: trimmed,
      harness: choice.harness,
      model: choice.model,
      modelSettings: choice.modelSettings,
      providerAccountId: choice.providerAccountId,
    });
  };

  const rollPrompt = () => setPrompt(randomThemePrompt(prompt));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !isImeComposition(event.nativeEvent)) submit();
  };

  const batch = session.batch();
  const previewCandidate = preview?.candidate?.batch === batch ? preview?.candidate : undefined;
  const applying = applyingImage !== null || appearance.chatBackgroundBusy;
  const currentImageIds = new Set(
    Object.values(chipImages).flatMap((image) => (image.status === "done" ? [image.image.id] : [])),
  );

  return (
    <div className="theme-generator">
      <div className="theme-generator-compose">
        <div className="theme-generator-prompt">
          <TextField
            fieldClassName="theme-generator-input"
            label={t("Describe a theme")}
            value={prompt}
            placeholder={t("For example “midnight ocean” or “warm kiln”")}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onKeyDown}
            endAdornment={
              <Button
                iconOnly
                label={t("Random prompt")}
                size="sm"
                variant="ghost"
                onClick={rollPrompt}
              >
                <Dices />
              </Button>
            }
          />
        </div>
        <div className="theme-generator-bar">
          <div className="theme-generator-config">
            <AppearanceModelPicker />
            <ImageProviderButton
              value={withImage ? imageProvider : "none"}
              onChange={(value) => {
                if (value === "none") session.invalidateImageIntent();
                setWithImage(value !== "none");
                if (value !== "none") setImageProvider(value);
              }}
            />
            <DesignStudioButton
              appearance={appearance}
              kind="image"
              label={t("Create background")}
            />
            <DesignStudioButton appearance={appearance} label={t("Saved designs")} />
          </div>
          <Button
            variant="primary"
            tone="accent"
            size="sm"
            loading={busy}
            disabled={!trimmed || !available || busy}
            disabledReason={
              available
                ? undefined
                : t("Choose a model that supports text actions to generate a theme.")
            }
            startIcon={<Sparkles />}
            onClick={submit}
          >
            {t("Generate themes")}
          </Button>
        </div>
      </div>
      <Divider />
      <div className="theme-generator-looks-head">
        <Text weight="medium">{t("Looks")}</Text>
        <Button
          size="sm"
          startIcon={<Dices />}
          tooltip={t("Roll six random looks without a model")}
          onClick={random}
        >
          {t("Shuffle looks")}
        </Button>
      </div>
      {suggestions.length === 0 ? (
        <Text size="secondary" tone="secondary">
          {t("Shuffle for six random looks, or describe one above and generate.")}
        </Text>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="theme-suggestions" role="group" aria-label={t("Suggested themes")}>
          {suggestions.map((suggestion, index) => {
            const [canvas, surface, line, accent] = suggestionSwatches(suggestion);
            const image = chipImages[index];
            const drawing = isDrawing(index, batch, jobs);
            const inUse = image?.status === "done" && currentImageId === image.image.id;
            const areas = suggestionAreas(suggestion).map(areaLabel);

            return (
              <div
                key={`${suggestion.name}-${index}`}
                className="theme-suggestion-card"
                role="group"
                aria-label={suggestion.name}
              >
                <div className="theme-suggestion-heading">
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
                    <Text truncate>{suggestion.name}</Text>
                  </Button>
                  {image?.status === "done" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="theme-suggestion-preview"
                      aria-label={t("Preview {p0}", { p0: suggestion.name })}
                      onClick={() => {
                        setImageFailure(null);
                        setPreview({
                          image: image.image,
                          name: suggestion.name,
                          candidate: { suggestion, index, batch },
                        });
                      }}
                    >
                      {t("Preview")}
                    </Button>
                  ) : null}
                </div>
                {image?.status === "done" ? (
                  <img
                    className="theme-suggestion-image"
                    src={libraryImageSrc(image.image)}
                    alt=""
                    decoding="async"
                    draggable={false}
                  />
                ) : null}
                {image?.status === "done" ? (
                  <div className="theme-suggestion-image-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={drawing}
                      disabledReason={t("Wait for the current operation to finish")}
                      onClick={() => startImage(suggestion, index)}
                    >
                      {t("Change image")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={applying || inUse}
                      disabledReason={
                        inUse
                          ? t("This image is already in use.")
                          : t("Wait for the current operation to finish")
                      }
                      loading={applyingImage === image.image.id}
                      onClick={() => applyCandidate(image.image, suggestion)}
                    >
                      {inUse ? t("In use") : t("Use image")}
                    </Button>
                  </div>
                ) : withImage ? (
                  <div className="theme-suggestion-image-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={drawing}
                      disabledReason={t("Wait for the current operation to finish")}
                      onClick={() => startImage(suggestion, index)}
                    >
                      {t("Generate image")}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {imageFailure !== null ? (
        <SettingsFeedback
          state="error"
          onDismiss={() => setImageFailure(null)}
          extra={
            imageFailure ? (
              <ErrorDetails title={t("Could not use the generated image.")} detail={imageFailure} />
            ) : undefined
          }
        >
          {t("Could not use the generated image.")}
        </SettingsFeedback>
      ) : null}
      {suggestions.length > 0 && jobs.length > 0 ? <Divider /> : null}
      <ThemeGenerationActivity
        jobs={jobs}
        currentImageIds={currentImageIds}
        onPreview={(image, job) => {
          const suggestion = job.batch === batch ? suggestions[job.index] : undefined;
          setImageFailure(null);
          setPreview({
            image,
            name: job.name,
            candidate: suggestion ? { suggestion, index: job.index, batch } : undefined,
          });
        }}
      />
      {preview ? (
        <ImageLightbox
          src={libraryImageSrc(preview.image)}
          alt={preview.name}
          notice={imageFailure ?? undefined}
          onClose={() => setPreview(null)}
          actions={
            previewCandidate ? (
              <>
                <MediaToolbarButton
                  label={t("Change image")}
                  disabled={isDrawing(previewCandidate.index, batch, jobs)}
                  onClick={() => {
                    startImage(previewCandidate.suggestion, previewCandidate.index);
                    setPreview(null);
                  }}
                >
                  <RefreshCw className="icon-sm" />
                </MediaToolbarButton>
                <MediaToolbarButton
                  label={currentImageId === preview.image.id ? t("In use") : t("Use image")}
                  disabled={applying || currentImageId === preview.image.id}
                  loading={applyingImage === preview.image.id}
                  onClick={() => applyCandidate(preview.image, previewCandidate.suggestion)}
                >
                  <Check className="icon-sm" />
                </MediaToolbarButton>
              </>
            ) : undefined
          }
        />
      ) : null}
    </div>
  );
}
