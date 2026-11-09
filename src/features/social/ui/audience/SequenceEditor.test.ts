// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialList } from "../../model/audience";
import { SequenceEditor } from "./SequenceEditor";
import {
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  flush,
  mountHost,
  setFieldValue,
  type ClientMock,
  type MountedHost,
} from "./audienceTestKit";

let host: MountedHost;

beforeEach(() => {
  host = mountHost();
});

afterEach(() => {
  host.unmount();
});

const buyers = {
  id: "l1",
  name: "Buyers",
  kind: "static",
  projectIds: [],
  createdAt: 1,
} as SocialList;

describe("SequenceEditor", () => {
  it("warns that an email step needs an unsubscribe link when the account has none", async () => {
    const mock: ClientMock = clientMock({
      email: {
        accounts: {
          list: vi.fn(async () => ({
            items: [{ id: "e1", kind: "smtp", from: "ops@example.com", name: "Ops", createdAt: 1 }],
          })),
        },
      },
    });
    host.render(
      createElement(SequenceEditor, {
        client: asClient(mock),
        lists: [buyers],
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    await flush();
    await flush();

    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    setFieldValue(document.querySelector("input")!, "Spring follow-up");
    setFieldValue(document.querySelectorAll("select")[0]!, "l1");
    await flush();

    setFieldValue(document.querySelectorAll("select")[1]!, "email");
    await flush();
    setFieldValue(document.querySelectorAll("select")[2]!, "e1");
    await flush();

    expect(bodyText()).toContain("Email steps need an unsubscribe link.");
  });

  it("keeps Save disabled with the missing piece named until the message has text", async () => {
    const mock: ClientMock = clientMock();
    host.render(
      createElement(SequenceEditor, {
        client: asClient(mock),
        lists: [buyers],
        onClose: vi.fn(),
        onSaved: vi.fn(),
      }),
    );
    await flush();
    setFieldValue(document.querySelector("input")!, "Follow-up");
    setFieldValue(document.querySelectorAll("select")[0]!, "l1");
    await flush();
    expect(buttonByText("Save sequence")?.disabled).toBe(true);
    expect(bodyText()).toContain("Each step needs a message");
  });
});
