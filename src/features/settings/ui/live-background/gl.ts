/**
 * Shared WebGL2 path for live-background scenes.
 *
 * One offscreen canvas and one GL context serve every scene in every pane and
 * the settings preview; scenes never create their own. Each `render()` draws
 * into that canvas and copies the result into the pane's 2D context.
 *
 * Shader contract:
 * - Write the scene as GLSL ES 3.00 body text that defines
 *   `vec4 shade(vec2 pixel)`. `pixel` is in render pixels with the origin at the
 *   top-left. The helper declares `uniform float uTime;` and
 *   `uniform vec2 uResolution;` and the `out` variable; do not declare those.
 * - Declare every other uniform in the body, with the same type as the caller
 *   passes: one number is `float`, 2/3/4 numbers are `vec2`/`vec3`/`vec4`.
 * - Return premultiplied alpha (color channels never exceed alpha).
 * - Colors MUST come in as uniforms from the resolved palette (see
 *   `rgbToVec3`). Do not write literal colors in shaders (project rule).
 *
 * Failure is silent: without WebGL2, or while the context is lost, `render()`
 * draws nothing and never throws.
 */

export type ShaderUniform = number | readonly number[];

export type ShaderLayer = {
  /** Renders at `scale` x the CSS size and draws the result over the pane's pixels. */
  render(
    ctx: CanvasRenderingContext2D,
    time: number,
    width: number,
    height: number,
    uniforms: Record<string, ShaderUniform>,
  ): void;
  /** Releases this layer's reference to its compiled program. */
  dispose(): void;
};

const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_HEADER = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
out vec4 outColor;
`;

const FRAGMENT_FOOTER = `
void main() {
  outColor = shade(vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y));
}
`;

/** One triangle that covers the clip space. */
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3]);

type Program = {
  program: WebGLProgram;
  locations: Map<string, WebGLUniformLocation | null>;
  users: number;
};

type Shared = {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext | null;
  /** Set when WebGL2 is missing or failed to initialise; never retried. */
  unavailable: boolean;
  /** Set between webglcontextlost and webglcontextrestored. */
  lost: boolean;
  vao: WebGLVertexArrayObject | null;
  programs: Map<string, Program>;
  /** Fragments that did not compile in this context; not retried every frame. */
  failed: Set<string>;
};

let shared: Shared | null = null;

function sharedState(): Shared {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  const state: Shared = {
    canvas,
    gl: null,
    unavailable: false,
    lost: false,
    vao: null,
    programs: new Map(),
    failed: new Set(),
  };
  canvas.addEventListener("webglcontextlost", (event) => {
    // Preventing the default lets the browser restore the context.
    event.preventDefault();
    state.lost = true;
    // Programs and buffers died with the context; they are rebuilt lazily.
    state.programs.clear();
    state.failed.clear();
    state.vao = null;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    state.lost = false;
  });
  shared = state;
  return state;
}

/** Returns a usable context, or null when WebGL2 is unavailable or lost. */
function acquire(state: Shared): WebGL2RenderingContext | null {
  if (state.unavailable || state.lost) return null;
  if (!state.gl) {
    try {
      state.gl = state.canvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
      });
    } catch {
      state.gl = null;
    }
    if (!state.gl) {
      state.unavailable = true;
      return null;
    }
  }
  const gl = state.gl;
  if (gl.isContextLost()) return null;
  if (!state.vao) {
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) return null;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_TRIANGLE, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    state.vao = vao;
  }
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  if (import.meta.env.DEV) console.warn("live background shader:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

/** Compiles a program for `fragment` once per context; null when it does not compile. */
function programFor(gl: WebGL2RenderingContext, state: Shared, fragment: string): Program | null {
  const cached = state.programs.get(fragment);
  if (cached) return cached;
  if (state.failed.has(fragment)) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const frag = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_HEADER + fragment + FRAGMENT_FOOTER);
  if (!vertex || !frag) {
    if (vertex) gl.deleteShader(vertex);
    if (frag) gl.deleteShader(frag);
    state.failed.add(fragment);
    return null;
  }
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, frag);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (import.meta.env.DEV)
      console.warn("live background program:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    state.failed.add(fragment);
    return null;
  }
  const entry: Program = { program, locations: new Map(), users: 0 };
  state.programs.set(fragment, entry);
  return entry;
}

function setUniform(
  gl: WebGL2RenderingContext,
  entry: Program,
  name: string,
  value: ShaderUniform,
) {
  let location = entry.locations.get(name);
  if (location === undefined) {
    location = gl.getUniformLocation(entry.program, name);
    entry.locations.set(name, location);
  }
  // A uniform the shader does not declare has no location; skip it.
  if (location === null) return;
  if (typeof value === "number") {
    gl.uniform1f(location, value);
    return;
  }
  switch (value.length) {
    case 2:
      gl.uniform2f(location, value[0], value[1]);
      return;
    case 3:
      gl.uniform3f(location, value[0], value[1], value[2]);
      return;
    case 4:
      gl.uniform4f(location, value[0], value[1], value[2], value[3]);
      return;
    default:
      if (value.length > 0) gl.uniform1f(location, value[0]);
  }
}

/**
 * Creates a shader layer for one scene. The fragment body is compiled lazily,
 * once per GL context, and shared by every layer with the same source.
 */
export function createShaderLayer({
  fragment,
  scale = 0.5,
}: {
  fragment: string;
  scale?: number;
}): ShaderLayer {
  const state = sharedState();
  /** The program entry this layer holds a reference to, if any. */
  let held: Program | null = null;

  const hold = (entry: Program) => {
    if (held === entry) return;
    // A rebuilt program (after a context restore) replaces the old reference.
    if (held) held.users--;
    entry.users++;
    held = entry;
  };

  return {
    render(ctx, time, width, height, uniforms) {
      if (width <= 0 || height <= 0) return;
      try {
        const gl = acquire(state);
        if (!gl) return;
        const entry = programFor(gl, state, fragment);
        if (!entry) return;
        hold(entry);
        const renderWidth = Math.max(1, Math.round(width * scale));
        const renderHeight = Math.max(1, Math.round(height * scale));
        const canvas = state.canvas;
        if (canvas.width !== renderWidth) canvas.width = renderWidth;
        if (canvas.height !== renderHeight) canvas.height = renderHeight;

        gl.viewport(0, 0, renderWidth, renderHeight);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(entry.program);
        gl.bindVertexArray(state.vao);
        setUniform(gl, entry, "uTime", time);
        setUniform(gl, entry, "uResolution", [renderWidth, renderHeight]);
        for (const name of Object.keys(uniforms)) setUniform(gl, entry, name, uniforms[name]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(canvas, 0, 0, width, height);
      } catch {
        // A failing GL call must never break the pane's 2D frame.
      }
    },
    dispose() {
      if (!held) return;
      const entry = held;
      held = null;
      entry.users--;
      if (entry.users > 0 || state.lost || !state.gl) return;
      if (state.programs.get(fragment) !== entry) return;
      state.gl.deleteProgram(entry.program);
      state.programs.delete(fragment);
    },
  };
}

/** Converts a resolved palette channel triple (0-255) into shader vec3 values (0-1). */
export function rgbToVec3(
  rgb: readonly [number, number, number],
): readonly [number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}
