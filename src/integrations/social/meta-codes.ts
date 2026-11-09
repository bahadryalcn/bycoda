/**
 * Meta Graph and browser error codes that mean "try later". API and browser paths read the same
 * list so one platform condition does not classify differently by connection. Leaf module: no imports,
 * so both the HTTP layer and host browser recipes can use it.
 * Unverified: the exact meaning of each code is taken from Meta's public error lists, not re-checked live.
 */
export const META_RATE_LIMIT_CODES: readonly number[] = [4, 17, 32, 341, 613];
