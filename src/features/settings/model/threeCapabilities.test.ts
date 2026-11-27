import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { THREE_RUNTIME } from "../data/backgrounds/three-runtime.generated";
import {
  THREE_CAPABILITIES,
  THREE_RUNTIME_DESCRIPTION,
} from "../data/backgrounds/three-capabilities.generated";

it("advertises exactly the real offline bundle exports, including geometry and real lights", () => {
  const context: {
    AbortController: typeof AbortController;
    THREE?: {
      CircleGeometry: new (
        radius: number,
        segments: number,
      ) => { type: string; attributes: { position: { count: number } }; dispose(): void };
      PointLight: new (
        color: number,
        intensity: number,
      ) => { isPointLight: boolean; intensity: number };
    };
  } = { AbortController };
  runInNewContext(THREE_RUNTIME, context, { timeout: 5000 });
  expect(Object.keys(context.THREE!).sort()).toEqual(THREE_CAPABILITIES);
  const circle = new context.THREE!.CircleGeometry(2, 16);
  expect(circle.type).toBe("CircleGeometry");
  expect(circle.attributes.position.count).toBeGreaterThan(16);
  circle.dispose();
  const light = new context.THREE!.PointLight(0xffffff, 2);
  expect(light.isPointLight).toBe(true);
  expect(light.intensity).toBe(2);
  for (const name of THREE_CAPABILITIES) expect(THREE_RUNTIME_DESCRIPTION).toContain(name);
});
