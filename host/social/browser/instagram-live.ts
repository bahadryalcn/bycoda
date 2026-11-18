import type { InstagramLiveState } from "../../../src/features/social/model/instagramLive";
import { SocialPlatformError } from "../../../src/integrations/social/adapter";
import type { SecretValueStore } from "../../secrets/secret-store";
import type { BrowserPage } from "../social-browser";

export const instagramStreamRef = (accountId: string) => `instagram-live:${accountId}`;

const control = '[data-bycoda-instagram-live-control="true"]';
const labels = {
  url: ["Stream URL", "Yayın URL’si", "Yayın URL'si"],
  key: ["Stream key", "Yayın anahtarı"],
  start: ["Go live", "Canlı yayına geç", "Canlı yayın başlat"],
  end: ["End live video", "End live", "Canlı yayını bitir"],
};

function producerProbe(operation: "status" | "capture" | "start" | "end" | "confirm-end") {
  return `(() => {
    if (location.origin !== 'https://www.instagram.com') return;
    const labels = ${JSON.stringify(labels)};
    const operation = ${JSON.stringify(operation)};
    const visible = (el) => !!el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true';
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
    const named = (items, names) => items.filter((el) => visible(el) && names.some((label) => name(el) === label.toLowerCase()));
    const fields = [...document.querySelectorAll('input,textarea')].filter(visible);
    const field = (names) => fields.filter((el) => {
      const references = (el.getAttribute('aria-labelledby') || '').trim().split(/\\s+/);
      const namesOfField = [
        el.getAttribute('aria-label'),
        ...[...el.labels || []].map(label => label.textContent),
        ...references.map(id => document.getElementById(id)?.textContent),
      ];
      return namesOfField.some((value) => names.some((candidate) => value?.trim().toLowerCase() === candidate.toLowerCase()));
    });
    const url = field(labels.url);
    const key = field(labels.key);
    const buttons = [...document.querySelectorAll('button,[role="button"]')];
    const starts = named(buttons, labels.start);
    const ends = named(buttons, labels.end);
    const isProducer = (url.length === 1 && key.length === 1) ||
      named([...document.querySelectorAll('h1,h2,[role="heading"]')], ['Live Producer','Canlı Yayın Yapımcısı']).length === 1;
    if (!isProducer) return;
    if (operation === 'capture') return url.length === 1 && key.length === 1
      ? { url: url[0].value, key: key[0].value }
      : undefined;
    const enabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    if (operation === 'status') return {
      state: ends.length === 1 && starts.length === 0 ? 'live' : starts.length === 1 && ends.length === 0 ? 'awaiting_stream' : 'producer',
      canStart: starts.length === 1 && ends.length === 0 && enabled(starts[0]),
    };
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    let target;
    if (operation === 'confirm-end') {
      if (dialogs.length !== 1) return;
      const choices = named([...dialogs[0].querySelectorAll('button,[role="button"]')], labels.end);
      if (choices.length === 1) target = choices[0];
    } else {
      if (dialogs.some((dialog) => !dialog.contains(operation === 'start' ? starts[0] : ends[0]))) return;
      if (operation === 'start' && starts.length === 1 && ends.length === 0) target = starts[0];
      if (operation === 'end' && ends.length === 1 && starts.length === 0) target = ends[0];
    }
    if (!target || !enabled(target)) return;
    document.querySelectorAll(${JSON.stringify(control)}).forEach(el => el.removeAttribute('data-bycoda-instagram-live-control'));
    target.setAttribute('data-bycoda-instagram-live-control', 'true');
    return true;
  })()`;
}

function streamCredentials(value: unknown) {
  if (!value || typeof value !== "object") throw new SocialPlatformError("unsupported");
  const { url, key } = value as { url: unknown; key: unknown };
  if (
    typeof url !== "string" ||
    url.length > 500 ||
    typeof key !== "string" ||
    key.length < 10 ||
    key.length > 4096 ||
    /[^\x21-\x7e]/.test(key)
  )
    throw new SocialPlatformError("unsupported");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SocialPlatformError("unsupported");
  }
  if (
    parsed.protocol !== "rtmps:" ||
    parsed.hostname !== "live-upload.instagram.com" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.port && parsed.port !== "443") ||
    !/^\/rtmp\/?$/.test(parsed.pathname)
  )
    throw new SocialPlatformError("unsupported");
  return { url, key };
}

type ProducerStatus = Pick<InstagramLiveState, "state" | "canStart">;

export async function instagramLiveActor(page: BrowserPage): Promise<string | undefined> {
  if (!(await page.evaluate<ProducerStatus | undefined>(producerProbe("status")))) return;
  const cookies = await page.cookies(["https://www.instagram.com"]);
  const actors = cookies.filter((cookie) => cookie.name === "ds_user_id");
  const sessions = cookies.filter((cookie) => cookie.name === "sessionid" && cookie.value);
  if (actors.length === 1 && sessions.length === 1 && /^\d{1,30}$/.test(actors[0].value))
    return actors[0].value;
}

export class InstagramLiveProducer {
  private expected?: "live" | "offline";

  constructor(
    private readonly page: BrowserPage,
    private readonly verify: () => Promise<void>,
    private readonly vault: SecretValueStore,
    private readonly accountId: string,
    private readonly platformId: string,
    private readonly epoch: string | undefined,
  ) {}

  private async status(): Promise<ProducerStatus> {
    return (
      (await this.page.evaluate<ProducerStatus | undefined>(producerProbe("status"))) ?? {
        state: "producer",
        canStart: false,
      }
    );
  }

  async read(): Promise<ProducerStatus> {
    await this.verify();
    const current = await this.status();
    if (this.expected === "live" && current.state === "live") this.expected = undefined;
    // Reconcile a completed end only from a producer with the LIVE control gone.
    if (this.expected === "offline" && current.state === "awaiting_stream")
      this.expected = undefined;
    return this.expected ? { state: "unknown", canStart: false } : current;
  }

  async capture(): Promise<void> {
    await this.verify();
    if (this.expected) throw new SocialPlatformError("unknown");
    let values: ReturnType<typeof streamCredentials>;
    try {
      values = streamCredentials(await this.page.evaluate(producerProbe("capture")));
    } catch {
      // Neither raw CDP errors nor malformed values cross the secret-handling boundary.
      throw new SocialPlatformError("unsupported");
    }
    await this.verify();
    try {
      await this.vault.set(
        instagramStreamRef(this.accountId),
        JSON.stringify({
          ...values,
          platformId: this.platformId,
          epoch: this.epoch,
        }),
      );
    } catch {
      throw new Error("Instagram stream credential store unavailable.");
    }
  }

  async control(action: "start" | "end", beforeSubmit: () => Promise<void>): Promise<void> {
    const current = await this.read();
    if ((action === "start" && !current.canStart) || (action === "end" && current.state !== "live"))
      throw new SocialPlatformError(current.state === "unknown" ? "unknown" : "unsupported");
    if (!(await this.page.evaluate<boolean>(producerProbe(action))))
      throw new SocialPlatformError("unsupported");
    await this.verify();
    await beforeSubmit();
    this.expected = action === "start" ? "live" : "offline";
    try {
      await this.page.click(control);
      if (action === "end" && (await this.page.evaluate<boolean>(producerProbe("confirm-end")))) {
        await this.verify();
        await beforeSubmit();
        await this.page.click(control);
      }
    } catch {
      throw new SocialPlatformError("unknown");
    }
  }
}

export async function instagramStreamStored(
  vault: SecretValueStore,
  accountId: string,
  platformId: string,
  epoch: string | undefined,
): Promise<boolean> {
  try {
    const value = await vault.get(instagramStreamRef(accountId));
    if (!value) return false;
    const record = JSON.parse(value) as { platformId?: string; epoch?: string };
    return record.platformId === platformId && record.epoch === epoch;
  } catch {
    throw new Error("Instagram stream credential store unavailable.");
  }
}

/** Authorized encoder handoff only. The capture and read share the identity and URL checks. */
export async function loadInstagramLiveIngest(
  vault: SecretValueStore,
  accountId: string,
  platformId: string,
  epoch: string | undefined,
) {
  const raw = await vault.get(instagramStreamRef(accountId));
  if (!raw) return undefined;
  const record = JSON.parse(raw) as { platformId?: string; epoch?: string };
  if (record.platformId !== platformId || record.epoch !== epoch) return undefined;
  return streamCredentials(record);
}
