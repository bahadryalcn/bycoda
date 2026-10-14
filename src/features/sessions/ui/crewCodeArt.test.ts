// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  CODE_WIDTH,
  CODE_HEIGHT,
  STAND_RISE,
  createCodeArtPainter,
  type CrewActivity,
} from "./crewCodeArt";

afterEach(() => vi.restoreAllMocks());

const COLUMNS = CODE_WIDTH,
  ROWS = (CODE_HEIGHT * 3) / 5;

function canvases(webgl: unknown) {
  const surface = document.createElement("canvas");
  surface.width = 1040;
  surface.height = 340;
  const destination = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
  };
  // Two samples per glyph cell in each direction.
  const pixels = new Uint8ClampedArray(COLUMNS * 2 * ROWS * 2 * 4);
  const mask = {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    roundRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    getImageData: vi.fn(() => ({ data: pixels })),
  };
  const other = {
    fillText: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createPattern: vi.fn(() => ({})),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    kind,
    options,
  ) {
    if (kind === "webgl") {
      expect(this).not.toBe(surface);
      return webgl as never;
    }
    if (this === surface) return destination as never;
    return (
      (options as { willReadFrequently?: boolean } | undefined)?.willReadFrequently ? mask : other
    ) as never;
  });
  /** Paint one fully covered cell at the top-left corner with the given grey value. */
  const paintCorner = (value: number) => {
    for (const o of [0, 4, COLUMNS * 8, COLUMNS * 8 + 4]) {
      pixels[o] = value;
      pixels[o + 3] = value ? 255 : 0;
    }
  };
  return { surface, destination, mask, other, paintCorner };
}

it("samples a small CPU mask and falls back to Canvas 2D glyph bands without WebGL", () => {
  const { surface, destination, mask, other, paintCorner } = canvases(null);
  paintCorner(255);
  const draw = createCodeArtPainter(surface);
  draw(["idle", "idle", "idle", "idle", "idle", "idle"]);
  expect([surface.width, surface.height]).toEqual([CODE_WIDTH * 3, CODE_HEIGHT * 3]);
  expect(mask.scale).toHaveBeenCalledWith(2, (ROWS * 2) / CODE_HEIGHT);
  expect((mask as typeof mask & { lineJoin: string }).lineJoin).toBe("round");
  // Three glyph tiles of 4x4 cells are drawn once and reused by every frame.
  expect(other.fillText).toHaveBeenCalledTimes(48);
  expect(other.createPattern).toHaveBeenCalledTimes(3);
  // A bright silhouette edge lands in the bold highlight band.
  expect(other.putImageData.mock.calls[2][0].data.slice(0, 4)).toEqual(
    new Uint8ClampedArray([255, 255, 255, 255]),
  );
  expect(destination.drawImage).toHaveBeenCalled();
  // A disappearing shape must clear the old cell; very dark paint stays negative space.
  paintCorner(0);
  draw(["sip", "idle", "idle", "idle", "idle", "idle"]);
  expect(other.putImageData.mock.calls[5][0].data[3]).toBe(0);
  paintCorner(40);
  draw(["idle", "idle", "idle", "idle", "idle", "idle"]);
  expect(other.putImageData.mock.calls.slice(6).every(([image]) => image.data[3] === 0)).toBe(true);
  expect(other.fillText).toHaveBeenCalledTimes(48);
});

function mockGl(overrides: Record<string, unknown> = {}) {
  const constants = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    LINK_STATUS: 3,
    ARRAY_BUFFER: 4,
    STATIC_DRAW: 5,
    FLOAT: 6,
    TEXTURE0: 10,
    TEXTURE_2D: 20,
    TEXTURE_MIN_FILTER: 21,
    TEXTURE_MAG_FILTER: 22,
    NEAREST: 23,
    TEXTURE_WRAP_S: 24,
    TEXTURE_WRAP_T: 25,
    CLAMP_TO_EDGE: 26,
    RGBA: 27,
    UNSIGNED_BYTE: 28,
    COLOR_BUFFER_BIT: 29,
    TRIANGLE_STRIP: 30,
  };
  const gl = new Proxy(
    {
      ...constants,
      getProgramParameter: () => true,
      isContextLost: () => false,
      texSubImage2D: vi.fn(),
      drawArrays: vi.fn(),
      getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
      ...overrides,
    } as Record<string, unknown>,
    {
      get: (target, key: string) =>
        key in target ? target[key] : (target[key] = vi.fn(() => ({}))),
    },
  );
  return gl;
}

it("composites with a private WebGL draw and copies a transparent frame to the visible 2D canvas", () => {
  const gl = mockGl();
  const { surface, destination, paintCorner } = canvases(gl);
  paintCorner(255);
  const draw = createCodeArtPainter(surface);
  draw(["idle", "idle", "idle", "idle", "idle", "idle"]);
  draw(["idle", "idle", "idle", "idle", "idle", "idle"]);
  expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  const upload = (gl.texSubImage2D as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(upload.slice(4, 6)).toEqual([COLUMNS, ROWS]);
  expect(Array.from((upload[8] as Uint8Array).slice(0, 4))).toEqual([255, 200, 0, 255]);
  expect(destination.drawImage).toHaveBeenCalledTimes(2);
  expect(destination.clearRect).toHaveBeenCalledTimes(2);
  expect(destination.drawImage.mock.calls[0][0]).not.toBe(surface);
});

it("keeps the visible canvas available for 2D fallback when WebGL shaders fail to link", () => {
  const gl = mockGl({ getProgramParameter: () => false });
  const { surface, destination, other, paintCorner } = canvases(gl);
  paintCorner(255);
  createCodeArtPainter(surface)(Array(6).fill("idle"));
  expect(gl.drawArrays).not.toHaveBeenCalled();
  expect(other.putImageData).toHaveBeenCalledTimes(3);
  expect(destination.drawImage).toHaveBeenCalled();
});

it("falls back to 2D after GPU context loss instead of leaving a blank surface", () => {
  const lost = vi.fn(() => false);
  const gl = mockGl({ isContextLost: lost });
  const { surface, destination, other, paintCorner } = canvases(gl);
  paintCorner(255);
  const draw = createCodeArtPainter(surface);
  draw(Array(6).fill("idle"));
  lost.mockReturnValue(true);
  draw(Array(6).fill("idle"));
  expect(gl.drawArrays).toHaveBeenCalledTimes(1);
  expect(other.putImageData).toHaveBeenCalledTimes(3);
  expect(destination.drawImage.mock.calls.length).toBeGreaterThan(1);
});

it("releases the private GPU context when the scene painter is disposed", () => {
  const release = vi.fn();
  const gl = mockGl({ getExtension: vi.fn(() => ({ loseContext: release })) });
  const { surface } = canvases(gl);
  const draw = createCodeArtPainter(surface);
  draw.dispose?.();
  expect(release).toHaveBeenCalledOnce();
});

/** A recording 2D context: tracks the device-space top edge of every bright path that is filled or stroked. */
function recorder() {
  const ctx: Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
  };
  type M = [number, number, number, number, number, number];
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let pts: [number, number][] = [],
    top = Infinity,
    hits = 0;
  const pt = (x: number, y: number): [number, number] => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ];
  const mul = (n: M) => {
    m = [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  const paint = (style: unknown, pad: number) => {
    const v = typeof style === "string" ? Number(/rgb\((\d+)/.exec(style)?.[1] ?? 0) : 0;
    if (v >= 78 && (ctx.globalAlpha as number) > 0.5) {
      hits++;
      for (const [, y] of pts) top = Math.min(top, y - pad * Math.abs(m[3]));
    }
    pts = [];
  };
  Object.assign(ctx, {
    save: () => stack.push([...m] as M),
    restore: () => {
      m = stack.pop() ?? m;
    },
    translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
    scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
    rotate: (a: number) => mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
    setTransform: () => {
      m = [1, 0, 0, 1, 0, 0];
    },
    clearRect: vi.fn(),
    beginPath: () => {
      pts = [];
    },
    closePath: vi.fn(),
    moveTo: (x: number, y: number) => pts.push(pt(x, y)),
    lineTo: (x: number, y: number) => pts.push(pt(x, y)),
    ellipse: (x: number, y: number, rx: number, ry: number) => {
      const r = Math.max(rx, ry);
      pts.push(pt(x, y - r), pt(x, y + r));
    },
    arc: (x: number, y: number, r: number) => pts.push(pt(x, y - r)),
    fill: () => paint(ctx.fillStyle, 0),
    stroke: () => paint(ctx.strokeStyle, (ctx.lineWidth as number) / 2),
    fillRect: (x: number, y: number) => {
      pts = [pt(x, y)];
      paint(ctx.fillStyle, 0);
    },
    strokeRect: vi.fn(),
    roundRect: (x: number, y: number) => pts.push(pt(x, y)),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    getImageData: () => ({ data: new Uint8ClampedArray(CODE_WIDTH * 2 * ROWS * 2 * 4) }),
  });
  return {
    ctx,
    top: () => top,
    reset: () => {
      top = Infinity;
      hits = 0;
    },
    hits: () => hits,
  };
}

function topEdge(count: number, state: (id: number) => Partial<CrewActivity>, time = 0) {
  const rec = recorder();
  const surface = document.createElement("canvas");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    kind,
    options,
  ) {
    if ((options as { willReadFrequently?: boolean } | undefined)?.willReadFrequently)
      return rec.ctx as never;
    return {
      fillText: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      createPattern: vi.fn(() => ({})),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: vi.fn(),
    } as never;
  });
  const draw = createCodeArtPainter(surface, { renderer: "canvas" });
  draw(
    Array(count).fill("idle"),
    Array.from({ length: count }, (_, id) => ({ stand: 0, talk: 0, ...state(id) }) as CrewActivity),
    1280,
    time,
  );
  return rec.top();
}
const roleOf = (id: number) =>
  id === 2 ? ("lead" as const) : id === 3 ? ("advisor" as const) : ("subagent" as const);
const up = (ids: number[]) => (id: number) =>
  ids.includes(id) ? { stand: 1, working: true, role: roleOf(id) } : { role: roleOf(id) };

it("lifts a standing uncle's head far above a seated one", () => {
  // Seat 2 sits at y=275: seated head near 72, standing roughly 48 units higher (about a quarter of the figure).
  const seated = topEdge(6, up([])),
    standing = topEdge(6, up([2]));
  expect(seated).toBeGreaterThan(60);
  expect(seated - standing).toBeGreaterThanOrEqual(STAND_RISE - 6);
  expect(STAND_RISE / 203).toBeGreaterThan(0.2);
  // Advisor with cane and spectacles stands almost as tall; subagent seat 0 (y=312) sits lower still.
  expect(topEdge(6, up([3]))).toBeLessThan(seated - 40);
});

it("never clips the top of the canvas, even standing, stomping and in crowds", () => {
  for (const count of [6, 7, 10, 14, 24]) {
    const all = Array.from({ length: count }, (_, id) => id);
    expect(
      topEdge(count, (id) => ({
        stand: 1,
        working: true,
        role: roleOf(id),
        jump: 1,
        thought: 1,
        laugh: 1,
      })),
    ).toBeGreaterThanOrEqual(0);
    expect(topEdge(count, up(all.slice(0, 3)), 1000)).toBeGreaterThanOrEqual(0);
  }
});

it("paints babies, children and adults, seated, standing and mid-growth, inside the canvas", () => {
  for (const stage of [0, 1, 2]) {
    const age = { stage, growth: 0.5 };
    expect(topEdge(6, (id) => ({ role: roleOf(id), age }))).toBeGreaterThanOrEqual(0);
    expect(
      topEdge(
        6,
        (id) => ({ stand: 1, working: true, role: roleOf(id), jump: 1, laugh: 1, age }),
        1000,
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      topEdge(6, (id) => ({ role: roleOf(id), smoking: true, smokeLift: 1, exhale: 1, age }), 1000),
    ).toBeGreaterThanOrEqual(0);
    expect(
      topEdge(6, (id) => ({ role: roleOf(id), age: { stage, growth: 0, from: 3, change: 0.5 } })),
    ).toBeGreaterThanOrEqual(0);
  }
});
