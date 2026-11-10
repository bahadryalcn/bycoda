/** One decodable H.264 picture in Annex-B form, as cut from a device video stream. */
export type H264AccessUnit = {
  data: Uint8Array;
  /** Contains an IDR slice: decoding can start here. */
  key: boolean;
  /** WebCodecs codec string of the SPS carried by this unit, when it has one. */
  codec?: string;
};

const hex = (value: number) => value.toString(16).padStart(2, "0");

/**
 * Cuts an Annex-B byte stream into access units. A unit ends where the next picture starts
 * (a non-slice NAL or a slice that begins at macroblock 0); the caller says when the end of
 * a chunk is itself a boundary, so the last picture of a burst is not held back.
 */
export class H264AccessUnits {
  private pending = new Uint8Array(0);

  reset() {
    this.pending = new Uint8Array(0);
  }

  push(chunk: Uint8Array, boundary: boolean): H264AccessUnit[] {
    let bytes = chunk;
    if (this.pending.length) {
      bytes = new Uint8Array(this.pending.length + chunk.length);
      bytes.set(this.pending);
      bytes.set(chunk, this.pending.length);
    }
    const units: H264AccessUnit[] = [];
    let unitStart = -1;
    let hasSlice = false;
    let key = false;
    let codec: string | undefined;
    for (let index = 0; index + 3 < bytes.length; index++) {
      if (bytes[index] !== 0 || bytes[index + 1] !== 0 || bytes[index + 2] !== 1) continue;
      const start = index > 0 && bytes[index - 1] === 0 ? index - 1 : index;
      const header = index + 3;
      const type = bytes[header] & 0x1f;
      const slice = type === 1 || type === 5;
      // Whether this slice opens a new picture is in its next byte: wait for it.
      if (slice && header + 1 >= bytes.length && !boundary) {
        if (unitStart < 0) unitStart = start;
        break;
      }
      // first_mb_in_slice is ue(v): the value 0 is a single leading 1 bit.
      const firstSlice = slice && header + 1 < bytes.length && (bytes[header + 1] & 0x80) !== 0;
      if (unitStart < 0) unitStart = start;
      else if (hasSlice && (!slice || firstSlice)) {
        units.push({ data: bytes.slice(unitStart, start), key, codec });
        unitStart = start;
        hasSlice = false;
        key = false;
        codec = undefined;
      }
      if (slice) {
        hasSlice = true;
        if (type === 5) key = true;
      } else if (type === 7 && header + 3 < bytes.length)
        codec = `avc1.${hex(bytes[header + 1])}${hex(bytes[header + 2])}${hex(bytes[header + 3])}`;
      index = header;
    }
    if (unitStart < 0) {
      // No start code yet: keep a possible split start code, drop the rest.
      this.pending = boundary ? new Uint8Array(0) : bytes.slice(Math.max(0, bytes.length - 3));
    } else if (boundary && hasSlice) {
      units.push({ data: bytes.slice(unitStart), key, codec });
      this.pending = new Uint8Array(0);
    } else this.pending = bytes.slice(unitStart);
    return units;
  }
}
