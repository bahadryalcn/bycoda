// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialScreenProps } from "../shell/screens";
import { AudienceScreen } from "./AudienceScreen";
import {
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  clickButton,
  flush,
  mountHost,
  person,
  type ClientMock,
  type MountedHost,
} from "./audienceTestKit";

let host: MountedHost;
let mock: ClientMock;
const onNavigate = vi.fn();

function render(overrides: Partial<ClientMock> = {}) {
  mock = clientMock(overrides);
  const props: SocialScreenProps = {
    client: asClient(mock),
    machineId: "m1",
    shellState: { hostOnline: true, unreachable: false, aiStopped: false },
    active: true,
    onNavigate,
  };
  host.render(createElement(AudienceScreen, props));
}

beforeEach(() => {
  host = mountHost();
  onNavigate.mockClear();
});

afterEach(() => {
  host.unmount();
});

describe("AudienceScreen empty state", () => {
  it("shows one sentence, the single Find people action and Fill with AI", async () => {
    render();
    await flush();
    await flush();
    expect(bodyText()).toContain("No people yet.");
    expect(buttonByText("Find people")).toBeTruthy();
    expect(buttonByText("Fill with AI")).toBeTruthy();
  });

  it("explains why Find people is unavailable when no account is connected", async () => {
    render({ snapshot: vi.fn(async () => ({ accounts: [] })) });
    await flush();
    await flush();
    expect(buttonByText("Find people")?.disabled).toBe(true);
    expect(bodyText()).toContain("Connect an account in Accounts & Settings first.");
  });

  it("opens the Find people dialog from the action", async () => {
    render();
    await flush();
    await flush();
    clickButton("Find people");
    await flush();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Find people");
  });
});

describe("AudienceScreen people table", () => {
  it("renders the people and counts a select-all as the selection", async () => {
    render({
      people: {
        list: vi.fn(async () => ({
          items: [person({ id: "p1", name: "Ada" }), person({ id: "p2", name: "Grace" })],
        })),
        get: vi.fn(),
        update: vi.fn(),
        merge: vi.fn(),
        matchSuggestions: vi.fn(),
        delete: vi.fn(),
        export: vi.fn(),
      },
    });
    await flush();
    await flush();
    expect(bodyText()).toContain("Ada");
    expect(bodyText()).toContain("Grace");

    const selectAll = document.querySelector<HTMLInputElement>(
      'input[aria-label="Select all people on this page"]',
    );
    expect(selectAll).toBeTruthy();
    selectAll!.click();
    await flush();
    expect(bodyText()).toContain("2 selected");
  });

  it("uses the shared framed search field for people", async () => {
    render({
      people: {
        list: vi.fn(async () => ({ items: [person({ id: "p1", name: "Ada" })] })),
        get: vi.fn(),
        update: vi.fn(),
        merge: vi.fn(),
        matchSuggestions: vi.fn(),
        delete: vi.fn(),
        export: vi.fn(),
      },
    });
    await flush();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search people"]');
    expect(search?.getAttribute("data-search-appearance")).toBe("field");
  });
});
