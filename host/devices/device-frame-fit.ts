import { deflate, inflate } from "node:zlib";
import { promisify } from "node:util";

/**
 * Viewer frames: a phone shows a device screen a few hundred points wide, so a full-resolution
 * lossless capture (a 2560x1600 tablet is ~3 MB of PNG, ~4 MB of base64) only makes every frame
 * slow to transfer and decode. A caller that asks for `maxEdge` gets the same picture scaled to
 * fit, plus the source size so it can still map a tap to device pixels.
 */
export const DEVICE_FRAME_MIN_EDGE = 320;
export const DEVICE_FRAME_MAX_EDGE = 4096;

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Decoded pixels are bounded so a hostile or corrupt header cannot allocate without limit. */
const MAX_PIXELS = 40_000_000;

export type DevicePixels = {
  width: number;
  height: number;
  /** Bytes per pixel in `data`; the first three are red, green, blue (or blue, green, red). */
  channels: 3 | 4;
  bgr?: boolean;
  data: Uint8Array;
};

export function deviceFrameMaxEdge(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < DEVICE_FRAME_MIN_EDGE ||
    value > DEVICE_FRAME_MAX_EDGE
  )
    throw new Error(
      `Invalid frame size: use an integer between ${DEVICE_FRAME_MIN_EDGE} and ${DEVICE_FRAME_MAX_EDGE}.`,
    );
  return value;
}

/**
 * `adb exec-out screencap` without `-p`: a 12-byte (older Android) or 16-byte header of
 * width, height, format[, color space] followed by raw pixels. Unknown formats return undefined.
 */
export function androidRawPixels(buffer: Buffer): DevicePixels | undefined {
  if (buffer.length < 12) return undefined;
  const width = buffer.readUInt32LE(0);
  const height = buffer.readUInt32LE(4);
  const format = buffer.readUInt32LE(8);
  if (!width || !height || width * height > MAX_PIXELS) return undefined;
  // 1 RGBA_8888, 2 RGBX_8888, 5 BGRA_8888; RGB_565 and others keep the PNG path.
  if (format !== 1 && format !== 2 && format !== 5) return undefined;
  const bytes = width * height * 4;
  const header = buffer.length - bytes;
  if (header !== 12 && header !== 16) return undefined;
  return {
    width,
    height,
    channels: 4,
    bgr: format === 5,
    data: buffer.subarray(header),
  };
}

/** 8-bit, non-interlaced RGB/RGBA PNG (what adb and simctl write); anything else returns undefined. */
export async function decodePng(buffer: Buffer): Promise<DevicePixels | undefined> {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  let offset = 8;
  let width = 0,
    height = 0,
    channels: 3 | 4 | undefined;
  const idat: Buffer[] = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const start = offset + 8;
    if (start + length + 4 > buffer.length) return undefined;
    const body = buffer.subarray(start, start + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8],
        color = body[9],
        interlace = body[12];
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return undefined;
      channels = color === 6 ? 4 : 3;
      if (!width || !height || width * height > MAX_PIXELS) return undefined;
    } else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    offset = start + length + 4;
  }
  if (!channels || !idat.length) return undefined;
  const stride = width * channels;
  let raw: Buffer;
  try {
    raw = await inflateAsync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  } catch {
    return undefined;
  }
  if (raw.length !== (stride + 1) * height) return undefined;
  const data = new Uint8Array(stride * height);
  const bpp = channels;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x];
      const left = x >= bpp ? data[row + x - bpp] : 0;
      const up = y > 0 ? data[previous + x] : 0;
      let out: number;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4: {
          const corner = x >= bpp && y > 0 ? data[previous + x - bpp] : 0;
          const estimate = left + up - corner;
          const pa = Math.abs(estimate - left),
            pb = Math.abs(estimate - up),
            pc = Math.abs(estimate - corner);
          out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : corner);
          break;
        }
        default:
          return undefined;
      }
      data[row + x] = out & 0xff;
    }
  }
  return { width, height, channels, data };
}

/** Area-average downscale so the longer edge is at most `maxEdge`; always returns packed RGB. */
export function scalePixels(pixels: DevicePixels, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(pixels.width, pixels.height));
  const width = Math.max(1, Math.round(pixels.width * scale));
  const height = Math.max(1, Math.round(pixels.height * scale));
  const rgb = new Uint8Array(width * height * 3);
  const { channels, data } = pixels;
  const red = pixels.bgr ? 2 : 0,
    blue = pixels.bgr ? 0 : 2;
  const xStart = new Int32Array(width + 1);
  for (let x = 0; x <= width; x++) xStart[x] = Math.floor((x * pixels.width) / width);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * pixels.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * pixels.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = xStart[x];
      const x1 = Math.max(x0 + 1, xStart[x + 1]);
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = y0; sy < y1; sy++) {
        let at = (sy * pixels.width + x0) * channels;
        for (let sx = x0; sx < x1; sx++, at += channels) {
          r += data[at + red];
          g += data[at + 1];
          b += data[at + blue];
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const out = (y * width + x) * 3;
      rgb[out] = Math.round(r / count);
      rgb[out + 1] = Math.round(g / count);
      rgb[out + 2] = Math.round(b / count);
    }
  }
  return { width, height, rgb };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type: string, body: Uint8Array) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "ascii");
  out.set(body, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** RGB PNG with the "up" filter, which suits mostly flat UI screens. */
export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Buffer> {
  const stride = width * 3;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const out = y * (stride + 1);
    filtered[out] = y ? 2 : 0;
    const row = y * stride;
    if (!y) filtered.set(rgb.subarray(0, stride), out + 1);
    else
      for (let x = 0; x < stride; x++)
        filtered[out + 1 + x] = (rgb[row + x] - rgb[row - stride + x]) & 0xff;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", await deflateAsync(filtered, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

/** A fitted PNG and the device size it came from, or undefined when it already fits. */
export async function fitDevicePixels(pixels: DevicePixels, maxEdge: number) {
  if (Math.max(pixels.width, pixels.height) <= maxEdge && pixels.channels === 3 && !pixels.bgr)
    return undefined;
  const scaled = scalePixels(pixels, maxEdge);
  return {
    png: await encodePng(scaled.width, scaled.height, scaled.rgb),
    sourceWidth: pixels.width,
    sourceHeight: pixels.height,
  };
}
