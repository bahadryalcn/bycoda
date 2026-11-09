import { describe, expect, it } from "vitest";
import {
  checkRows,
  detectFormat,
  guessMapping,
  parseDelimited,
  parseJsonTable,
  toImportJson,
} from "./importFormat";

describe("parseDelimited", () => {
  it("reads semicolon files and keeps quoted commas inside one cell", () => {
    const table = parseDelimited('platformId;name\n1;"Ada, Lovelace"\n2;Grace');
    expect(table.headers).toEqual(["platformId", "name"]);
    expect(table.rows).toEqual([
      ["1", "Ada, Lovelace"],
      ["2", "Grace"],
    ]);
  });

  it("returns an empty table for an empty file", () => {
    expect(parseDelimited("\n\n")).toEqual({ headers: [], rows: [] });
  });
});

describe("parseJsonTable", () => {
  it("rejects a file that is not a list", () => {
    expect(parseJsonTable('{"name":"Ada"}')).toEqual({
      error: "The file must contain a JSON list of people.",
    });
  });

  it("joins tag lists into one cell", () => {
    expect(parseJsonTable('[{"platformId":"1","name":"Ada","tags":["vip","lead"]}]')).toEqual({
      headers: ["platformId", "name", "tags"],
      rows: [["1", "Ada", "vip, lead"]],
    });
  });
});

describe("guessMapping and detectFormat", () => {
  it("matches common column names to fields", () => {
    expect(guessMapping(["User ID", "Full Name", "Profile URL", "E-mail"])).toEqual({
      platformId: "User ID",
      name: "Full Name",
      profileUrl: "Profile URL",
      email: "E-mail",
    });
  });

  it("recognises the three supported file types only", () => {
    expect(detectFormat("people.CSV")).toBe("csv");
    expect(detectFormat("people.xlsx")).toBe("xlsx");
    expect(detectFormat("people.json")).toBe("json");
    expect(detectFormat("people.txt")).toBeUndefined();
  });
});

describe("checkRows", () => {
  const table = {
    headers: ["platformId", "name", "email"],
    rows: [
      ["1", "Ada", "ada@example.com"],
      ["2", "", "grace@example.com"],
      ["1", "Dup", "bad-address"],
    ],
  };
  const mapping = { platformId: "platformId", name: "name", email: "email" };

  it("names the problem in each row that cannot be imported", () => {
    const checks = checkRows(table, mapping);
    expect(checks[0]!.issues).toEqual([]);
    expect(checks[1]!.issues).toEqual(["No name in this row."]);
    expect(checks[2]!.issues).toEqual([
      "The email address is not valid.",
      "Same platform ID as row 1.",
    ]);
  });

  it("sends only the valid rows, with tags as a list", () => {
    const withTags = {
      headers: ["platformId", "name", "tags"],
      rows: [
        ["1", "Ada", "vip, lead"],
        ["2", "", ""],
      ],
    };
    const json = toImportJson(
      checkRows(withTags, { platformId: "platformId", name: "name", tags: "tags" }),
    );
    expect(JSON.parse(json)).toEqual([{ platformId: "1", name: "Ada", tags: ["vip", "lead"] }]);
  });
});
