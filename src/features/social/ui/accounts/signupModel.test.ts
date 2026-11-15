import { describe, expect, it } from "vitest";
import type { SocialBrowserWorkflow } from "../../model/socialBrowser";
import {
  canCreateAccount,
  isSignupLive,
  latestSignup,
  missingFields,
  registrationProfile,
  signupProblem,
} from "./signupModel";

const workflow = (patch: Partial<SocialBrowserWorkflow>): SocialBrowserWorkflow => ({
  id: "w1",
  accountId: "a1",
  platform: "reddit",
  intent: "signup",
  status: "awaiting_owner",
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 9,
  outcome: "unverified",
  ...patch,
});

describe("signup availability", () => {
  it("is offered for browser accounts on platforms the Host can drive", () => {
    expect(canCreateAccount("reddit", "browser")).toBe(true);
    expect(canCreateAccount("linkedin", "browser")).toBe(true);
    expect(canCreateAccount("x", "browser")).toBe(true);
    expect(canCreateAccount("linkedin", "api")).toBe(false);
  });

  it("is not offered where the Host has no signup contract", () => {
    expect(canCreateAccount("snapchat", "browser")).toBe(false);
    expect(canCreateAccount("telegram", "browser")).toBe(false);
  });
});

describe("registration profile", () => {
  it("sends the account kind and only entered, valid, non-secret fields", () => {
    expect(
      registrationProfile("member", {
        email: " a@b.co ",
        username: "bad name",
        givenName: "",
        password: "x",
      } as never),
    ).toEqual({ accountKind: "person", email: "a@b.co" });
  });

  it("treats pages, channels and organizations as brand registrations", () => {
    expect(registrationProfile("page", {}).accountKind).toBe("brand");
    expect(registrationProfile("organization", {}).accountKind).toBe("brand");
    expect(registrationProfile("member", {}).accountKind).toBe("person");
  });

  it("lists required fields that are empty or invalid, in display order", () => {
    expect(
      missingFields(["username", "email", "givenName"], { email: "nope", givenName: "Ada" }),
    ).toEqual(["email", "username"]);
  });
});

describe("signup workflow state", () => {
  it("picks the newest signup workflow of the account", () => {
    const state = {
      available: true,
      reason: "",
      workflows: [
        workflow({ id: "old", createdAt: 1 }),
        workflow({ id: "new", createdAt: 5 }),
        workflow({ id: "login", createdAt: 9, intent: "login" }),
        workflow({ id: "other", createdAt: 9, accountId: "a2" }),
      ],
    };
    expect(latestSignup(state, "a1")?.id).toBe("new");
    expect(latestSignup({ ...state, workflows: [] }, "a1")).toBeUndefined();
  });

  it("polls only while the Host drives the window", () => {
    expect(isSignupLive(workflow({ status: "queued" }))).toBe(true);
    expect(isSignupLive(workflow({ status: "awaiting_owner" }))).toBe(true);
    expect(isSignupLive(workflow({ status: "window_closed" }))).toBe(false);
    expect(isSignupLive(undefined)).toBe(false);
  });

  it("explains states the owner cannot advance from", () => {
    expect(signupProblem(workflow({ status: "expired" }))).toBeTruthy();
    expect(signupProblem(workflow({ status: "interrupted" }))).toBeTruthy();
    expect(signupProblem(workflow({ status: "failed", error: "Window crashed." }))).toBe(
      "Window crashed.",
    );
    expect(signupProblem(workflow({ status: "window_closed" }))).toBeUndefined();
    expect(
      signupProblem(
        workflow({
          registration: {
            status: "unsupported",
            step: "unknown",
            blockers: [],
            requiredFields: [],
            filledFields: [],
            canAdvance: false,
            message: "",
          },
        }),
      ),
    ).toBeTruthy();
  });
});
