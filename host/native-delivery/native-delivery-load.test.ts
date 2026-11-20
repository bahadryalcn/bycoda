import { expect, it, vi } from "vitest";
import {
  deliveryIdentity,
  deliverySha,
  nativeDeliveryFixture,
} from "./native-delivery.test-support";

it("admits concurrent deliveries without scanning retained receipt history", async () => {
  const fixture = await nativeDeliveryFixture("native-delivery-reliability");
  const paramsJson = JSON.stringify({ id: "fixture-relay", result: null });
  const target = "native.services.conversation.desktop.finish";
  try {
    await fixture.store.transaction(async () => {
      await fixture.store.db
        .prepare(`WITH RECURSIVE history(n) AS (
          VALUES (1) UNION ALL SELECT n+1 FROM history WHERE n<46204
        )
        INSERT INTO native_delivery_receipts (
          environment_id,principal_id,kind,original_id,sha256,byte_length,state,reserved_bytes
        ) SELECT ?,?,'buffer',printf('historical-%d',n),?,1,'retired',0 FROM history`)
        .run(fixture.store.environmentId, fixture.principal, deliverySha("fixture"));
    });

    const prepare = vi.spyOn(fixture.store.db, "prepare");
    try {
      const requests = Array.from({ length: 65 }, () => ({
        ...deliveryIdentity(paramsJson),
        target,
        paramsJson,
      }));
      const results = await Promise.all(
        [...requests, requests[0]].map((params) =>
          fixture.call("native.services.delivery.apply", params),
        ),
      );

      expect(results.slice(0, requests.length)).toEqual(
        requests.map(({ originalId, sha256, byteLength }) => ({
          originalId,
          sha256,
          byteLength,
          target,
          state: "recorded",
          result: { accepted: true },
        })),
      );
      expect(fixture.counts.finish).toBe(requests.length);
      expect(
        prepare.mock.calls.filter(([sql]) =>
          /SUM\([\s\S]*FROM native_delivery_receipts\s*$/i.test(sql),
        ).length,
      ).toBe(0);
      expect(prepare.mock.calls.some(([sql]) => /substr\(original_id,1,4\)/i.test(sql))).toBe(
        false,
      );
    } finally {
      prepare.mockRestore();
    }
  } finally {
    await fixture.close();
  }
}, 120_000);
