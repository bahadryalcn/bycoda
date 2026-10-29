import { describe, expect, it } from "vitest";
import { previewContactImport } from "./socialContactImport";

const context = { accounts: [{ id: "a" }], projectIds: ["p"] };
const good = { accountId: "a", platformId: "u1", name: "Ada", projectIds: ["p"], tags: ["vip"] };

describe("previewContactImport", () => {
  it("rejects files that are not a JSON list before any row is read", () => {
    expect(previewContactImport("nope", context).error).toBeTruthy();
    expect(previewContactImport("{}", context).error).toBeTruthy();
    expect(previewContactImport("[]", context).error).toBeTruthy();
    expect(previewContactImport(JSON.stringify(Array(501).fill(good)), context).error).toContain("500");
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
      JSON.stringify([{ ...good, consent: { allowed: true }, replyEligible: true, optedOut: false, id: "x" }]),
      context,
    );
    expect(rows[0].contact).toEqual(good);
    expect(rows[0].ignored).toEqual(["consent", "replyEligible", "optedOut", "id"]);
  });
});
