import { expect, it, vi } from "vitest";
import type { SocialAccount, SocialHttp, SocialJob } from "../adapter";
import { sendInstagramMessage } from "./instagram-messaging";

const endpoint = "https://graph.instagram.com/v27.0";
const account = { platformId: "100" } as SocialAccount;
const draft = (payload: Partial<SocialJob["payload"]>) =>
  ({
    kind: "reply",
    payload: { text: "", media: [], ...payload },
  }) as SocialJob;

function fixture() {
  const json = vi.fn().mockResolvedValue({ value: { message_id: "message-1" } });
  return { json, http: { json } as unknown as SocialHttp };
}

it("uses the reviewed comment ID as the recipient after the dispatch gate", async () => {
  const { json, http } = fixture();
  const beforeSubmit = vi.fn(async () => {
    expect(json).not.toHaveBeenCalled();
  });
  const job = draft({
    text: "Private response",
    instagramPrivateReply: { commentId: "200", until: Date.now() + 60_000 },
  });
  await expect(
    sendInstagramMessage(http, endpoint, account, job, "credential", beforeSubmit),
  ).resolves.toEqual({ platformId: "message-1" });
  expect(beforeSubmit).toHaveBeenCalledOnce();
  expect(json).toHaveBeenCalledWith(`${endpoint}/100/messages`, "credential", {
    recipient: { comment_id: "200" },
    message: { text: "Private response" },
  });
});

it("sends an attachment in an eligible DM and stops before HTTP when the gate denies it", async () => {
  const { json, http } = fixture();
  const job = draft({
    media: [{ kind: "image", url: "https://media.example/image.jpg" }],
    recipientId: "200",
    replyUntil: Date.now() + 60_000,
  });
  const beforeSubmit = vi.fn().mockRejectedValueOnce(new Error("suppressed"));
  await expect(
    sendInstagramMessage(http, endpoint, account, job, "credential", beforeSubmit),
  ).rejects.toThrow("suppressed");
  expect(json).not.toHaveBeenCalled();
  await sendInstagramMessage(http, endpoint, account, job, "credential");
  expect(json).toHaveBeenCalledWith(`${endpoint}/100/messages`, "credential", {
    recipient: { id: "200" },
    message: { attachment: { type: "image", payload: { url: "https://media.example/image.jpg" } } },
  });
});

it("rejects an expired window or an attachment URL containing credentials without dispatch", async () => {
  const { json, http } = fixture();
  const expired = draft({ recipientId: "200", replyUntil: Date.now() - 1000 });
  await expect(
    sendInstagramMessage(http, endpoint, account, expired, "credential"),
  ).rejects.toMatchObject({ detail: { reasonCode: "meta.window_closed" } });
  const invalid = draft({
    recipientId: "200",
    replyUntil: Date.now() + 60_000,
    media: [{ kind: "image", url: "https://user:secret@media.example/image.jpg" }],
  });
  await expect(
    sendInstagramMessage(http, endpoint, account, invalid, "credential"),
  ).rejects.toMatchObject({ code: "unsupported" });
  expect(json).not.toHaveBeenCalled();
});
