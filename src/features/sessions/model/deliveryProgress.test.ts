import { expect, it } from "vitest";
import {
  beginDeliveryProgress,
  clearDeliveryProgress,
  readDeliveryProgress,
  updateDeliveryProgress,
} from "./deliveryProgress";

it("keeps an older blocked message visible while later messages are submitted", () => {
  const first = beginDeliveryProgress("parallel-delivery", "first", "confirming");
  const second = beginDeliveryProgress("parallel-delivery", "second", "provider");
  expect(readDeliveryProgress("parallel-delivery")?.messageId).toBe("first");
  updateDeliveryProgress("parallel-delivery", second, "accepted");
  expect(readDeliveryProgress("parallel-delivery")?.messageId).toBe("first");
  updateDeliveryProgress("parallel-delivery", first, "unknown");
  expect(readDeliveryProgress("parallel-delivery")?.stage).toBe("unknown");
  clearDeliveryProgress("parallel-delivery", first);
  clearDeliveryProgress("parallel-delivery", second);
});
