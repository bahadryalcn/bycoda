import type { SocialPlatform } from "../../../src/features/social/model/social";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { elapsedSince, monotonicNow } from "../../../src/shared/lib/time/timestamps";
import type { DecisionService } from "../../decision-models/decision-types";
import { captureNeedsHumanScreenshot, detectChallenge } from "../browser/challenge";
import type { BrowserPage } from "../social-browser";
import type { BrowserSettings } from "./browser-settings";
import {
  ACTABLE_STATES,
  HUMAN_STATES,
  chooseCandidate,
  classifyScreen,
  isUnsafeLabel,
  type LayerChoice,
  type ScreenState,
} from "./decision-layer";
import {
  desktopGate,
  runDesktopLayer,
  type DesktopLayerPort,
  type DesktopPresenceReading,
} from "./desktop-layer";
import type { RecipeSuggestionInput } from "./healing";
import type { NeedsHumanInput } from "./needs-human";
import { summarizeScreen, type ScreenCandidate } from "./screen-summary";
import {
  UnexpectedScreen,
  type LayerName,
  type LayerOutcome,
  type LayerStep,
  type LayeredBrowserDriver,
  type NeedsHumanKind,
} from "./types";

export type LayerAudit = LayerOutcome & {
  accountId: string;
  step: string;
  platform: SocialPlatform;
};

export type BrowserLayerDeps = {
  platformOf(accountId: string): Promise<SocialPlatform>;
  page(accountId: string): Promise<BrowserPage | undefined>;
  settings(accountId: string): Promise<BrowserSettings>;
  /** Presence of one computer; undefined when it cannot be read. */
  presence(computerId: string): Promise<DesktopPresenceReading | undefined>;
  ownerActiveComputerId(): Promise<string | undefined>;
  /** Limits, AutonomyPolicy and suppression for a layer. Throwing stops that layer and propagates. */
  allowLayer(accountId: string, layer: "decision" | "desktop"): Promise<void>;
  decisions?: DecisionService;
  desktop?: DesktopLayerPort;
  healing: { suggest(input: RecipeSuggestionInput): Promise<unknown> };
  needsHuman: { open(input: NeedsHumanInput): Promise<unknown> };
  /** Directory for needs-human screenshots (`<directory>/needs-human/<id>.jpg`). */
  directory: string;
  audit(entry: LayerAudit): void | Promise<void>;
  threshold?: number;
  now?: () => number;
};

type Settled<T> = { done?: { value: T }; human?: NeedsHumanKind };

/**
 * Runs one recipe step through the layers: recipe, decision model, desktop control, then NEEDS_HUMAN.
 * A captcha, verification or login page stops at NEEDS_HUMAN before any decision or desktop action.
 * Each layer writes one audit entry with its status and duration, never content.
 * The API layer runs in the adapter before this driver is called.
 */
export class BrowserLayerDriver implements LayeredBrowserDriver {
  private readonly clock: () => number;

  constructor(private readonly deps: BrowserLayerDeps) {
    this.clock = deps.now ?? monotonicNow;
  }

  async run<T>(accountId: string, step: LayerStep<T>): Promise<T> {
    const started = this.clock();
    try {
      const value = await step.recipe();
      await this.log(accountId, step, "recipe", "done", started);
      return value;
    } catch (error) {
      if (!(error instanceof UnexpectedScreen)) throw error;
      await this.log(accountId, step, "recipe", "unexpected_screen", started);
      return this.escalate(accountId, step, error);
    }
  }

  private async escalate<T>(
    accountId: string,
    step: LayerStep<T>,
    unexpected: UnexpectedScreen,
  ): Promise<T> {
    const url = unexpected.snapshot.url;
    const page = await this.deps.page(accountId);
    if (!page) return this.humanRequired(accountId, step, "recipe", "unexpected", url);

    // Deterministic check first. A probe failure is treated as a challenge: fail closed.
    const probe = await detectChallenge(page).then(
      (hit) => ({ hit }),
      () => undefined,
    );
    if (!probe) return this.humanRequired(accountId, step, "recipe", "unexpected", url, page);
    if (probe.hit)
      return this.humanRequired(accountId, step, "recipe", probe.hit.kind, probe.hit.url, page);

    const decision = await this.decisionLayer<T>(accountId, step, page);
    if (decision.human)
      return this.humanRequired(accountId, step, "decision", decision.human, url, page);
    if (decision.done) return decision.done.value;

    const desktop = await this.desktopLayer<T>(accountId, step);
    if (desktop.done) return desktop.done.value;

    return this.humanRequired(accountId, step, "desktop", "unexpected", url, page);
  }

  /** Classifies the screen. Only a cookie banner or confirm dialog gets one safe button click. */
  private async decisionLayer<T>(
    accountId: string,
    step: LayerStep<T>,
    page: BrowserPage,
  ): Promise<Settled<T>> {
    const started = this.clock();
    const decisions = this.deps.decisions;
    if (!decisions) {
      await this.log(accountId, step, "decision", "skipped", started, "no_model");
      return {};
    }
    await this.deps.allowLayer(accountId, "decision");

    const snapshot = await summarizeScreen(page);
    const screen = await classifyScreen(decisions, snapshot, this.deps.threshold).catch(
      (): LayerChoice<ScreenState> => ({ ok: false, reason: "unavailable" }),
    );
    if (!screen.ok) {
      await this.log(accountId, step, "decision", "failed", started, screen.reason);
      return {};
    }
    if (HUMAN_STATES.includes(screen.value)) {
      await this.log(accountId, step, "decision", "needs_human", started, screen.value);
      return { human: screen.value as NeedsHumanKind };
    }
    if (!ACTABLE_STATES.includes(screen.value)) {
      await this.log(accountId, step, "decision", "failed", started, "not_actable");
      return {};
    }

    const safe = snapshot.candidates.filter((item) => !isUnsafeLabel(item.label));
    const choice: LayerChoice<ScreenCandidate> = await chooseCandidate(
      decisions,
      safe,
      this.deps.threshold,
    ).catch((): LayerChoice<ScreenCandidate> => ({ ok: false, reason: "unavailable" }));
    if (!choice.ok) {
      await this.log(accountId, step, "decision", "failed", started, choice.reason);
      return {};
    }
    try {
      await page.click(choice.value.selector);
    } catch {
      await this.log(accountId, step, "decision", "failed", started, "click_failed");
      return {};
    }
    try {
      const value = await step.recipe();
      await this.log(accountId, step, "decision", "done", started, screen.value);
      await this.deps.healing.suggest({
        accountId,
        platform: await this.deps.platformOf(accountId),
        step: step.name,
        selector: choice.value.selector,
        source: "decision",
      });
      return { done: { value } };
    } catch (error) {
      if (!(error instanceof UnexpectedScreen)) throw error;
      await this.log(accountId, step, "decision", "failed", started, "still_unexpected");
      return {};
    }
  }

  /** Single jobs only, and only when the owner is away from the selected computer (see desktopGate). */
  private async desktopLayer<T>(accountId: string, step: LayerStep<T>): Promise<Settled<T>> {
    const started = this.clock();
    const settings = await this.deps.settings(accountId);
    const computerId = settings.desktopControl.computerId;
    const presence = computerId
      ? await this.deps.presence(computerId).catch(() => undefined)
      : undefined;
    const activeComputer = await this.deps.ownerActiveComputerId().catch(() => undefined);
    const gate = desktopGate({
      settings,
      outreach: step.outreach,
      presence,
      ...(activeComputer === undefined ? {} : { ownerActiveComputerId: activeComputer }),
    });
    if (!gate.ok) {
      await this.log(accountId, step, "desktop", "skipped", started, gate.reason);
      return {};
    }
    await this.deps.allowLayer(accountId, "desktop");
    const platform = await this.deps.platformOf(accountId);
    const outcome = await runDesktopLayer(this.deps.desktop, gate, {
      accountId,
      platform,
      step: step.name,
    });
    if (outcome.status !== "done") {
      await this.log(accountId, step, "desktop", outcome.status, started, outcome.detail);
      return {};
    }
    try {
      const value = await step.recipe();
      await this.log(accountId, step, "desktop", "done", started);
      if (outcome.selector)
        await this.deps.healing.suggest({
          accountId,
          platform,
          step: step.name,
          selector: outcome.selector,
          source: "desktop",
        });
      return { done: { value } };
    } catch (error) {
      if (!(error instanceof UnexpectedScreen)) throw error;
      await this.log(accountId, step, "desktop", "failed", started, "still_unexpected");
      return {};
    }
  }

  private async humanRequired<T>(
    accountId: string,
    step: LayerStep<T>,
    layer: LayerName,
    kind: NeedsHumanKind,
    url: string,
    page?: BrowserPage,
  ): Promise<never> {
    const started = this.clock();
    const screenshotId = page
      ? await captureNeedsHumanScreenshot(page, this.deps.directory).catch(() => undefined)
      : undefined;
    await this.deps.needsHuman.open({
      accountId,
      kind,
      url,
      ...(step.jobId === undefined ? {} : { jobId: step.jobId }),
      ...(screenshotId === undefined ? {} : { screenshotId }),
    });
    await this.log(accountId, step, layer, "needs_human", started, kind);
    throw new SocialPlatformError("needs_human", undefined, { url, screenshotId });
  }

  /** Audit never receives page text, field values or URLs. `detail` is a fixed code. */
  private async log<T>(
    accountId: string,
    step: LayerStep<T>,
    layer: LayerName,
    status: LayerOutcome["status"],
    started: number,
    detail?: string,
  ): Promise<void> {
    const durationMs = elapsedSince(started, this.clock());
    try {
      await this.deps.audit({
        accountId,
        step: step.name,
        platform: await this.deps.platformOf(accountId),
        layer,
        status,
        durationMs,
        ...(detail === undefined ? {} : { detail }),
      });
    } catch {
      // An audit write failure must not change the layer outcome.
    }
  }
}
