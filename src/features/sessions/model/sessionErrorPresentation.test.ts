import { expect, it } from "vitest";
import { sessionErrorPresentation } from "./sessionErrorPresentation";

it("moves the complete HTTP and JSON response behind its readable provider message", () => {
  const raw =
    'API Error: HTTP 429 {"error":{"type":"rate_limit_error","message":"Weekly usage limit reached. Choose another account."},"request_id":"req_weekly_42"}';
  expect(sessionErrorPresentation(raw)).toEqual({
    summary: "Weekly usage limit reached. Choose another account.",
    detail: raw,
  });
});

it("preserves an unknown human-readable error without replacing its meaning", () => {
  const raw = "Workspace policy changed. Select a working copy before sending.";
  expect(sessionErrorPresentation(raw)).toEqual({ summary: raw });
});

it.each([
  "HTTP 503 Service unavailable",
  '{"error":{"code":"unavailable"},"request_id":"req_42"}',
  'HTTP 500 {"error": broken JSON',
])("retains raw diagnostics without inventing a provider reason: %s", (raw) => {
  expect(sessionErrorPresentation(raw)).toEqual({ detail: raw });
});

it("retains long translated provider text and the exact raw response", () => {
  const message =
    "Aleksandra Wiśniewska-Kowalczyk çalışma alanında bu model kullanılamıyor. الحساب غير متاح 👩🏽‍💻";
  const raw = JSON.stringify({ message, request_id: "req_international" });
  expect(sessionErrorPresentation(raw)).toEqual({ summary: message, detail: raw });
});

it("does not hide ordinary text containing braces or an HTTP reference", () => {
  const raw = "The file named {draft}.md could not be saved. See HTTP documentation.";
  expect(sessionErrorPresentation(raw)).toEqual({ summary: raw });
});

it("keeps a human explanation with a valid inline JSON example visible", () => {
  const raw = 'Workspace policy requires {"permission":"read"}';
  expect(sessionErrorPresentation(raw)).toEqual({ summary: raw });
});
