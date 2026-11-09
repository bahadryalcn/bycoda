// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { utils, write } from "xlsx";
import type { SocialAccount } from "../../model/social";
import { ImportDialog, type ImportDialogProps } from "./ImportDialog";
import {
  ACCOUNT,
  SEGMENT_LIST,
  STATIC_LIST,
  asClient,
  bodyText,
  buttonByText,
  clientMock,
  clickButton,
  deferred,
  fieldByLabel,
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

const second = { ...ACCOUNT, id: "acc2", name: "Studio" } as unknown as SocialAccount;

type FileLike = {
  name: string;
  size: number;
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

/** The dialog reads only name, size and text() or arrayBuffer(), so a plain object stands in for a File. */
function pick(file: FileLike) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).toBeTruthy();
  Object.defineProperty(input!, "files", { configurable: true, value: [file] });
  act(() => {
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function textFile(name: string, content: string, size = content.length): FileLike {
  return { name, size, text: async () => content };
}

function renderDialog(mock: ClientMock, overrides: Partial<ImportDialogProps> = {}) {
  const props: ImportDialogProps = {
    client: asClient(mock),
    accounts: [ACCOUNT],
    lists: [STATIC_LIST, SEGMENT_LIST],
    onClose: vi.fn(),
    onImported: vi.fn(),
    ...overrides,
  };
  host.render(createElement(ImportDialog, props));
  return props;
}

async function chosen(
  mock: ClientMock,
  file: FileLike,
  overrides: Partial<ImportDialogProps> = {},
) {
  const props = renderDialog(mock, overrides);
  await flush();
  pick(file);
  await flush();
  await flush();
  return props;
}

function sentContent(mock: ClientMock): unknown {
  const first = mock.audience.import.mock.calls[0] as unknown[] | undefined;
  const call = first?.[0] as { content: string } | undefined;
  return call ? JSON.parse(call.content) : undefined;
}

describe("ImportDialog consent", () => {
  it("never reads consent or eligibility from a file and says importing allows no messages", async () => {
    const mock = clientMock();
    const rows = [
      {
        platformId: "u1",
        name: "Ada",
        consent: { allowed: true },
        optedOut: false,
        replyEligible: true,
        commentEligible: true,
      },
    ];
    await chosen(mock, textFile("people.json", JSON.stringify(rows)));

    expect(bodyText()).toContain("Importing never allows messages to anyone.");
    const labels = Array.from(document.querySelectorAll("label")).map(
      (item) => item.textContent ?? "",
    );
    expect(labels.some((label) => /consent|eligible|opt/i.test(label))).toBe(false);

    clickButton("Import 1 people");
    await flush();
    expect(sentContent(mock)).toEqual([{ platformId: "u1", name: "Ada" }]);
  });
});

describe("ImportDialog account and list", () => {
  it("makes the owner choose the account when there is more than one and names the missing choice", async () => {
    const mock = clientMock();
    await chosen(mock, textFile("people.csv", "platformId,name\n1,Ada"), {
      accounts: [ACCOUNT, second],
    });

    expect(buttonByText("Import 1 people")?.disabled).toBe(true);
    expect(bodyText()).toContain("Choose the account the people belong to.");
    setFieldValue(fieldByLabel("Account"), "acc2");
    expect(buttonByText("Import 1 people")?.disabled).toBe(false);
    clickButton("Import 1 people");
    await flush();
    expect(mock.audience.import).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc2" }),
    );
  });

  it("offers only static lists, sends the chosen one and sends none by default", async () => {
    const mock = clientMock();
    await chosen(mock, textFile("people.csv", "platformId,name\n1,Ada"));
    const target = fieldByLabel("Add them to") as HTMLSelectElement;
    const labels = Array.from(target.options).map((option) => option.textContent);
    expect(labels).toContain("Buyers");
    expect(labels).not.toContain("Turkish");

    clickButton("Import 1 people");
    await flush();
    expect(mock.audience.import).toHaveBeenLastCalledWith(
      expect.objectContaining({ listId: undefined, accountId: "acc1", format: "json" }),
    );
  });

  it("sends the chosen list", async () => {
    const mock = clientMock();
    await chosen(mock, textFile("people.csv", "platformId,name\n1,Ada"));
    setFieldValue(fieldByLabel("Add them to"), "l1");
    clickButton("Import 1 people");
    await flush();
    expect(mock.audience.import).toHaveBeenLastCalledWith(
      expect.objectContaining({ listId: "l1" }),
    );
  });
});

describe("ImportDialog column mapping", () => {
  it("asks for the two required columns until they are matched, then imports with the owner's mapping", async () => {
    const mock = clientMock();
    await chosen(mock, textFile("people.csv", "handle,label,labels\nu1,Ada,vip;lead"));

    expect(buttonByText("Import people")?.disabled).toBe(true);
    expect(bodyText()).toContain("Match the Platform ID and Name columns.");

    setFieldValue(fieldByLabel("Platform ID · Required"), "handle");
    setFieldValue(fieldByLabel("Name · Required"), "label");
    expect(buttonByText("Import 1 people")?.disabled).toBe(false);
    clickButton("Import 1 people");
    await flush();
    // "labels" is a known alias of tags, so it was matched without help.
    expect(sentContent(mock)).toEqual([{ platformId: "u1", name: "Ada", tags: ["vip", "lead"] }]);
  });

  it("cannot import when every row has a problem and lists the problems", async () => {
    const mock = clientMock();
    await chosen(mock, textFile("people.csv", "platformId,name,email\n1,,\n2,Grace,not-an-email"));
    expect(buttonByText("Import people")?.disabled).toBe(true);
    expect(bodyText()).toContain("No row can be imported. Fix the rows listed below.");
    expect(bodyText()).toContain("Row 1: No name in this row.");
    expect(bodyText()).toContain("Row 2: The email address is not valid.");
    expect(mock.audience.import).not.toHaveBeenCalled();
  });

  it("leaves the email out of the import when its column is set to Not in file", async () => {
    const mock = clientMock();
    await chosen(mock, textFile("people.csv", "platformId,name,email\n1,Ada,ada@example.test"));
    setFieldValue(fieldByLabel("Email"), "");
    clickButton("Import 1 people");
    await flush();
    expect(sentContent(mock)).toEqual([{ platformId: "1", name: "Ada" }]);
  });
});

describe("ImportDialog files", () => {
  it("refuses a file over 1 MiB without reading it", async () => {
    const text = vi.fn(async () => "platformId,name\n1,Ada");
    await chosen(clientMock(), { name: "big.csv", size: 1024 * 1024 + 1, text });
    expect(bodyText()).toContain("The import can be at most 1 MiB.");
    expect(text).not.toHaveBeenCalled();
    expect(buttonByText("Import people")?.disabled).toBe(true);
    expect(bodyText()).toContain("Choose a file first.");
  });

  it("explains a JSON file that is broken or is not a list", async () => {
    await chosen(clientMock(), textFile("people.json", "{not json"));
    expect(bodyText()).toContain("The file is not valid JSON.");

    pick(textFile("people.json", '{"name":"Ada"}'));
    await flush();
    await flush();
    expect(bodyText()).toContain("The file must contain a JSON list of people.");
    expect(buttonByText("Import people")?.disabled).toBe(true);
  });

  it("imports only the first 500 rows of a longer file and says so", async () => {
    const mock = clientMock();
    const rows = Array.from({ length: 501 }, (_, index) => `${index + 1},Person ${index + 1}`);
    await chosen(mock, textFile("people.csv", `platformId,name\n${rows.join("\n")}`));
    expect(bodyText()).toContain(
      "Only the first 500 rows are imported. Split the file to import the rest.",
    );
    clickButton("Import 500 people");
    await flush();
    expect((sentContent(mock) as unknown[]).length).toBe(500);
  });

  it("reads the first sheet of an Excel workbook", async () => {
    const book = utils.book_new();
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ["platformId", "name"],
        ["u1", "Ada"],
      ]),
      "People",
    );
    utils.book_append_sheet(
      book,
      utils.aoa_to_sheet([
        ["platformId", "name"],
        ["u2", "Grace"],
      ]),
      "Other",
    );
    const buffer = write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const mock = clientMock();
    await chosen(mock, {
      name: "people.xlsx",
      size: buffer.byteLength,
      arrayBuffer: async () => buffer,
    });
    await flush();
    await flush();
    expect(bodyText()).toContain("First sheet only");
    clickButton("Import 1 people");
    await flush();
    expect(sentContent(mock)).toEqual([{ platformId: "u1", name: "Ada" }]);
  });
});

describe("ImportDialog result", () => {
  it("shows the Host reason, keeps the file and offers a retry when the import fails", async () => {
    const mock = clientMock({
      audience: {
        ...clientMock().audience,
        import: vi.fn(async () => {
          throw new Error("The Host is busy.");
        }),
      },
    });
    const props = await chosen(mock, textFile("people.csv", "platformId,name\n1,Ada"));
    clickButton("Import 1 people");
    await flush();
    expect(bodyText()).toContain("The Host is busy.");
    expect(props.onImported).not.toHaveBeenCalled();
    expect(buttonByText("Import 1 people")?.disabled).toBe(false);
  });

  it("reports the imported count to the screen and finishes with Done", async () => {
    const mock = clientMock({
      audience: {
        ...clientMock().audience,
        import: vi.fn(async () => ({ imported: 1, rejected: [] })),
      },
    });
    const props = await chosen(mock, textFile("people.csv", "platformId,name\n1,Ada"));
    clickButton("Import 1 people");
    await flush();
    expect(props.onImported).toHaveBeenCalledWith({ imported: 1, rejected: [] });
    expect(bodyText()).toContain("1 people imported");
    expect(buttonByText("Import 1 people")).toBeUndefined();
    clickButton("Done");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not import twice while the first request is running", async () => {
    const pending = deferred<{ imported: number; rejected: [] }>();
    const mock = clientMock({
      audience: { ...clientMock().audience, import: vi.fn(() => pending.promise) },
    });
    await chosen(mock, textFile("people.csv", "platformId,name\n1,Ada"));
    clickButton("Import 1 people");
    await flush();
    clickButton("Import 1 people");
    await flush();
    expect(mock.audience.import).toHaveBeenCalledTimes(1);
    expect(buttonByText("Cancel")?.disabled).toBe(true);
  });
});
