import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SocialAccount } from "../../src/features/social/model/social";
import { sessionWorkCwd } from "../../src/features/sessions/model/session";
import { SocialPlatformError } from "../../src/integrations/social/adapter";
import { createSocialAdapters } from "../../src/integrations/social/platformAdapters";
import { ConversationDesktopControlTools } from "../conversation/conversation-desktop-control-tools";
import { ConversationDesktopRelay } from "../conversation/conversation-tools";
import { readDesktopPresenceWithVoice } from "../desktop/desktop-voice-activity";
import { desktopReviewSecret } from "../desktop/reviewed-desktop-scope";
import { RuntimeLogAccess } from "../execution/runtime-log-tools";
import { resolveHostWorktreeAsync } from "../git/git-worktrees";
import { createSessionAuthorityResolver } from "../sessions/session-authority";
import { SocialService } from "../social/social";
import { socialAgentGenerator } from "../social/social-agent";
import { BrowserSendLimiter, type BrowserLimiterStore } from "../social/browser/limiter";
import { readBrowserSettings } from "../social/browser-layers/browser-settings";
import { BrowserLayerDriver } from "../social/browser-layers/driver";
import { RecipeHealing } from "../social/browser-layers/healing";
import { NeedsHumanQueue } from "../social/browser-layers/needs-human";
import { BrowserTracker, type BrowserWiring } from "../social/browser-layers/wiring";
import { XBrowserSessions } from "../social/social-browser-x";
import { OsSocialCredentials } from "../social/social-credentials";
import { SocialPeers } from "../social/social-peers";
import { SocialTransport } from "../social/social-transport";
import type { ServerBindings } from "./bindings";
export async function createSocialRuntime(
  dependencies: Pick<
    ServerBindings,
    | "featureDirectory"
    | "socialOverride"
    | "engine"
    | "featureSession"
    | "desktop"
    | "providers"
    | "assistant"
    | "desktopControl"
    | "featureMeta"
    | "decisionModels"
  >,
  publish: (runtime: Awaited<ReturnType<typeof createSocialRuntime>>) => void,
) {
  publish({
    get xBrowser() {
      return xBrowser;
    },
    get social() {
      return social;
    },
    get runtimeLogAccess() {
      return runtimeLogAccess;
    },
    get conversationAccess() {
      return conversationAccess;
    },
    get conversationDesktop() {
      return conversationDesktop;
    },
    get conversationDesktopControl() {
      return conversationDesktopControl;
    },
    get desktopSigningKey() {
      return desktopSigningKey;
    },
    set desktopSigningKey(value: typeof desktopSigningKey) {
      desktopSigningKey = value;
    },
    get desktopSigningSecret() {
      return desktopSigningSecret;
    },
    get scopedDesktopCall() {
      return scopedDesktopCall;
    },
    get socialTransport() {
      return socialTransport;
    },
    get socialPeers() {
      return socialPeers;
    },
  });

  // Send pacing persists in the audience store; Social is built below, so read it lazily.
  const pacingStore: BrowserLimiterStore = {
    getCounter: (...args) => social.audience.getCounter(...args),
    incrementCounter: (...args) => social.audience.incrementCounter(...args),
    getSetting: (...args) => social.audience.getSetting(...args),
    putSetting: (...args) => social.audience.putSetting(...args),
  };
  // Layers are attached after Social exists; the wiring object is shared by reference until then.
  const browserTracker = new BrowserTracker();
  const browserWiring: BrowserWiring = {
    tracker: browserTracker,
    visibility: async (accountId) =>
      (await readBrowserSettings(social.audience, accountId)).visibility,
  };
  // Undefined arguments keep the XBrowserSessions defaults; the limiter and wiring are the last two.
  const xBrowser = new XBrowserSessions(
    join(dependencies.featureDirectory, "social"),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new BrowserSendLimiter({ store: pacingStore }),
    browserWiring,
  );
  const social =
    dependencies.socialOverride ??
    new SocialService(
      dependencies.engine.store,
      new OsSocialCredentials(
        join(dependencies.featureDirectory, "social", "credentials"),
        dependencies.engine.store.environmentId,
      ),
      createSocialAdapters(
        undefined,
        process.env.BYCODA_SOCIAL_GRAPH_VERSION,
        process.env.BYCODA_SOCIAL_LINKEDIN_VERSION,
      ),
      join(dependencies.featureDirectory, "social"),
      dependencies.featureSession,
      Date.now,
      socialAgentGenerator(join(dependencies.featureDirectory, "social")),
      xBrowser.adapter(),
      undefined,
      dependencies.decisionModels,
    );
  await social.ready;
  social.setSessionAuthorityResolver(
    createSessionAuthorityResolver(
      dependencies.engine.store,
      dependencies.desktop,
      dependencies.providers,
    ),
  );
  social.setAssistantThreadResolver((id) => dependencies.assistant.threadBinding(id));
  const socialDirectory = join(dependencies.featureDirectory, "social");
  const needsHuman = new NeedsHumanQueue(social.audience, Date.now, randomUUID);
  browserWiring.layers = new BrowserLayerDriver({
    platformOf: async (accountId) => {
      const account = (await social.list<SocialAccount>("account")).find(
        (item) => item.id === accountId,
      );
      if (!account) throw new Error("Social account is unknown.");
      return account.platform;
    },
    page: async (accountId) => browserTracker.page(accountId),
    settings: (accountId) => readBrowserSettings(social.audience, accountId),
    presence: async (computerId) =>
      computerId === dependencies.engine.store.environmentId
        ? await readDesktopPresenceWithVoice()
        : undefined,
    // shortcut: no owner-active computer signal is wired yet; the desktop layer has no adapter, so it cannot run.
    ownerActiveComputerId: async () => undefined,
    // Layers run inside an operation the owner or an approved job already started; the stops still apply.
    allowLayer: async () => {
      if (
        (await social.audience.getSetting("ai.stopped")) === "true" ||
        (await social.audience.getSetting("stopped")) === "true"
      )
        throw new SocialPlatformError("denied");
    },
    decisions: dependencies.decisionModels,
    healing: new RecipeHealing(social.audience, Date.now, randomUUID),
    needsHuman,
    directory: socialDirectory,
    // shortcut: layer audit rows have no Social reader yet; the driver keeps fixed reason codes only.
    audit: () => undefined,
  });
  social.forgetBrowserSession ??= async (accountId) => {
    await xBrowser.workflows.cancelAccount(social, accountId);
    await xBrowser.forget(accountId);
  };
  social.cancelBrowserWorkflow ??= async (accountId) =>
    await xBrowser.workflows.cancelAccount(social, accountId);
  const runtimeLogAccess = new RuntimeLogAccess(social, Date.now, (id) =>
    dependencies.assistant.threadBinding(id),
  );
  const conversationAccess = new RuntimeLogAccess(social, Date.now, (id) =>
    dependencies.assistant.threadBinding(id),
  );
  const conversationDesktop = new ConversationDesktopRelay(dependencies.engine.store.environmentId);
  const conversationDesktopControl = new ConversationDesktopControlTools({
    environmentId: dependencies.engine.store.environmentId,
    desktop: dependencies.desktopControl,
    presence: async () => {
      const native = await readDesktopPresenceWithVoice();
      const manual = await dependencies.assistant.ownerPresence();
      if (manual.state === "dnd")
        throw new Error("Desktop input is deferred while Do not disturb is active.");
      return {
        supported: native.supported,
        locked: native.locked,
        ownerPresent:
          native.idleMs === undefined
            ? undefined
            : manual.state === "away" || native.locked || native.idleMs >= 10 * 60000
              ? false
              : true,
      };
    },
    approveOperation: ({ operation, operationHash, cwd, principal }, authorized) =>
      conversationDesktop.call(
        "desktop.act.authorize",
        { operation, operationHash },
        cwd,
        principal,
        authorized,
      ),
  });
  let desktopSigningKey: string | undefined;
  const desktopSigningSecret = async () =>
    (desktopSigningKey ??= await desktopReviewSecret(dependencies.engine.store));
  const scopedDesktopCall = async (
    token: string,
    action: string,
    params: Record<string, unknown>,
    fields: readonly string[],
    trusted: Readonly<Record<string, unknown>> = {},
  ) => {
    const allowed = ["projectId", "sessionId", ...fields];
    if (
      Object.keys(params).some((key) => !allowed.includes(key)) ||
      typeof params.sessionId !== "string" ||
      typeof params.projectId !== "string"
    )
      throw new Error("Invalid desktop feature identity");
    // Identity and folder only: a metadata read, not the transcript (twice per call).
    const target = await dependencies.featureMeta(params.sessionId);
    const project = await dependencies.engine.store.project(params.projectId);
    if (target.projectId !== project.id)
      throw new Error("Desktop feature belongs to another project");
    const sourceCwd = sessionWorkCwd(target.session);
    const cwd = await resolveHostWorktreeAsync(project.cwd, sourceCwd);
    const { projectId: _projectId, ...request } = params;
    return await conversationDesktop.call(
      action,
      { ...request, ...trusted },
      cwd,
      {
        kind: "session",
        sessionId: target.session.id,
        projectId: project.id,
        provider: target.session.harness,
      },
      async () => {
        try {
          // A fresh read of exactly the fields compared below (never the stable cache).
          const current = await dependencies.featureMeta(target.session.id);
          return (
            (await dependencies.engine.store.authenticated(token)) &&
            current.projectId === project.id &&
            dependencies.desktop.samePath(sessionWorkCwd(current.session), sourceCwd)
          );
        } catch {
          return false;
        }
      },
    );
  };
  const socialTransport = new SocialTransport(social, xBrowser);
  const socialPeers = new SocialPeers(
    social,
    new OsSocialCredentials(
      join(dependencies.featureDirectory, "social", "peer-credentials"),
      dependencies.engine.store.environmentId,
    ),
  );
  return {
    xBrowser,
    social,
    runtimeLogAccess,
    conversationAccess,
    conversationDesktop,
    conversationDesktopControl,
    get desktopSigningKey() {
      return desktopSigningKey;
    },
    set desktopSigningKey(value: typeof desktopSigningKey) {
      desktopSigningKey = value;
    },
    desktopSigningSecret,
    scopedDesktopCall,
    socialTransport,
    socialPeers,
  };
}
