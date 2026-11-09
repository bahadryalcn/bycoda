import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { importAudience } from "./audience-import";
import { fixture, NOW, OWNER } from "./audience-test-support";
import { personIdFor } from "./audience-person";
import { saveList } from "./audience-lists";

function workbookBase64(rows: unknown[][]): string {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), "Contacts");
  return Buffer.from(write(book, { type: "buffer", bookType: "xlsx" })).toString("base64");
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
