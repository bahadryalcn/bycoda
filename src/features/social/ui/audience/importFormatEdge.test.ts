import { describe, expect, it } from "vitest";
import {
  IMPORT_MAX_ROWS,
  checkRows,
  guessMapping,
  parseDelimited,
  parseJsonTable,
  toImportJson,
} from "./importFormat";

describe("parseDelimited edge cases", () => {
  it("reads tab files and Windows line endings", () => {
    const table = parseDelimited("platformId\tname\r\n1\tAda\r\n2\tGrace\r\n");
    expect(table.headers).toEqual(["platformId", "name"]);
    expect(table.rows).toEqual([
      ["1", "Ada"],
      ["2", "Grace"],
    ]);
  });

  it("keeps a doubled quote inside a quoted cell as one quote", () => {
    const table = parseDelimited('platformId,name\n1,"Ada ""Countess"" Lovelace"');
    expect(table.rows).toEqual([["1", 'Ada "Countess" Lovelace']]);
  });

  it("skips blank lines and trims cells", () => {
    const table = parseDelimited("platformId, name \n\n 1 , Ada \n   \n");
    expect(table.headers).toEqual(["platformId", "name"]);
    expect(table.rows).toEqual([["1", "Ada"]]);
  });
});

describe("parseJsonTable edge cases", () => {
  it("rejects text that is not JSON", () => {
    expect(parseJsonTable("{oops")).toEqual({ error: "The file is not valid JSON." });
  });

  it("collects the keys of every object in the order they first appear and leaves gaps empty", () => {
    expect(
      parseJsonTable(
        '[{"platformId":"1","name":"Ada"},{"platformId":"2","email":"g@example.test"}]',
      ),
    ).toEqual({
      headers: ["platformId", "name", "email"],
      rows: [
        ["1", "Ada", ""],
        ["2", "", "g@example.test"],
      ],
    });
  });

  it("returns an empty table for an empty list", () => {
    expect(parseJsonTable("[]")).toEqual({ headers: [], rows: [] });
  });
});

describe("guessMapping", () => {
  it("matches names without regard to case, spaces and punctuation and leaves unknown columns unmapped", () => {
    expect(guessMapping(["USER_ID", "Display Name", "Lang", "Labels", "Notes"])).toEqual({
      platformId: "USER_ID",
      name: "Display Name",
      language: "Lang",
      tags: "Labels",
    });
  });
});

describe("checkRows", () => {
  it("numbers rows from 1 and reads only the mapped columns", () => {
    const checks = checkRows(
      { headers: ["id", "who", "extra"], rows: [["7", "Ada", "ignored"]] },
      { platformId: "id", name: "who" },
    );
    expect(checks).toEqual([{ row: 1, values: { platformId: "7", name: "Ada" }, issues: [] }]);
  });

  it("reports a missing platform ID and a missing name in plain words", () => {
    const [check] = checkRows(
      { headers: ["id", "who"], rows: [["", ""]] },
      { platformId: "id", name: "who" },
    );
    expect(check!.issues).toEqual(["No platform ID in this row.", "No name in this row."]);
  });

  it("flags every later row that repeats a platform ID, pointing at the first one", () => {
    const checks = checkRows(
      {
        headers: ["id", "who"],
        rows: [
          ["1", "A"],
          ["2", "B"],
          ["1", "C"],
          ["1", "D"],
        ],
      },
      { platformId: "id", name: "who" },
    );
    expect(checks.map((check) => check.issues)).toEqual([
      [],
      [],
      ["Same platform ID as row 1."],
      ["Same platform ID as row 1."],
    ]);
  });

  it("checks no more than the import limit", () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 5 }, (_, index) => [String(index), "Name"]);
    const checks = checkRows({ headers: ["id", "who"], rows }, { platformId: "id", name: "who" });
    expect(checks).toHaveLength(IMPORT_MAX_ROWS);
  });
});

describe("toImportJson", () => {
  it("writes only the fields that have a value and splits tags on commas and semicolons", () => {
    const json = toImportJson(
      checkRows(
        {
          headers: ["id", "who", "link", "lang", "mail", "labels"],
          rows: [
            ["1", "Ada", "https://example.test/ada", "tr", "ada@example.test", "vip; lead, hot"],
          ],
        },
        {
          platformId: "id",
          name: "who",
          profileUrl: "link",
          language: "lang",
          email: "mail",
          tags: "labels",
        },
      ),
    );
    expect(JSON.parse(json)).toEqual([
      {
        platformId: "1",
        name: "Ada",
        profileUrl: "https://example.test/ada",
        language: "tr",
        email: "ada@example.test",
        tags: ["vip", "lead", "hot"],
      },
    ]);
  });

  it("is an empty list when no row is valid", () => {
    expect(toImportJson([{ row: 1, values: {}, issues: ["No name in this row."] }])).toBe("[]");
  });
});
