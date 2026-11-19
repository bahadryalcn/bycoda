import { describe, expect, it, vi } from "vitest";
import { utils, write } from "xlsx";
import {
  AUDIENCE_IMPORT_MAX_BYTES,
  AUDIENCE_IMPORT_MAX_COLUMNS,
  AUDIENCE_IMPORT_MAX_ROWS,
  AUDIENCE_IMPORT_MAX_SHEET_ROWS,
  CONTACT_IMPORT_MAX_ROWS,
} from "../../../src/features/social/model/socialContactImport";
import { importAudience } from "./audience-import";
import { account, fixture, NOW, OWNER } from "./audience-test-support";
import { personIdFor } from "./audience-person";
import { saveList } from "./audience-lists";

function workbookBase64(rows: unknown[][]): string {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "Contacts");
  return Buffer.from(write(book, { type: "buffer", bookType: "xlsx" })).toString("base64");
}

/** A minimal archive whose central directory declares one entry of the given expanded size. */
function archiveDeclaring(expandedBytes: number): string {
  const entry = Buffer.alloc(47);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt32LE(expandedBytes, 24);
  entry.writeUInt16LE(1, 28);
  entry.write("a", 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(entry.length, 12);
  return Buffer.concat([entry, end]).toString("base64");
}

/** Every stored person, read page by page (a page holds at most 200). */
async function peopleCount(store: {
  listPeople(input: { cursor?: string; limit?: number }): Promise<{ items: unknown[]; next?: string }>;
}): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await store.listPeople({ cursor, limit: 200 });
    total += page.items.length;
    cursor = page.next;
  } while (cursor);
  return total;
}

describe("audience.import", () => {
  it("imports valid CSV rows, reports invalid ones, and marks Turkish recipients for IYS review", async () => {
    const f = await fixture();
    await saveList(f.ctx(OWNER), { id: "team", name: "Team", kind: "static" });
    const content = [
      "platformId;name;projectIds;tags;language",
      "u1;Ada;p1;vip|lead;tr",
      ";Missing id;p1;;",
      "u3;Bob;p1;;",
    ].join("\n");
    const result = await importAudience(f.ctx(OWNER), {
      format: "csv",
      content,
      accountId: "acc-x",
      listId: "team",
    });
    expect(result.imported).toBe(2);
    expect(result.rejected).toEqual([{ row: 2, issues: ["Missing platformId."] }]);
    const ada = await f.store.findPersonByHandle("acc-x", "u1");
    expect(ada?.tags).toEqual(["vip", "lead"]);
    expect(ada?.consent.basis).toBe("imported");
    expect(ada?.commercialConsent).toEqual({ iys: "unknown" });
    expect((await f.store.listMembers("team")).personIds.sort()).toEqual(
      [personIdFor("acc-x", "u1"), personIdFor("acc-x", "u3")].sort(),
    );
  });

  it("reads the first XLSX sheet and keeps the e-mail address on the person", async () => {
    const f = await fixture();
    const content = workbookBase64([
      ["platformId", "name", "projectIds", "email"],
      ["u5", "Carla", "p1", "Carla@Example.com"],
      ["u6", "", "p1", ""],
    ]);
    const result = await importAudience(f.ctx(OWNER), {
      format: "xlsx",
      content,
      accountId: "acc-x",
    });
    expect(result.imported).toBe(1);
    expect(result.rejected[0]).toMatchObject({ row: 2 });
    const carla = await f.store.findPersonByHandle("acc-x", "u5");
    expect(carla?.emails).toEqual([
      { address: "carla@example.com", source: "import", verified: false },
    ]);
  });

  it("merges two imported people that share an exact e-mail address", async () => {
    const f = await fixture();
    const content = JSON.stringify([
      { platformId: "u1", name: "Dana", projectIds: ["p1"], email: "dana@example.com" },
      { platformId: "u4", name: "Dana B", projectIds: ["p1"], email: "dana@example.com" },
    ]);
    await importAudience(f.ctx(OWNER), { format: "json", content, accountId: "acc-x" });
    const merged = await f.store.findPersonByHandle("acc-x", "u4");
    expect(merged?.handles.map((item) => item.platformId).sort()).toEqual(["u1", "u4"]);
  });

  it("refuses an identity the owner suppressed, with the reason on that row", async () => {
    const f = await fixture();
    await f.store.putSuppression({
      id: "sup-u1",
      handle: { platform: "x", platformId: "u1" },
      channel: "all",
      reason: "deleted",
      source: "test",
      at: NOW,
    });
    const content = JSON.stringify([{ platformId: "u1", name: "Ada", projectIds: ["p1"] }]);
    const result = await importAudience(f.ctx(OWNER), {
      format: "json",
      content,
      accountId: "acc-x",
    });
    expect(result.imported).toBe(0);
    expect(result.rejected).toEqual([
      { row: 1, issues: ["This person opted out or was deleted. It is not imported."] },
    ]);
    expect(await f.store.findPersonByHandle("acc-x", "u1")).toBeUndefined();
  });

  it("refuses oversized content by encoded and by decoded size before parsing anything", async () => {
    const f = await fixture();
    const run = (format: "csv" | "xlsx" | "json", content: string) =>
      importAudience(f.ctx(OWNER), { format, content, accountId: "acc-x" });
    // Base64 text longer than any 5 MiB file can encode to is refused without decoding.
    await expect(run("xlsx", "A".repeat(8 * 1024 * 1024))).rejects.toThrow("larger than 5 MiB");
    // Within the encoded allowance, but one byte over the cap once decoded.
    const oneOver = Buffer.alloc(AUDIENCE_IMPORT_MAX_BYTES + 1).toString("base64");
    await expect(run("xlsx", oneOver)).rejects.toThrow("larger than 5 MiB");
    // 3 million two-byte characters are under 5 Mi characters but 6 MB of UTF-8.
    await expect(run("csv", "é".repeat(3_000_000))).rejects.toThrow("at most 5 MiB");
    await expect(run("json", `["${"é".repeat(3_000_000)}"]`)).rejects.toThrow("at most 5 MiB");
    expect((await f.store.listRecords("person")).items).toEqual([]);
  });

  it("refuses a workbook that is not a zip archive or declares an oversized expansion", async () => {
    const f = await fixture();
    const run = (content: string) =>
      importAudience(f.ctx(OWNER), { format: "xlsx", content, accountId: "acc-x" });
    await expect(run(Buffer.from("platformId,name\nu1,Ada").toString("base64"))).rejects.toThrow(
      "not an .xlsx workbook",
    );
    await expect(run(archiveDeclaring(256 * 1024 * 1024))).rejects.toThrow(
      "expands to more than the allowed size",
    );
    expect((await f.store.listRecords("person")).items).toEqual([]);
  });

  it("refuses a sheet whose range is too large before any row is written", async () => {
    const f = await fixture();
    const run = (rows: unknown[][]) =>
      importAudience(f.ctx(OWNER), {
        format: "xlsx",
        content: workbookBase64(rows),
        accountId: "acc-x",
      });
    const tooTall = Array.from({ length: AUDIENCE_IMPORT_MAX_SHEET_ROWS + 1 }, (_, index) => [
      index ? `u${index}` : "platformId",
      index ? "Name" : "name",
    ]);
    await expect(run(tooTall)).rejects.toThrow("larger than");
    const tooWide = [Array.from({ length: AUDIENCE_IMPORT_MAX_COLUMNS + 1 }, (_, index) => `c${index}`)];
    await expect(run(tooWide)).rejects.toThrow("larger than");
    expect((await f.store.listRecords("person")).items).toEqual([]);
  });

  it("keeps the 5000 contact limit for spreadsheets, counting rows that hold data", async () => {
    const f = await fixture();
    const rows = [
      ["platformId", "name", "projectIds"],
      ...Array.from({ length: AUDIENCE_IMPORT_MAX_ROWS + 1 }, (_, index) => [`u${index}`, "N", "p1"]),
    ];
    await expect(
      importAudience(f.ctx(OWNER), {
        format: "xlsx",
        content: workbookBase64(rows),
        accountId: "acc-x",
      }),
    ).rejects.toThrow(`at most ${AUDIENCE_IMPORT_MAX_ROWS} contacts`);
  });

  it("keeps every row inside the chosen account and its granted projects", async () => {
    const f = await fixture({ accounts: [account({ grants: { p1: ["read"], p2: ["read"] } })] });
    const content = JSON.stringify([
      { accountId: "other", platformId: "u1", name: "Ada", projectIds: ["p1"] },
      { platformId: "u2", name: "Bob" },
      { platformId: "u3", name: "Cem", projectIds: ["p9"] },
      { platformId: "u4", name: "Dan", projectIds: ["p2"] },
    ]);
    const result = await importAudience(f.ctx(OWNER), {
      format: "json",
      content,
      accountId: "acc-x",
    });
    expect(result.imported).toBe(1);
    expect(result.rejected.map((item) => item.row)).toEqual([1, 2, 3]);
    expect(result.rejected[0]?.issues).toContain("Unknown account on this computer.");
    expect((await f.store.listRecords("person")).items).toHaveLength(1);
    expect(await f.store.findPersonByHandle("acc-x", "u4")).toBeDefined();
  });

  it("rolls a failed batch back completely and reports that nothing was imported", async () => {
    const f = await fixture();
    const put = f.store.putPerson.bind(f.store);
    vi.spyOn(f.store, "putPerson").mockImplementation(async (person) => {
      if (person.handles.some((handle) => handle.platformId === "u3")) throw new Error("disk full");
      return put(person);
    });
    const content = JSON.stringify(
      ["u1", "u2", "u3"].map((id) => ({ platformId: id, name: id, projectIds: ["p1"] })),
    );
    await expect(
      importAudience(f.ctx(OWNER), { format: "json", content, accountId: "acc-x" }),
    ).rejects.toThrow(/rows 1-3: disk full\. Nothing was imported\./u);
    expect((await f.store.listRecords("person")).items).toEqual([]);
  });

  it("commits large files in batches, says what earlier batches saved, and a retry finishes without duplicates", async () => {
    const f = await fixture();
    const total = CONTACT_IMPORT_MAX_ROWS + 1;
    const content = JSON.stringify(
      Array.from({ length: total }, (_, index) => ({
        platformId: `u${index}`,
        name: `Name ${index}`,
        projectIds: ["p1"],
      })),
    );
    const put = f.store.putPerson.bind(f.store);
    const failing = vi.spyOn(f.store, "putPerson").mockImplementation(async (person) => {
      if (person.handles.some((handle) => handle.platformId === `u${total - 1}`))
        throw new Error("disk full");
      return put(person);
    });
    await expect(
      importAudience(f.ctx(OWNER), { format: "json", content, accountId: "acc-x" }),
    ).rejects.toThrow(
      `rows ${total}: disk full. ${CONTACT_IMPORT_MAX_ROWS} contacts from earlier rows were saved.`,
    );
    expect(await peopleCount(f.store)).toBe(CONTACT_IMPORT_MAX_ROWS);
    failing.mockRestore();
    const retried = await importAudience(f.ctx(OWNER), {
      format: "json",
      content,
      accountId: "acc-x",
    });
    expect(retried).toEqual({ imported: total, rejected: [] });
    expect(await peopleCount(f.store)).toBe(total);
  }, 120_000);

  it("importing the same file twice updates people instead of duplicating them", async () => {
    const f = await fixture();
    const content = JSON.stringify([
      { platformId: "u1", name: "Ada", projectIds: ["p1"], email: "ada@example.com" },
    ]);
    const run = () => importAudience(f.ctx(OWNER), { format: "json", content, accountId: "acc-x" });
    await run();
    await run();
    expect((await f.store.listRecords("person")).items).toHaveLength(1);
    expect((await f.store.findPersonByHandle("acc-x", "u1"))?.emails).toHaveLength(1);
  });

  it("reports suppressed and invalid rows together in file order", async () => {
    const f = await fixture();
    await f.store.putSuppression({
      id: "sup-u2",
      handle: { platform: "x", platformId: "u2" },
      channel: "all",
      reason: "deleted",
      source: "test",
      at: NOW,
    });
    const content = JSON.stringify([
      { platformId: "u1", name: "Ada", projectIds: ["p1"] },
      { platformId: "u2", name: "Bob", projectIds: ["p1"] },
      { name: "No id", projectIds: ["p1"] },
    ]);
    const result = await importAudience(f.ctx(OWNER), {
      format: "json",
      content,
      accountId: "acc-x",
    });
    expect(result.imported).toBe(1);
    expect(result.rejected.map((item) => item.row)).toEqual([2, 3]);
  });

  it("rejects an unknown format and a file without a name column before any row is written", async () => {
    const f = await fixture();
    await expect(
      importAudience(f.ctx(OWNER), { format: "pdf", content: "x", accountId: "acc-x" }),
    ).rejects.toThrow("Invalid import format.");
    await expect(
      importAudience(f.ctx(OWNER), { format: "csv", content: "a,b\n1,2", accountId: "acc-x" }),
    ).rejects.toThrow("platformId and name");
    expect((await f.store.listRecords("person")).items).toEqual([]);
  });
});
