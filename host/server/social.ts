import { join } from "node:path";
import { sessionWorkCwd } from "../../src/features/sessions/model/session";
import { createSocialAdapters } from "../../src/integrations/social/platformAdapters";
import { ConversationDesktopControlTools } from "../conversation/conversation-desktop-control-tools";
import { ConversationDesktopRelay } from "../conversation/conversation-tools";
import { readDesktopPresence } from "../desktop/desktop-presence";
import { desktopReviewSecret } from "../desktop/reviewed-desktop-scope";
import { RuntimeLogAccess } from "../execution/runtime-log-tools";
import { resolveHostWorktreeAsync } from "../git/git-worktrees";
import { createSessionAuthorityResolver } from "../sessions/session-authority";
import { SocialService } from "../social/social";
import { socialAgentGenerator } from "../social/social-agent";
import { XBrowserSessions } from "../social/social-browser";
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

  const xBrowser = new XBrowserSessions(join(dependencies.featureDirectory, "social"));
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
      const native = await readDesktopPresence();
      const manual = await dependencies.assistant.ownerPresence();
      if (manual.state === "dnd")
        throw new Error("Desktop input is deferred while Do not disturb is active.");
      return {
        supported: native.supported,
        locked: native.locked,
        ownerPresent:
          native.idleMs === undefined
            ? undefined
            : manual.state === "away" || native.idleMs >= 10 * 60000
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
