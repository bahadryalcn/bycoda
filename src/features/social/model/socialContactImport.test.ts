import { describe, expect, it } from "vitest";
import {
  parseDelimitedRows,
  previewAudienceRecords,
  previewContactImport,
  recordsFromRows,
} from "./socialContactImport";

const context = { accounts: [{ id: "a" }], projectIds: ["p"] };
const good = { accountId: "a", platformId: "u1", name: "Ada", projectIds: ["p"], tags: ["vip"] };

describe("previewContactImport", () => {
  it("rejects files that are not a JSON list before any row is read", () => {
    expect(previewContactImport("nope", context).error).toBeTruthy();
    expect(previewContactImport("{}", context).error).toBeTruthy();
    expect(previewContactImport("[]", context).error).toBeTruthy();
    expect(previewContactImport(JSON.stringify(Array(501).fill(good)), context).error).toContain(
      "500",
    );
  });

  it("keeps valid rows importable and reports each invalid row with its reason", () => {
    const { rows } = previewContactImport(
      JSON.stringify([
        good,
        { ...good, platformId: "u2", accountId: "missing" },
        { ...good, platformId: "u3", projectIds: ["unknown"] },
        { accountId: "a", name: "No id", projectIds: ["p"] },
        good,
      ]),
      context,
    );
    expect(rows.map((row) => !!row.contact)).toEqual([true, false, false, false, false]);
    expect(rows[1].issues).toContain("Unknown account on this computer.");
    expect(rows[2].issues[0]).toContain("Unknown project");
    expect(rows[3].issues).toContain("Missing platformId.");
    expect(rows[4].issues[0]).toContain("row 1");
  });

  it("sends only fields the import reads and never carries consent or eligibility", () => {
    const { rows } = previewContactImport(
      JSON.stringify([
        { ...good, consent: { allowed: true }, replyEligible: true, optedOut: false, id: "x" },
      ]),
      context,
    );
    expect(rows[0].contact).toEqual(good);
    expect(rows[0].ignored).toEqual(["consent", "replyEligible", "optedOut", "id"]);
  });
});

describe("parseDelimitedRows", () => {
  it("picks a semicolon delimiter when the header has more semicolons than commas", () => {
    expect(parseDelimitedRows("a;b;c,d\n1;2;3,4\n")).toEqual([
      ["a", "b", "c,d"],
      ["1", "2", "3,4"],
    ]);
  });

  it("handles quoted cells, doubled quotes, CRLF, a BOM and blank lines", () => {
    const rows = parseDelimitedRows('﻿name,note\r\n"Doe, Jane","say ""hi"""\r\n\r\n');
    expect(rows).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'say "hi"'],
    ]);
  });
});

describe("recordsFromRows", () => {
  it("maps headers by normalized name and splits list cells", () => {
    const { records, error } = recordsFromRows([
      ["Platform ID", "Name", "Project_IDs", "Tags", "Language"],
      ["u1", "Ada", "p", "vip;lead", "tr"],
    ]);
    expect(error).toBeUndefined();
    expect(records).toEqual([
      { platformId: "u1", name: "Ada", projectIds: ["p"], tags: ["vip", "lead"], language: "tr" },
    ]);
  });

  it("explains when the platformId or name column is missing", () => {
    expect(
      recordsFromRows([
        ["a", "b"],
        ["1", "2"],
      ]).error,
    ).toContain("platformId and name");
    expect(recordsFromRows([["platformId", "name"]]).error).toBeTruthy();
  });

  it("honours an explicit header override in the mapping", () => {
    const { records } = recordsFromRows(
      [
        ["id", "display"],
        ["u9", "Eve"],
      ],
      { platformId: "id", name: "display" },
    );
    expect(records[0]).toEqual({ platformId: "u9", name: "Eve" });
  });
});

describe("previewAudienceRecords", () => {
  const audienceContext = { accounts: [{ id: "a" }], projectIds: ["p"] };

  it("validates each record and checks the e-mail address", () => {
    const { rows } = previewAudienceRecords(
      [
        { ...good, email: "Ada@Example.com" },
        { ...good, platformId: "u2", email: "not-an-address" },
        { ...good, platformId: "u3", email: "" },
      ],
      audienceContext,
    );
    expect(rows[0].contact?.email).toBe("ada@example.com");
    expect(rows[1].issues).toEqual(["The email is not valid."]);
    expect(rows[2].contact).toBeDefined();
  });

  it("rejects more than the audience import row limit before any row is read", () => {
    const { rows, error } = previewAudienceRecords(Array(5001).fill(good), audienceContext);
    expect(rows).toEqual([]);
    expect(error).toContain("5000");
  });

  it("still reports a duplicate identity as an issue of the later row", () => {
    const { rows } = previewAudienceRecords([good, good], audienceContext);
    expect(rows[1].issues[0]).toContain("row 1");
  });
});
