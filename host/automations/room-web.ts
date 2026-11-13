import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";

const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["192.88.99.0", 24],
  ["224.0.0.0", 3],
] as const)
  blockedV4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  blockedV6.addSubnet(address, prefix, "ipv6");

export function roomWebPublicAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family !== 0 &&
    (family !== 6 || globalV6.check(address, "ipv6")) &&
    !(family === 4 ? blockedV4.check(address, "ipv4") : blockedV6.check(address, "ipv6"))
  );
}

export function roomWebUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443"))
    throw new Error("Room web reads require public HTTPS on port 443 without credentials.");
  return url;
}

/** DNS is validated and pinned per hop; Node never resolves the hostname again. */
export async function readRoomWeb(
  value: string,
  authorized: () => Promise<boolean> = async () => true,
  ownerSignal?: AbortSignal,
): Promise<{ url: string; text: string }> {
  const timeout = AbortSignal.timeout(15000);
  const signal = ownerSignal ? AbortSignal.any([ownerSignal, timeout]) : timeout;
  signal.throwIfAborted();
  let url = roomWebUrl(value);
  for (let hop = 0; hop < 4; hop++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address }) => !roomWebPublicAddress(address)))
      throw new Error("Room web reads cannot access private or reserved addresses.");
    if (!(await authorized())) throw new Error("Room automation authority was withdrawn.");
    signal.throwIfAborted();
    const address = addresses[0]!;
    const result = await new Promise<{ location?: string; text: string }>((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          signal,
          agent: false,
          family: address.family,
          headers: {
            Accept: "text/plain, text/html, application/json",
            "Accept-Encoding": "identity",
          },
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
            const location = res.headers.location;
            res.destroy();
            if (!location) reject(new Error("Room web redirect has no location."));
            else resolve({ location, text: "" });
            return;
          }
          if (
            (res.statusCode ?? 0) < 200 ||
            (res.statusCode ?? 0) >= 300 ||
            !/^(text\/(plain|html)|application\/json)(;|$)/i.test(
              res.headers["content-type"] ?? "",
            ) ||
            (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")
          ) {
            res.destroy();
            reject(new Error("Room web response is not readable text."));
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 256000) res.destroy(new Error("Room web response exceeds size limit."));
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    if (result.location) {
      url = roomWebUrl(new URL(result.location, url).href);
      continue;
    }
    return { url: url.href, text: truncateGraphemes(result.text, 12000) };
  }
  throw new Error("Room web redirect limit exceeded.");
}
