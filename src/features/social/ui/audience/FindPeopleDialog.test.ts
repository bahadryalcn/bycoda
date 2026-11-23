// @vitest-environment happy-dom
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../model/social";
import { FindPeopleDialog, type FindPeopleDialogProps } from "./FindPeopleDialog";
import {
  ACCOUNT,
  STATIC_LIST,
  asClient,
  bodyText,
  buttonByText,
  clickButton,
  clientMock,
  fieldByLabel,
  flush,
  mountHost,
  pickOption,
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

const second = {
  ...ACCOUNT,
  id: "acc2",
  name: "Studio",
  platform: "instagram",
} as unknown as SocialAccount;

function renderDialog(mock: ClientMock, overrides: Partial<FindPeopleDialogProps> = {}) {
  const props: FindPeopleDialogProps = {
    client: asClient(mock),
    accounts: [ACCOUNT],
    lists: [STATIC_LIST],
    onClose: vi.fn(),
    onCollected: vi.fn(),
    ...overrides,
  };
  host.render(createElement(FindPeopleDialog, props));
  return props;
}

describe("FindPeopleDialog", () => {
  it("cannot run without a connected account and says where to connect one", async () => {
    renderDialog(clientMock(), { accounts: [] });
    await flush();
    expect(buttonByText("Find people")?.disabled).toBe(true);
    expect(bodyText()).toContain("Connect an account in Accounts & Settings first.");
  });

  it("collects the comments on all recent posts into the first static list by default", async () => {
    const mock = clientMock();
    const props = renderDialog(mock);
    await flush();
    expect(buttonByText("Find people")?.disabled).toBe(false);

    clickButton("Find people");
    await flush();
    expect(mock.audience.collect).toHaveBeenCalledWith({
      source: { kind: "own_post_comments", accountId: "acc1", postRef: undefined },
      targetListId: "l1",
      limit: 100,
    });
    expect(bodyText()).toContain("2 people added, 1 skipped");
    expect(props.onCollected).toHaveBeenCalledWith({ collected: 2, skipped: 1 });
    expect(buttonByText("Done")).toBeTruthy();
  });

  it("sends no list when the people should only go to All people", async () => {
    const mock = clientMock();
    renderDialog(mock);
    await flush();
    pickOption("Add them to", "Only All people");
    clickButton("Find people");
    await flush();
    expect(mock.audience.collect).toHaveBeenCalledWith(
      expect.objectContaining({ targetListId: undefined }),
    );
  });

  it("asks for the keyword a keyword search needs and sends it without a leading hash", async () => {
    const mock = clientMock();
    renderDialog(mock);
    await flush();
    pickOption("Where to look", "Hashtag");
    await flush();

    expect(buttonByText("Find people")?.disabled).toBe(true);
    expect(bodyText()).toContain("Enter a keyword or hashtag.");
    setFieldValue(fieldByLabel("Keyword or hashtag"), "#launch");
    expect(buttonByText("Find people")?.disabled).toBe(false);
    clickButton("Find people");
    await flush();
    expect(mock.audience.collect).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: "hashtag", accountId: "acc1", query: "launch" } }),
    );
  });

  it("asks for the other account's handle when collecting its commenters", async () => {
    const mock = clientMock();
    renderDialog(mock);
    await flush();
    pickOption("Where to look", "Commenters on another account's posts");
    await flush();
    expect(bodyText()).toContain("Enter the account handle.");
    setFieldValue(fieldByLabel("Account handle"), "@rival");
    clickButton("Find people");
    await flush();
    expect(mock.audience.collect).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "account_commenters", accountId: "acc1", handle: "rival" },
      }),
    );
  });

  it("collects from the account the owner picked", async () => {
    const mock = clientMock();
    renderDialog(mock, { accounts: [ACCOUNT, second] });
    await flush();
    pickOption("Account", "Instagram · Studio");
    clickButton("Find people");
    await flush();
    expect(mock.audience.collect).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ accountId: "acc2" }) }),
    );
  });

  it("refuses a maximum outside 1 to 500 and names the range", async () => {
    const mock = clientMock();
    renderDialog(mock);
    await flush();
    for (const value of ["0", "501"]) {
      setFieldValue(fieldByLabel("Maximum people"), value);
      expect(buttonByText("Find people")?.disabled).toBe(true);
      expect(bodyText()).toContain("Enter a whole number from 1 to 500.");
    }
    setFieldValue(fieldByLabel("Maximum people"), "500");
    expect(buttonByText("Find people")?.disabled).toBe(false);
    clickButton("Find people");
    await flush();
    expect(mock.audience.collect).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });

  it("says a source is not available for the account instead of reporting zero people added", async () => {
    const mock = clientMock({
      audience: {
        ...clientMock().audience,
        collect: vi.fn(async () => ({ collected: 0, skipped: 0, unsupported: "followers.list" })),
      },
    });
    renderDialog(mock);
    await flush();
    clickButton("Find people");
    await flush();
    expect(bodyText()).toContain(
      "This search is not available for this account yet. Try another source.",
    );
    expect(bodyText()).not.toContain("0 people added");
  });

  it("shows the Host reason and does not report a collection when it fails", async () => {
    const mock = clientMock({
      audience: {
        ...clientMock().audience,
        collect: vi.fn(async () => {
          throw new Error("The account token expired.");
        }),
      },
    });
    const props = renderDialog(mock);
    await flush();
    clickButton("Find people");
    await flush();
    expect(bodyText()).toContain("The account token expired.");
    expect(props.onCollected).not.toHaveBeenCalled();
    expect(buttonByText("Cancel")).toBeTruthy();
  });
});
