import type { CanvasSurface } from "../../../shared/lib/canvas-worker/types";
export const domCanvas = () => document.createElement("canvas");
/** Both native 2D contexts implement the drawing subset used by existing geometry. */
export function canvas2D(surface: CanvasSurface, options?: CanvasRenderingContext2DSettings) {
  return surface.getContext("2d", options) as CanvasRenderingContext2D | null;
}
// Value becomes ink: shadows use thin "1"s, mid tones the mixed code texture and
// highlights a bold "0". Darkest paint stays empty, so eyes and mouths read as gaps.
export const GLYPH_BANDS = [
  {
    from: 0,
    chars: (column: number, row: number) => ((column + row) % 5 === 2 ? "0" : "1"),
    font: '5px "Consolas", "Courier New", monospace',
  },
  {
    from: 150,
    chars: (column: number, row: number) => ((column + row) % 3 === 0 ? "1" : "0"),
    font: '5px "Consolas", "Courier New", monospace',
  },
  {
    from: 205,
    chars: (column: number, row: number) => ((column + row) % 4 === 1 ? "1" : "0"),
    font: 'bold 5.4px "Consolas", "Courier New", monospace',
  },
] as const;
/** A glyph tile repeats every 4x4 cells; a cell is 3x5 output pixels. */
export const TILE_WIDTH = 12,
  TILE_HEIGHT = 20;

export type Compositor = ((cells: Uint8ClampedArray) => void | false) & { dispose?: () => void };
const VERTEX_SHADER = `attribute vec2 p; varying vec2 uv;
void main(){ uv=vec2(p.x*.5+.5,.5-p.y*.5); gl_Position=vec4(p,0.,1.); }`;
// Sample the 2x2 mask directly in the fragment shader. No GPU-to-CPU readback.
const FRAGMENT_SHADER = `precision highp float;
uniform sampler2D tone; uniform sampler2D atlas; uniform vec2 cells; varying vec2 uv;
vec2 sampleCell(vec2 cell){
 if(cell.x<0. || cell.y<0. || cell.x>=cells.x || cell.y>=cells.y)return vec2(0.);
 vec2 base=cell*2.; vec2 size=cells*2.;
 vec4 a=texture2D(tone,(base+vec2(.5,.5))/size);
 vec4 b=texture2D(tone,(base+vec2(1.5,.5))/size);
 vec4 c=texture2D(tone,(base+vec2(.5,1.5))/size);
 vec4 d=texture2D(tone,(base+vec2(1.5,1.5))/size);
 float sum=a.a+b.a+c.a+d.a;
 if(sum==0.)return vec2(0.);
 float v=(a.r*a.a+b.r*b.a+c.r*c.a+d.r*d.a)/sum;
 return vec2(floor(v*255.+.5)/255.,v<78./255.?0.:sum/4.);
}
void main(){
 vec2 cell=uv*cells; vec2 at=floor(cell); vec2 toneCell=sampleCell(at);
 if(toneCell.y<.1){gl_FragColor=vec4(0.);return;}
 bool rim=sampleCell(at+vec2(-1.,0.)).y<.1 || sampleCell(at+vec2(1.,0.)).y<.1 || sampleCell(at+vec2(0.,-1.)).y<.1 || sampleCell(at+vec2(0.,1.)).y<.1;
 float v=min(1.,toneCell.x+(rim?38./255.:0.));
 float alpha=floor(smoothstep(.1,.6,toneCell.y)*255.+.5)/255.;
 float band=v>=${GLYPH_BANDS[2].from.toFixed(1)}/255.?2.:v>=${GLYPH_BANDS[1].from.toFixed(1)}/255.?1.:0.;
 float light=floor(70.+185.*pow(v,1.35)+.5)/255.;
 vec2 inTile=mod(cell,4.)/4.;
 float ink=texture2D(atlas,vec2((band+inTile.x)/3.,inTile.y)).a*alpha;
 gl_FragColor=vec4(vec3(light*ink),ink);
}`;

/** One draw call: each output pixel looks up its cell's tone and its band's glyph tile. */
export function webglCompositor(
  surface: CanvasSurface,
  columns: number,
  rows: number,
  tiles: CanvasSurface[],
  factory: () => CanvasSurface = domCanvas,
): (((mask: CanvasSurface) => void | false) & { dispose?: () => void }) | null {
  // A canvas cannot become a 2D canvas after acquiring a WebGL context. Keep GPU
  // resources private so failed shaders/context loss never disable the visible fallback.
  const gpu = factory();
  gpu.width = surface.width;
  gpu.height = surface.height;
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = (gpu as HTMLCanvasElement).getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    });
  } catch {
    return null;
  }
  if (!gl || typeof gl.createShader !== "function") return null;
  const context = gl;
  const setup = () => {
    const compile = (type: number, source: string) => {
      const shader = context.createShader(type)!;
      context.shaderSource(shader, source);
      context.compileShader(shader);
      return shader;
    };
    const program = context.createProgram()!;
    context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX_SHADER));
    context.attachShader(program, compile(context.FRAGMENT_SHADER, FRAGMENT_SHADER));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) return false;
    context.useProgram(program);
    context.bindBuffer(context.ARRAY_BUFFER, context.createBuffer());
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      context.STATIC_DRAW,
    );
    const position = context.getAttribLocation(program, "p");
    context.enableVertexAttribArray(position);
    context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
    const texture = (unit: number) => {
      context.activeTexture(context.TEXTURE0 + unit);
      context.bindTexture(context.TEXTURE_2D, context.createTexture());
      for (const [key, value] of [
        [context.TEXTURE_MIN_FILTER, context.NEAREST],
        [context.TEXTURE_MAG_FILTER, context.NEAREST],
        [context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE],
        [context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE],
      ])
        context.texParameteri(context.TEXTURE_2D, key, value);
    };
    // The three band tiles sit side by side in one small atlas, uploaded once.
    const atlas = factory();
    atlas.width = TILE_WIDTH * tiles.length;
    atlas.height = TILE_HEIGHT;
    tiles.forEach((tile, index) => canvas2D(atlas)?.drawImage(tile, index * TILE_WIDTH, 0));
    texture(1);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      context.RGBA,
      context.UNSIGNED_BYTE,
      atlas,
    );
    texture(0);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA,
      columns * 2,
      rows * 2,
      0,
      context.RGBA,
      context.UNSIGNED_BYTE,
      null,
    );
    context.uniform1i(context.getUniformLocation(program, "tone"), 0);
    context.uniform1i(context.getUniformLocation(program, "atlas"), 1);
    context.uniform2f(context.getUniformLocation(program, "cells"), columns, rows);
    context.viewport(0, 0, surface.width, surface.height);
    context.clearColor(0, 0, 0, 0);
    return true;
  };
  const release = () => context.getExtension?.("WEBGL_lose_context")?.loseContext?.();
  try {
    if (!setup()) {
      release();
      return null;
    }
  } catch {
    release();
    return null;
  }
  const destination = canvas2D(surface);
  if (!destination) {
    release();
    return null;
  }
  // Context loss switches the painter to its visible 2D fallback.
  const lost = (event: Event) => event.preventDefault();
  gpu.addEventListener("webglcontextlost", lost);
  const composite = (mask: CanvasSurface): void | false => {
    if (context.isContextLost()) return false;
    context.texSubImage2D(context.TEXTURE_2D, 0, 0, 0, context.RGBA, context.UNSIGNED_BYTE, mask);
    context.clear(context.COLOR_BUFFER_BIT);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    destination.clearRect(0, 0, surface.width, surface.height);
    destination.drawImage(gpu, 0, 0);
  };
  composite.dispose = () => {
    gpu.removeEventListener("webglcontextlost", lost);
    release();
  };
  return composite;
}

/** Canvas 2D fallback: one tone layer per band, masked by that band's glyph pattern. */
export function canvasCompositor(
  surface: CanvasSurface,
  columns: number,
  rows: number,
  tiles: CanvasSurface[],
  debug?: "tones" | "mask",
  mask?: CanvasSurface,
  factory: () => CanvasSurface = domCanvas,
): Compositor | null {
  const context = canvas2D(surface);
  const scratch = factory();
  scratch.width = surface.width;
  scratch.height = surface.height;
  const layer = canvas2D(scratch);
  if (!context || !layer) return null;
  const bands = tiles.map((tile) => {
    const tone = factory();
    tone.width = columns;
    tone.height = rows;
    const toneContext = canvas2D(tone);
    return {
      tone,
      toneContext,
      pattern: layer.createPattern(tile, "repeat"),
      data: toneContext?.createImageData(columns, rows),
    };
  });
  return (cells) => {
    for (const band of bands) band.data?.data.fill(0);
    const used = [false, false, false];
    for (let o = 0; o < cells.length; o += 4) {
      if (!cells[o + 3]) continue;
      const index = Math.round(cells[o + 1] / 100);
      const data = bands[index].data?.data;
      if (!data) continue;
      used[index] = true;
      // Neutral grey only: no tint in any channel.
      data[o] = data[o + 1] = data[o + 2] = cells[o];
      data[o + 3] = cells[o + 3];
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, surface.width, surface.height);
    context.imageSmoothingEnabled = false;
    if (debug === "mask" && mask) {
      context.drawImage(mask, 0, 0, surface.width, surface.height);
      return;
    }
    bands.forEach((band, index) => {
      if (!band.data || !band.toneContext) return;
      band.toneContext.putImageData(band.data, 0, 0);
      if (debug === "tones") {
        context.drawImage(band.tone, 0, 0, surface.width, surface.height);
        return;
      }
      if (!used[index] || !band.pattern) return;
      layer.globalCompositeOperation = "copy";
      layer.imageSmoothingEnabled = false;
      layer.drawImage(band.tone, 0, 0, surface.width, surface.height);
      layer.globalCompositeOperation = "destination-in";
      layer.fillStyle = band.pattern;
      layer.fillRect(0, 0, surface.width, surface.height);
      context.drawImage(scratch, 0, 0);
    });
  };
}
