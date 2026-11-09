/** ASCII control characters: U+0000-U+001F, plus U+007F when `includeDelete` is set. */
function isControl(code: number, includeDelete: boolean): boolean {
  return code <= 0x1f || (includeDelete && code === 0x7f);
}

export function hasControlCharacters(value: string, includeDelete = true): boolean {
  for (let index = 0; index < value.length; index++)
    if (isControl(value.charCodeAt(index), includeDelete)) return true;
  return false;
}

export function replaceControlCharacters(
  value: string,
  replacement: string,
  includeDelete = true,
): string {
  let result = "";
  for (let index = 0; index < value.length; index++)
    result += isControl(value.charCodeAt(index), includeDelete) ? replacement : value[index];
  return result;
}
