import { expect, it } from "vitest";
import { H264AccessUnits } from "./h264";

const nal = (header: number, ...payload: number[]) => [0, 0, 0, 1, header, ...payload];
const sps = nal(0x67, 0x42, 0xc0, 0x2a, 0x8d);
const pps = nal(0x68, 0xce, 0x01);
const idr = nal(0x65, 0xb8, 0x00, 0x04);
const delta = (value: number) => nal(0x41, 0x9a, value);
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());

it("cuts a key picture with its parameter sets and reads the codec from the SPS", () => {
  const units = new H264AccessUnits().push(bytes(sps, pps, idr, delta(1)), true);
  expect(units).toHaveLength(2);
  expect(units[0]).toMatchObject({ key: true, codec: "avc1.42c02a" });
  expect([...units[0].data]).toEqual([...sps, ...pps, ...idr]);
  expect(units[1]).toMatchObject({ key: false, codec: undefined });
  expect([...units[1].data]).toEqual(delta(1));
});

it("holds the last picture until a boundary and joins a picture split across chunks", () => {
  const units = new H264AccessUnits();
  const picture = delta(7);
  expect(units.push(bytes(sps, pps, idr, picture.slice(0, 6)), false)).toHaveLength(1);
  const rest = units.push(Uint8Array.from(picture.slice(6)), true);
  expect(rest).toHaveLength(1);
  expect([...rest[0].data]).toEqual(picture);
});

it("waits for the byte that says whether a slice opens a new picture", () => {
  const units = new H264AccessUnits();
  expect(units.push(bytes(sps, pps, idr, delta(7).slice(0, 5)), false)).toHaveLength(0);
  const both = units.push(Uint8Array.from(delta(7).slice(5)), true);
  expect(both.map((unit) => unit.key)).toEqual([true, false]);
  expect([...both[1].data]).toEqual(delta(7));
});

it("keeps later slices of one picture in the same unit", () => {
  const second = nal(0x41, 0x10, 0x02); // first_mb_in_slice > 0
  const units = new H264AccessUnits().push(bytes(delta(1), second, delta(2)), true);
  expect(units.map((unit) => unit.data.length)).toEqual([delta(1).length + second.length, 7]);
});

it("accepts three-byte start codes and drops bytes before the first one", () => {
  const short = [0, 0, 1, 0x41, 0x9a, 0x01];
  const units = new H264AccessUnits().push(Uint8Array.from([9, 9, ...short, ...delta(2)]), true);
  expect(units).toHaveLength(2);
  expect([...units[0].data]).toEqual(short);
});

it("forgets a partial picture on reset", () => {
  const units = new H264AccessUnits();
  units.push(bytes(delta(1)), false);
  units.reset();
  expect(units.push(bytes(sps, pps, idr), true)).toHaveLength(1);
});
