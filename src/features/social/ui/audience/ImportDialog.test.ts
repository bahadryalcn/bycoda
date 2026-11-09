// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportDialog } from "./ImportDialog";
import {
  ACCOUNT,
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  flush,
  mountHost,
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

/** A file-like object: the dialog reads only name, size and text(). */
function chooseFile(name: string, content: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).toBeTruthy();
  const file = { name, size: content.length, text: async () => content };
  Object.defineProperty(input!, "files", { configurable: true, value: [file] });
  act(() => {
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function renderDialog(mock: ClientMock) {
  host.render(
    createElement(ImportDialog, {
      client: asClient(mock),
      accounts: [ACCOUNT],
      lists: [],
      onClose: vi.fn(),
      onImported: vi.fn(),
    }),
  );
}

describe("ImportDialog", () => {
  it("lists the rows that need attention and imports only the valid ones", async () => {
    const mock: ClientMock = clientMock({
      audience: {
        collect: vi.fn(),
        import: vi.fn(async () => ({
          imported: 1,
          rejected: [{ row: 4, reason: "Unknown account on this computer." }],
        })),
      },
    });
    renderDialog(mock);
    await flush();

    chooseFile("people.csv", "platformId,name\n1,Ada\n2,\n1,Dup");
    await flush();
    await flush();

    expect(bodyText()).toContain("Row 2: No name in this row.");
    expect(bodyText()).toContain("Row 3: Same platform ID as row 1.");

    const importButton = buttonByText("Import 1 people");
    expect(importButton).toBeTruthy();
    importButton!.click();
    await flush();

    expect(mock.audience.import).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "json",
        accountId: "acc1",
        content: JSON.stringify([{ platformId: "1", name: "Ada" }]),
      }),
    );
    expect(bodyText()).toContain("1 people imported");
    expect(bodyText()).toContain("Row 4: Unknown account on this computer.");
  });

  it("refuses a file type it cannot read", async () => {
    renderDialog(clientMock());
    await flush();
    chooseFile("people.pdf", "not a table");
    await flush();
    expect(bodyText()).toContain("Choose a CSV, Excel (.xlsx) or JSON file.");
  });
});
