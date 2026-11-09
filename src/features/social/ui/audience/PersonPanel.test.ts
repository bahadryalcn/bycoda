// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonPanel } from "./PersonPanel";
import {
  asClient,
  bodyText,
  clientMock,
  flush,
  mountHost,
  person,
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

function renderPanel(mock: ClientMock, onChanged = vi.fn()) {
  host.render(
    createElement(PersonPanel, {
      client: asClient(mock),
      personId: "p1",
      onClose: vi.fn(),
      onChanged,
      onDeleted: vi.fn(),
      onMerged: vi.fn(),
    }),
  );
  return onChanged;
}

describe("PersonPanel", () => {
  it("shows the person's stage line and accounts", async () => {
    const mock = clientMock({
      people: {
        ...clientMock().people,
        get: vi.fn(async () => ({
          person: person({ id: "p1", name: "Ada", stage: "replied" }),
          interactions: [],
          enrollments: [],
          suppressed: false,
        })),
      },
    });
    renderPanel(mock);
    await flush();
    await flush();
    expect(bodyText()).toContain("Ada");
    expect(bodyText()).toContain("Replied");
    expect(bodyText()).toContain("@ada");
  });

  it("saves a stage change with people.update", async () => {
    const mock = clientMock();
    const onChanged = renderPanel(mock);
    await flush();
    await flush();

    const stage = document.querySelector("select");
    expect(stage).toBeTruthy();
    setFieldValue(stage!, "contacted");
    await flush();

    expect(mock.people.update).toHaveBeenCalledWith({
      personId: "p1",
      patch: { stage: "contacted" },
    });
    expect(onChanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", stage: "contacted" }),
    );
  });

  it("says so when the person is on the do-not-contact list", async () => {
    const mock = clientMock({
      people: {
        ...clientMock().people,
        get: vi.fn(async () => ({
          person: person({ id: "p1" }),
          interactions: [],
          enrollments: [],
          suppressed: true,
        })),
      },
    });
    renderPanel(mock);
    await flush();
    await flush();
    expect(bodyText()).toContain("Nothing is sent to them.");
  });
});
