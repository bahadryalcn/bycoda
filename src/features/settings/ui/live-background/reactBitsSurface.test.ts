// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactBitsSurface } from "./reactBitsSurface";

const palette = { content: "content-token", accent: "accent-token", monoFont: "monospace" };
function context() {
  const methods = [
    "shaderSource",
    "compileShader",
    "deleteShader",
    "attachShader",
    "bindAttribLocation",
    "linkProgram",
    "deleteProgram",
    "bindVertexArray",
    "bindBuffer",
    "bufferData",
    "enableVertexAttribArray",
    "vertexAttribPointer",
    "deleteBuffer",
    "deleteVertexArray",
    "viewport",
    "useProgram",
    "disable",
    "enable",
    "blendFunc",
    "clearColor",
    "clear",
    "uniform2f",
    "uniform1f",
    "uniform3fv",
    "drawArrays",
    "drawArraysInstanced",
  ];
  return {
    ...Object.fromEntries(methods.map((name) => [name, vi.fn()])),
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    DEPTH_TEST: 8,
    BLEND: 9,
    ONE: 10,
    ONE_MINUS_SRC_ALPHA: 11,
    COLOR_BUFFER_BIT: 12,
    TRIANGLE_STRIP: 13,
    TRIANGLES: 14,
    createShader: vi.fn(() => ({})),
    getShaderParameter: vi.fn(() => true),
    createProgram: vi.fn(() => ({})),
    getProgramParameter: vi.fn(() => true),
    createBuffer: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    getUniformLocation: vi.fn((_program, name: string) => name),
    isContextLost: vi.fn(() => false),
  };
}

let gl: ReturnType<typeof context>;
let canvas: HTMLCanvasElement;
let probe: {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
  fillStyle: string;
};
beforeEach(() => {
  gl = context();
  canvas = document.createElement("canvas");
  probe = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: "",
    getImageData: vi.fn(() => ({ data: [80, 120, 160, 255] })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) =>
    kind === "webgl2" ? gl : kind === "2d" ? probe : null) as never);
});
afterEach(() => vi.restoreAllMocks());

describe.each(["threads", "silk", "dark-veil", "soft-aurora", "floating-lines"] as const)(
  "React Bits %s direct surface",
  (kind) => {
    it("caps GPU backing pixels and performs one native draw without CPU readback", () => {
      const surface = createReactBitsSurface(kind, canvas, palette)!;
      expect(surface).not.toBeNull();
      surface.resize(7680, 4320, 3);
      expect(canvas.width).toBeLessThanOrEqual(1920);
      expect(canvas.height).toBeLessThanOrEqual(1200);
      if (kind === "dark-veil") {
        expect(canvas.width).toBeLessThanOrEqual(960);
        expect(canvas.height).toBeLessThanOrEqual(600);
      }
      expect(canvas.width / canvas.height).toBeCloseTo(7680 / 4320, 2);
      const uploads = gl.bufferData.mock.calls.length;
      surface.draw(12, 0, { presence: 0 });
      surface.draw(13, 0.1, { presence: 1 });
      expect(gl.drawArrays.mock.calls.length + gl.drawArraysInstanced.mock.calls.length).toBe(2);
      expect(gl.bufferData).toHaveBeenCalledTimes(uploads);
      // Only token conversion reads pixels, once for each token at creation.
      expect(probe.getImageData).toHaveBeenCalledTimes(2);
      expect(
        gl.uniform1f.mock.calls.filter(([name]) => name === "uTime").map(([, value]) => value),
      ).toEqual([
        12 * (kind === "threads" ? 0.6 : 0.4),
        13 * (kind === "threads" ? 0.6 : 0.4) + 0.07,
      ]);
      surface.dispose();
    });

    it("responds to eased streaming energy independently of busy presence", () => {
      const surface = createReactBitsSurface(kind, canvas, palette)!;
      surface.draw(20, 0.1, { presence: 1 });
      const firstTime = gl.uniform1f.mock.calls.filter(([name]) => name === "uTime").at(-1)![1];
      surface.draw(20, 0.1, { presence: 1, energy: 0.8 });
      const lastTime = gl.uniform1f.mock.calls.filter(([name]) => name === "uTime").at(-1)![1];
      expect(lastTime).toBeGreaterThan(firstTime);
      expect(
        gl.uniform1f.mock.calls.filter(([name]) => name === "uEnergy").map(([, value]) => value),
      ).toEqual([0, 0.8]);
      surface.dispose();
    });

    it("skips lost contexts and releases every resource once", () => {
      const surface = createReactBitsSurface(kind, canvas, palette)!;
      gl.isContextLost.mockReturnValue(true);
      surface.draw(1, 0.1, { presence: 1 });
      expect(gl.drawArrays).not.toHaveBeenCalled();
      expect(gl.drawArraysInstanced).not.toHaveBeenCalled();
      surface.dispose();
      surface.dispose();
      expect(gl.deleteBuffer).toHaveBeenCalledOnce();
      expect(gl.deleteVertexArray).toHaveBeenCalledOnce();
      expect(gl.deleteProgram).toHaveBeenCalledOnce();
      expect(gl.deleteShader).toHaveBeenCalledTimes(2);
      gl.isContextLost.mockReturnValue(false);
      surface.draw(2, 0.1, { presence: 1 });
      expect(gl.drawArrays).not.toHaveBeenCalled();
      expect(gl.drawArraysInstanced).not.toHaveBeenCalled();
    });

    it("returns a fallback signal and cleans shaders on compile failure", () => {
      gl.getShaderParameter.mockReturnValue(false);
      expect(createReactBitsSurface(kind, canvas, palette)).toBeNull();
      expect(gl.deleteShader).toHaveBeenCalledTimes(2);
      expect(gl.createBuffer).not.toHaveBeenCalled();
    });

    it("returns a fallback signal and cleans programs on link failure", () => {
      gl.getProgramParameter.mockReturnValue(false);
      expect(createReactBitsSurface(kind, canvas, palette)).toBeNull();
      expect(gl.deleteProgram).toHaveBeenCalledOnce();
      expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    });
  },
);

it("returns a fallback signal when WebGL2 is unavailable", () => {
  vi.spyOn(canvas, "getContext").mockReturnValue(null);
  expect(createReactBitsSurface("threads", canvas, palette)).toBeNull();
});
