import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlatformBrowserSessions } from "./social-browser-platforms";
import { BrowserTracker, type BrowserWiring } from "./browser-layers/wiring";
import {
  UnexpectedScreen,
  type LayerStep,
  type LayeredBrowserDriver,
} from "./browser-layers/types";
import type { BrowserLauncher, BrowserPage, PlainBrowserLauncher } from "./social-browser";
import type { BrowserRecipe } from "./social-browser-recipe";
import type { SocialAccount, SocialJob } from "../../src/features/social/model/social";
import type { SocialService } from "./social";
import type { CaptureSource } from "../../src/integrations/social/audience-types";
import { SocialPlatformError } from "../../src/integrations/social/adapter";

const cleanup: string[] = [];
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});

const SCREEN = {
  url: "https://www.facebook.com/composer",
  title: "Composer",
  buttons: [],
  fields: [],
  headings: [],
  errors: [],
};

/** Layers that record each step and run the recipe as-is unless a test overrides the run. */
function layers(run?: (accountId: string, step: LayerStep<unknown>) => Promise<unknown>) {
  const driver = {
    run: vi.fn(run ?? (async (_accountId: string, step: LayerStep<unknown>) => step.recipe())),
  };
  return driver as typeof driver & LayeredBrowserDriver;
}

async function fixture(
  options: { wiring?: BrowserWiring; job?: Partial<SocialJob>; plainClosesAtOnce?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "social-platform-layers-"));
  cleanup.push(directory);
  const account: SocialAccount = {
    id: "00000000-0000-4000-8000-000000000002",
    platform: "facebook",
    platformId: "web:facebook:456",
    name: "Fixture",
    accountType: "member",
    connection: "browser",
    scopes: ["browser:publish", "browser:poll"],
    connected: true,
    accessApproved: true,
    paused: false,
    executorId: "host",
    grants: {},
    createdAt: 1,
  };
  const job = {
    id: "job",
    kind: "publish",
    accountId: account.id,
    payload: { text: "Exact approved text", media: [] },
    ...options.job,
  } as unknown as SocialJob;
  const page = {
    goto: vi.fn(),
    evaluate: vi.fn(),
    click: vi.fn(),
    cookies: vi.fn(),
  } as unknown as BrowserPage;
  const close = vi.fn(async () => {});
  const launcher: BrowserLauncher = vi.fn(async () => ({
    page,
    close,
    closed: new Promise<void>(() => {}),
  }));
  const recipe: BrowserRecipe = {
    platform: "facebook",
    loginUrl: "https://www.facebook.com/",
    operations: ["publish", "poll"],
    identity: vi.fn(async () => ({
      platformId: account.platformId,
      name: account.name,
      accountType: "member" as const,
    })),
    send: vi.fn(async (context) => {
      await context.verifyIdentity();
      return { platformId: "confirmed-post" };
    }),
    poll: vi.fn(async () => ({ events: [] })),
  };
  let now = 1000;
  const locks = new Map<string, Promise<unknown>>();
  const exclusive = <T>(id: string, action: () => Promise<T>) => {
    const pending = (locks.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    locks.set(
      id,
      pending.catch(() => {}),
    );
    return pending;
  };
  const plain: PlainBrowserLauncher = vi.fn(async () => ({
    close: async () => {},
    closed: options.plainClosesAtOnce ? Promise.resolve() : new Promise<void>(() => {}),
  }));
  const manager = new PlatformBrowserSessions(
    directory,
    [recipe],
    launcher,
    plain,
    (id) => join(directory, id),
    exclusive,
    () => now,
    async () => {
      now += 500;
      await new Promise<void>((done) => setTimeout(done, 0));
    },
    true,
    undefined,
    options.wiring,
  );
  const service = {
    store: { environmentId: "host" },
    accountForOAuth: vi.fn(async () => account),
    connectAccount: vi.fn(async () => account),
  } as unknown as SocialService;
  return { manager, account, job, recipe, page, launcher, close, service };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise<void>((done) => setTimeout(done, 1));
  expect(check()).toBe(true);
}

describe("platform browser sessions with the layered driver", () => {
  it("runs the send recipe as a layer step with the job's outreach flag and id", async () => {
    // Only the send step is replaced; the identity step must still run the recipe to pass verifyIdentity.
    const wiring = {
      layers: layers(async (_accountId, step) =>
        step.name === "send" ? { platformId: "via-layer" } : step.recipe(),
      ),
    };
    const f = await fixture({ wiring });
    await expect(f.manager.adapter().send(f.account, f.job, "", vi.fn())).resolves.toEqual({
      platformId: "via-layer",
    });
    expect(wiring.layers.run).toHaveBeenCalledWith(
      f.account.id,
      expect.objectContaining({ name: "send", jobId: "job", outreach: false }),
    );
    expect(f.recipe.send).not.toHaveBeenCalled();
  });

  it("marks a campaign job as outreach so the desktop layer cannot run for it", async () => {
    const wiring = { layers: layers() };
    const f = await fixture({ wiring, job: { campaignId: "campaign-1" } as Partial<SocialJob> });
    await f.manager.adapter().send(f.account, f.job, "", vi.fn());
    expect(wiring.layers.run).toHaveBeenCalledWith(
      f.account.id,
      expect.objectContaining({ name: "send", outreach: true }),
    );
  });

  it("hands an unexpected screen before the final submit to the layers", async () => {
    // The stand-in layer repairs the step whenever the recipe reports an unexpected screen.
    const wiring = {
      layers: layers(async (_accountId, step) => {
        try {
          return await step.recipe();
        } catch (error) {
          if (error instanceof UnexpectedScreen && step.name === "send")
            return { platformId: "after-repair" };
          throw error;
        }
      }),
    };
    const f = await fixture({ wiring });
    vi.mocked(f.recipe.send).mockImplementationOnce(async () => {
      throw new UnexpectedScreen(SCREEN);
    });
    await expect(f.manager.adapter().send(f.account, f.job, "", vi.fn())).resolves.toEqual({
      platformId: "after-repair",
    });
    expect(wiring.layers.run).toHaveBeenCalledWith(
      f.account.id,
      expect.objectContaining({ name: "send" }),
    );
  });

  it("never hands an unexpected screen after the final submit to the layers; it is uncertain delivery", async () => {
    const wiring = {
      layers: layers(async (_accountId, step) => {
        try {
          return await step.recipe();
        } catch (error) {
          if (error instanceof UnexpectedScreen && step.name === "send")
            return { platformId: "BAD-REPAIR" };
          throw error;
        }
      }),
    };
    const f = await fixture({ wiring });
    vi.mocked(f.recipe.send).mockImplementationOnce(async (context) => {
      context.markSubmitted?.();
      throw new UnexpectedScreen(SCREEN);
    });
    await expect(f.manager.adapter().send(f.account, f.job, "", vi.fn())).rejects.toMatchObject({
      code: "unknown",
    });
  });

  it("keeps NEEDS_HUMAN from identity verification instead of treating it as a missing identity", async () => {
    const wiring = {
      layers: layers(async (_accountId, step) => {
        if (step.name === "identity") throw new SocialPlatformError("needs_human");
        return step.recipe();
      }),
    };
    const f = await fixture({ wiring });
    await expect(f.manager.adapter().send(f.account, f.job, "", vi.fn())).rejects.toMatchObject({
      code: "needs_human",
    });
    expect(f.recipe.send).not.toHaveBeenCalled();
  });

  it("launches with the account visibility setting", async () => {
    const f = await fixture({
      wiring: { visibility: vi.fn(async () => "visible" as const) },
    });
    await f.manager.adapter().send(f.account, f.job, "", vi.fn());
    expect(f.launcher).toHaveBeenCalledWith(expect.any(String), true, "visible");
  });

  it("defaults to a hidden window when no visibility setting is wired", async () => {
    const f = await fixture();
    await f.manager.adapter().poll(f.account, "", [], undefined);
    expect(f.launcher).toHaveBeenCalledWith(expect.any(String), true, "hidden");
  });

  it("tracks the open page for the layers only while the session is open", async () => {
    const tracker = new BrowserTracker();
    const f = await fixture({ wiring: { tracker } });
    vi.mocked(f.recipe.send).mockImplementationOnce(async (context) => {
      expect(tracker.page(f.account.id)).toBe(f.page);
      await context.verifyIdentity();
      return { platformId: "tracked" };
    });
    await f.manager.adapter().send(f.account, f.job, "", vi.fn());
    expect(tracker.page(f.account.id)).toBeUndefined();
  });

  it("delegates audience collection to the recipe reader", async () => {
    const f = await fixture();
    const person = { platformId: "p1", name: "Ayse", kind: "dm" as const, at: 1 };
    const collectAudience = vi.fn(
      async (_context: unknown, _source: CaptureSource, _cursor?: string) => ({ people: [person] }),
    );
    f.recipe.collectAudience = collectAudience;
    const source: CaptureSource = { kind: "dm_senders", accountId: f.account.id };
    await expect(
      f.manager.adapter().collectAudience!(f.account, "", source, "c1"),
    ).resolves.toEqual({
      people: [person],
    });
    expect(collectAudience).toHaveBeenCalledWith(expect.anything(), source, "c1");
  });

  it("refuses audience collection for a recipe without a reader before opening a window", async () => {
    const f = await fixture();
    const source: CaptureSource = { kind: "dm_senders", accountId: f.account.id };
    await expect(f.manager.adapter().collectAudience!(f.account, "", source)).rejects.toMatchObject(
      {
        code: "unsupported",
      },
    );
    expect(f.launcher).not.toHaveBeenCalled();
  });

  it("keeps NEEDS_HUMAN from an identity step in the login flow instead of a generic failure", async () => {
    const wiring = {
      layers: layers(async (_accountId, step) => {
        if (step.name === "identity") throw new SocialPlatformError("needs_human");
        return step.recipe();
      }),
    };
    const f = await fixture({ wiring, plainClosesAtOnce: true });
    await f.manager.begin(
      f.service,
      { kind: "owner", actorId: "owner", provider: "owner" } as never,
      f.account,
    );
    await until(() => f.manager.status(f.account.id).status !== "waiting");
    expect(f.manager.status(f.account.id)).toEqual({
      status: "failed",
      error: expect.stringContaining("verification step"),
    });
    expect(f.recipe.send).not.toHaveBeenCalled();
  });
});
