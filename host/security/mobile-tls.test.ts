import { afterEach, expect, it } from "vitest";
import { createServer, get } from "node:https";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { MobileTlsAuthority, mobileCaSpkiPin } from "./mobile-tls";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "bycoda-mobile-ca-"));
  cleanups.push(async () => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("bycoda-mobile-ca-"))
      throw new Error("Unsafe fixture cleanup path.");
    await rm(target, { recursive: true, force: true });
  });
  return { file: join(directory, "mobile-ca.json"), environmentId: "fixture-environment" };
}

it("persists one P256 environment CA across restarts and concurrent creators", async () => {
  const input = await fixture();
  const a = new MobileTlsAuthority(input.file, input.environmentId);
  const b = new MobileTlsAuthority(input.file, input.environmentId);
  const [first, second] = await Promise.all([
    a.issue(["localhost", "127.0.0.1"]),
    b.issue(["127.0.0.1"]),
  ]);
  expect(first.caSpkiPin).toBe(second.caSpkiPin);
  expect(new X509Certificate(first.caCertificatePem).ca).toBe(true);
  expect(new X509Certificate(first.certificatePem).ca).toBe(false);
  expect(new X509Certificate(first.certificatePem).checkIP("127.0.0.1")).toBe("127.0.0.1");
  expect(new X509Certificate(first.certificatePem).checkHost("localhost")).toBe("localhost");
  const restarted = await new MobileTlsAuthority(input.file, input.environmentId).issue([
    "127.0.0.1",
  ]);
  expect(restarted.caSpkiPin).toBe(first.caSpkiPin);
  expect(restarted.caGeneration).toBe(1);
});

it("pins CA DER SPKI and renews a leaf without changing paired trust", async () => {
  const input = await fixture();
  let now = Date.now();
  const authority = new MobileTlsAuthority(input.file, input.environmentId, () => now);
  const first = await authority.issue(["127.0.0.1"]);
  const key = new X509Certificate(first.caCertificatePem).publicKey.export({
    format: "der",
    type: "spki",
  });
  expect(first.caSpkiPin).toBe(`sha256/${createHash("sha256").update(key).digest("base64")}`);
  expect(mobileCaSpkiPin(first.certificatePem)).not.toBe(first.caSpkiPin);
  now += 30 * 86_400_000;
  const renewed = await authority.issue(["127.0.0.1"]);
  expect(renewed.caSpkiPin).toBe(first.caSpkiPin);
  expect(renewed.certificatePem).not.toBe(first.certificatePem);
  const bootstrap = await authority.bootstrap("127.0.0.1", 5001);
  expect(bootstrap.endpoint).toBe("wss://127.0.0.1:5001/ws");
  expect(bootstrap.bulkBaseUrl).toBe("https://127.0.0.1:5001/ws-bulk/");
  expect(Object.keys(bootstrap).some((key) => key.toLowerCase().includes("private"))).toBe(false);
});

it("fails changed, corrupt or expired trust instead of silently replacing the CA", async () => {
  const input = await fixture();
  const material = await new MobileTlsAuthority(input.file, input.environmentId).issue([
    "127.0.0.1",
  ]);
  const original = await readFile(input.file, "utf8");
  await expect(
    new MobileTlsAuthority(input.file, "another-environment").issue(["127.0.0.1"]),
  ).rejects.toThrow("identity changed");
  await expect(
    new MobileTlsAuthority(
      input.file,
      input.environmentId,
      () => Date.now() + 1826 * 86_400_000,
    ).issue(["127.0.0.1"]),
  ).rejects.toThrow("trust recovery");
  await writeFile(input.file, "{bad");
  await expect(
    new MobileTlsAuthority(input.file, input.environmentId).issue(["127.0.0.1"]),
  ).rejects.toThrow();
  expect(await readFile(input.file, "utf8")).toBe("{bad");
  await writeFile(input.file, original);
  expect(
    (await new MobileTlsAuthority(input.file, input.environmentId).issue(["localhost"])).caSpkiPin,
  ).toBe(material.caSpkiPin);
});

it("performs real TLS with the paired CA and rejects an untrusted CA or wrong SAN", async () => {
  const input = await fixture();
  const material = await new MobileTlsAuthority(input.file, input.environmentId).issue([
    "127.0.0.1",
    "localhost",
  ]);
  const other = await fixture();
  const foreign = await new MobileTlsAuthority(other.file, "foreign").issue(["localhost"]);
  const server = createServer(
    {
      key: material.privateKeyPem,
      cert: material.certificatePem + material.caCertificatePem,
      minVersion: "TLSv1.2",
    },
    (_request, response) => response.end("trusted"),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const request = (ca: string, servername: string) =>
    new Promise<string>((done, reject) => {
      get(
        {
          hostname: "127.0.0.1",
          port: (server.address() as AddressInfo).port,
          ca,
          servername,
          rejectUnauthorized: true,
          agent: false,
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => done(body));
        },
      ).on("error", reject);
    });
  expect(await request(material.caCertificatePem, "localhost")).toBe("trusted");
  await expect(request(foreign.caCertificatePem, "localhost")).rejects.toThrow();
  await expect(request(material.caCertificatePem, "wrong.invalid")).rejects.toThrow();
});

it("rejects wildcard, credential, URL and unbounded SAN input", async () => {
  const input = await fixture();
  const authority = new MobileTlsAuthority(input.file, input.environmentId);
  for (const names of [
    [],
    ["*.example.com"],
    ["user@host"],
    ["https://host"],
    ["a..b"],
    Array.from({ length: 17 }, (_, index) => `host${index}`),
  ])
    await expect(authority.issue(names)).rejects.toThrow("hostname");
});
