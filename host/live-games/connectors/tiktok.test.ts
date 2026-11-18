import { TikTokLiveConnection } from "tiktok-live-connector";
import { expect, it } from "vitest";
import { restrictTikTokCookies } from "./tiktok";

it("keeps TikTok guest cookies out of the signing SDK while retaining the anonymous WebSocket jar", async () => {
  const { cookieJar } = new TikTokLiveConnection("demo", {}).webClient;
  restrictTikTokCookies(cookieJar);
  await cookieJar.setCookie("ttwid=guest");
  await cookieJar.setCookie("sessionid=unknown");
  await cookieJar.setCookie("tt-target-idc=region");
  expect(await cookieJar.getCookieString()).toBe("");
  expect(await cookieJar.getCookieString("https://api.eulerstream.com")).toBe("");
  expect(await cookieJar.getCookieString("https://www.tiktok.com.attacker.test")).toBe("");
  expect(await cookieJar.getCookieString("https://www.tiktok.com/live")).toBe("ttwid=guest");
  expect(await cookieJar.getSessionBundle()).toBeNull();
  expect(await cookieJar.getAnonymousCookieString()).toBe("ttwid=guest");
});
