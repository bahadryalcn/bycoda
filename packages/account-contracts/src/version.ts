/** Contract version. Bump the minor for additive changes and the major for breaking ones. */
export const CONTRACT_VERSION = "0.7.0";

/** Request header every client sends so the server can reject unsupported contract versions. */
export const CONTRACT_HEADER = "X-Bycoda-Contract";
