// Render shell icons at their actual pixel size. Keep the canonical logo paths;
// optical adjustments below apply only to small raster exports.
export const WINDOWS_ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 96, 128, 256]);

export function renderBrandIcon(
  geometry,
  size,
  { foreground = "#FFFFFF", background = "#000000", responsive = false } = {},
) {
  if (!Number.isInteger(size) || size < 16 || size > 1024)
    throw new Error("Icon size must be an integer from 16 to 1024");
  const small = size <= 64;
  const edge = size <= 20 ? 1 : 2;
  const scale = small ? (size - edge * 2) / 74 : (size * 9.6) / 1024;
  const offset = size / 2 - 40 * scale;
  const rim = small
    ? Math.max(geometry.rimStroke, (size <= 20 ? 0.85 : 1) / scale)
    : geometry.rimStroke;
  const drop = small
    ? Math.max(geometry.dropStroke, (size <= 20 ? 0.65 : 0.8) / scale)
    : geometry.dropStroke;
  // Shorten the outer tips at small sizes so thicker strokes never join the rim.
  const dropPath = small ? geometry.smallDrop : geometry.drop;
  const inset = small ? 0 : size / 32;
  const style =
    responsive && small
      ? `<style>@media(max-width:20px){[data-icon-rim]{stroke-width:${(0.85 * size) / (16 * scale)}}[data-tea-drop]{stroke-width:${(0.65 * size) / (16 * scale)}}}</style>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="bycoda">${style}<rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${(size * 220) / 1024}" fill="${background}"/><g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${foreground}" stroke-linecap="round" stroke-linejoin="round"><path data-icon-rim="" d="${geometry.rim}" stroke-width="${rim}"/>${Array.from({ length: 6 }, (_, index) => `<path data-tea-drop="${index}" transform="rotate(${index * 60} 40 40)" d="${dropPath}" stroke-width="${drop}"/>`).join("")}<path d="${geometry.code}" fill="${foreground}" stroke="none"/></g></svg>\n`;
}

export function encodeIcon(images) {
  if (!images.length) throw new Error("ICO requires at least one image");
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  const seen = new Set();
  images.forEach(({ size, bytes }, index) => {
    if (!Number.isInteger(size) || size < 1 || size > 256 || seen.has(size))
      throw new Error("Invalid or duplicate ICO size");
    seen.add(size);
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.readUInt32BE(16) !== size ||
      bytes.readUInt32BE(20) !== size
    )
      throw new Error("ICO payload must be a matching native-size PNG");
    const entry = 6 + 16 * index;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.bytes)]);
}
