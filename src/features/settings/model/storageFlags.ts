import { storedFlag } from "../../../shared/lib/storedSetting";

export function readFlag(key: string): boolean | null {
  return storedFlag(key, null).load();
}

export function writeFlag(key: string, value: boolean) {
  storedFlag(key, null).save(value);
}
