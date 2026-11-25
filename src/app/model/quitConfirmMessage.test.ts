import { expect, it } from "vitest";
import { quitConfirmMessage } from "./quitConfirmMessage";

const none = { sessions: 0, shells: 0, automations: 0 };

it("keeps the chat message when the Host has no work", () => {
  expect(quitConfirmMessage({ id: 1, inFlight: 2 })).toContain("2 chats are still running");
  expect(
    quitConfirmMessage({ id: 1, inFlight: 2, desktopInFlight: 2, hostActivity: none }),
  ).toContain("2 chats are still running");
});

it("lists running Host sessions and says they stop gracefully", () => {
  const message = quitConfirmMessage({
    id: 1,
    inFlight: 7,
    desktopInFlight: 0,
    hostActivity: {
      ...none,
      sessions: 7,
      runningSessions: [
        { id: "a", title: "Fix login" },
        { id: "b", title: null },
        { id: "c", title: "C" },
        { id: "d", title: "D" },
        { id: "e", title: "E" },
      ],
    },
  });
  expect(message).toContain("7 sessions on this computer are still running.");
  expect(message).toContain("• Fix login");
  expect(message).toContain("• Untitled session");
  expect(message).toContain("and 2 more");
  expect(message).toContain("stops them gracefully");
});

it("combines chats, a single session, other tasks and an unknown state", () => {
  const message = quitConfirmMessage({
    id: 1,
    inFlight: 4,
    desktopInFlight: 1,
    hostActivity: {
      sessions: 1,
      shells: 1,
      automations: 1,
      runningSessions: [{ id: "a", title: "Deploy" }],
    },
  });
  expect(message).toContain("1 chat is still running");
  expect(message).toContain("1 session on this computer is still running.");
  expect(message).toContain("• Deploy");
  expect(message).toContain("2 other tasks on this computer are running.");
  expect(
    quitConfirmMessage({
      id: 1,
      inFlight: 1,
      desktopInFlight: 0,
      hostActivity: { ...none, unknown: true },
    }),
  ).toContain("Could not check what is running");
});
