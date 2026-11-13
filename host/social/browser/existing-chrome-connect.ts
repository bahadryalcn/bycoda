import type { SocialAccount } from "../../../src/features/social/model/social";
import { browserOperations } from "../../../src/integrations/social/browserCapabilities";
import { X_BROWSER_SCOPES } from "../../../src/integrations/social/capabilities";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import { challengeError, detectChallenge } from "./challenge";
import type { SocialPrincipal, SocialService } from "../social";
import type { BrowserRecipe, BrowserIdentity } from "../social-browser-recipe";
import { xUserId } from "../social-browser-x-page";
import type { ExistingChromeBindings } from "./existing-chrome-bindings";

/** Verify inside an owned temporary tab; preserve the owner's selected tab and login data. */
export async function connectExistingChrome(input: {
  service: SocialService;
  principal: SocialPrincipal;
  account: SocialAccount;
  targetId: string;
  resourceId?: string;
  bindings: ExistingChromeBindings;
  recipes: readonly BrowserRecipe[];
  directory: string;
  wait(ms: number): Promise<unknown>;
  review?: { epoch: string | undefined; current(): boolean };
}) {
  const { service, principal, account, bindings, recipes } = input;
  const epoch = input.review
    ? input.review.epoch
    : await service.connectionReviewEpoch(principal, account.id);
  const current = () => !input.review || input.review.current();
  const validate = async () => {
    if (!current() || epoch !== (await service.connectionReviewEpoch(principal, account.id)))
      throw new Error("The account connection was cancelled. Select the Chrome tab again.");
    const latest = await service.accountForOAuth(principal, account.id);
    if (
      !current() ||
      latest.executorId !== service.store.environmentId ||
      latest.executorId !== account.executorId ||
      latest.connection !== account.connection ||
      latest.platform !== account.platform ||
      latest.platformId !== account.platformId
    )
      throw new Error("The account changed. Select the Chrome tab again.");
  };
  await validate();
  if (account.connection !== "browser")
    throw new Error("Choose a browser account to use an existing Chrome session.");
  const recipe = recipes.find((item) => item.platform === account.platform);
  if (account.platform !== "x" && (!recipe || !recipe.operations.length))
    throw new SocialPlatformError("unsupported");
  const destination =
    account.platform === "x"
      ? "https://x.com/home"
      : (recipe!.connectionUrl?.(account, input.resourceId) ?? recipe!.loginUrl);
  const session = await bindings.openSelection({
    platform: account.platform,
    targetId: input.targetId,
  });
  let previous: Awaited<ReturnType<ExistingChromeBindings["get"]>>;
  let changed = false;
  try {
    await validate();
    await session.page.goto(destination);
    let identity: BrowserIdentity | undefined;
    for (let attempt = 0; attempt < 60; attempt++) {
      await validate();
      const challenge = await challengeError(session.page, input.directory);
      if (challenge) throw challenge;
      if (await detectChallenge(session.page)) throw new SocialPlatformError("expired");
      if (account.platform === "x") {
        const id = xUserId(await session.page.cookies());
        const href = await session.page.evaluate<string>(
          `document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") ?? ""`,
        );
        const handle = /^\/(\w{1,15})$/.exec(href)?.[1];
        if (id && handle)
          identity = { platformId: id, name: `@${handle}`, accountType: account.accountType };
      } else identity = await recipe!.identity(session.page, account);
      if (identity) break;
      await input.wait(500);
    }
    if (
      !identity?.platformId ||
      !identity.name ||
      identity.platformId.length > 300 ||
      (identity.accountType && identity.accountType !== account.accountType)
    )
      throw new Error("The selected Chrome account identity could not be verified.");
    const current = await service.accountForOAuth(principal, account.id);
    await validate();
    if (
      current.executorId !== account.executorId ||
      current.connection !== account.connection ||
      current.platform !== account.platform ||
      (current.platformId && current.platformId !== identity.platformId)
    )
      throw new Error("The selected Chrome account differs from the connected account.");
    previous = await bindings.get(account.id);
    await validate();
    await bindings.set(account.id, { platform: account.platform, targetId: input.targetId });
    changed = true;
    await validate();
    await service.connectAccount(
      account.id,
      {
        platformId: identity.platformId,
        name: identity.name,
        scopes:
          account.platform === "x"
            ? [...X_BROWSER_SCOPES]
            : browserOperations(account)
                .filter((operation) => recipe!.operations.includes(operation))
                .map((operation) => `browser:${operation}`),
        accessApproved: true,
        connection: "browser",
      },
      { accessToken: "browser-session" },
      async () => {
        await validate();
        const latest = await service.accountForOAuth(principal, account.id);
        if (
          latest.executorId !== current.executorId ||
          latest.platformId !== current.platformId ||
          latest.connection !== current.connection
        )
          throw new Error("The account changed. Select the Chrome tab again.");
      },
    );
    return { status: "connected" as const, expiresAt: 0, source: "existing-chrome" as const };
  } catch (error) {
    if (changed) {
      let restore = current();
      try {
        await validate();
      } catch {
        restore = false;
      }
      await bindings.set(account.id, restore ? previous : undefined);
    }
    throw error;
  } finally {
    await session.close();
  }
}
