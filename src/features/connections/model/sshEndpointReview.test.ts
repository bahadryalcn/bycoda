import { expect, it } from "vitest";
import {
  sameSshEndpoint,
  sshEndpointPreview,
  validSshEndpointPreview,
  validHttpProxyHost,
} from "./sshEndpointReview";
const endpoint = {
  host: "server.example",
  user: "alice",
  port: 22,
  identityFile: "C:/keys/id_ed25519",
  jumpHost: "bob@bastion:2222",
};
it("validates HTTP upstream literals and treats the upstream as part of endpoint identity", () => {
  const direct = { host: "target.example", port: 22 };
  const proxied = { ...direct, httpProxy: { host: "proxy.example", port: 3128 } };
  expect(validSshEndpointPreview(proxied)).toBe(true);
  expect(validSshEndpointPreview({ ...proxied, jumpHosts: ["jump.example"] })).toBe(false);
  expect(
    validSshEndpointPreview({ ...proxied, httpProxy: { host: "proxy.example", port: 0 } }),
  ).toBe(false);
  expect(sameSshEndpoint(direct, proxied)).toBe(false);
  expect(
    sameSshEndpoint(proxied, {
      ...proxied,
      httpProxy: { scheme: "http", port: 3128, host: "proxy.example" },
    }),
  ).toBe(true);
  expect(
    sameSshEndpoint(proxied, {
      ...proxied,
      httpProxy: { scheme: "https", port: 3128, host: "proxy.example" },
    }),
  ).toBe(false);
  expect(
    validSshEndpointPreview({
      ...proxied,
      httpProxy: { scheme: "https", host: "proxy.example", port: 443 },
    }),
  ).toBe(true);
  expect(
    validSshEndpointPreview({
      ...proxied,
      httpProxy: { scheme: "tls-insecure", host: "proxy.example", port: 443 },
    }),
  ).toBe(false);
  expect(
    sameSshEndpoint(proxied, { ...proxied, httpProxy: { host: "other.example", port: 3128 } }),
  ).toBe(false);
  for (const host of ["localhost", "proxy.example", "127.0.0.1", "::1", "2001:db8::1"])
    expect(validHttpProxyHost(host)).toBe(true);
  for (const host of [
    "https://proxy",
    "u@proxy",
    "[::1]",
    "a_b",
    "-bad",
    "bad-",
    "a..b",
    "::no",
    "proxy\nheader",
  ])
    expect(validHttpProxyHost(host)).toBe(false);
});
it("binds per-hop identity and trust to duplicates and rejects mixed routes", () => {
  const policy = {
    host: "hop.example",
    user: "operator",
    port: 2222,
    identityFile: "C:/keys/hop",
    knownHostsFile: "C:/trust/hop",
  };
  const target = { host: "server.example", port: 22, jumpPolicies: [policy] };
  expect(validSshEndpointPreview(target)).toBe(true);
  expect(
    sameSshEndpoint(target, {
      ...target,
      jumpPolicies: [{ ...policy, identityFile: "C:/keys/other" }],
    }),
  ).toBe(false);
  expect(
    sameSshEndpoint(target, {
      ...target,
      jumpPolicies: [{ ...policy, knownHostsFile: "C:/trust/other" }],
    }),
  ).toBe(false);
  expect(validSshEndpointPreview({ ...target, jumpHosts: ["legacy.example"] })).toBe(false);
  expect(
    validSshEndpointPreview({
      ...target,
      jumpPolicies: [{ ...policy, knownHostsFile: "$EXPANDED" }],
    }),
  ).toBe(false);
});
it("matches canonical duplicate semantics including user,port,identity and jump route", () => {
  expect(sameSshEndpoint(endpoint, { ...endpoint, host: "SERVER.example" })).toBe(true);
  for (const patch of [
    { user: "Alice" },
    { port: 2222 },
    { identityFile: undefined },
    { jumpHost: undefined },
    { host: "other.example" },
  ])
    expect(sameSshEndpoint(endpoint, { ...endpoint, ...patch })).toBe(false);
});
it("formats an explicit user/host/port preview including IPv6", () => {
  expect(sshEndpointPreview(endpoint)).toBe("alice@server.example:22");
  expect(sshEndpointPreview({ host: "::1", port: 2200 })).toBe("[::1]:2200");
});
it("does not approve option,URL,control or malformed-port endpoints for quick connect", () => {
  expect(validSshEndpointPreview(endpoint)).toBe(true);
  for (const patch of [
    { host: "-oProxyCommand=bad" },
    { host: "ssh://alice@server" },
    { user: "root\n" },
    { port: 0 },
    { port: 1.5 },
    { identityFile: "key\ncommand" },
    { jumpHost: "host;cmd" },
  ])
    expect(validSshEndpointPreview({ ...endpoint, ...patch })).toBe(false);
});

it("matches a legacy jump to the equivalent ordered chain and includes certificate identity", () => {
  const chain = {
    ...endpoint,
    jumpHost: undefined,
    jumpHosts: [endpoint.jumpHost],
    certificateFile: "C:/keys/user-certificate",
  };
  expect(sameSshEndpoint({ ...endpoint, certificateFile: "C:/keys/user-certificate" }, chain)).toBe(
    true,
  );
  expect(sameSshEndpoint(endpoint, chain)).toBe(false);
  expect(
    sameSshEndpoint({ ...chain, jumpHosts: ["a", "b"] }, { ...chain, jumpHosts: ["b", "a"] }),
  ).toBe(false);
});

it("accepts bounded multi-hop routes and extensionless public certificate references", () => {
  const valid = {
    ...endpoint,
    jumpHost: undefined,
    jumpHosts: ["alice@bastion:2222", "operator@[::1]:22"],
    certificateFile: "C:/keys/public-certificate",
  };
  expect(validSshEndpointPreview(valid)).toBe(true);
  expect(validSshEndpointPreview({ ...valid, jumpHosts: Array(8).fill("host:22") })).toBe(true);
  for (const patch of [
    { jumpHost: "legacy" },
    { jumpHosts: Array(9).fill("host") },
    { jumpHosts: ["host:0"] },
    { jumpHosts: ["host:65536"] },
    { jumpHosts: ["host:invalid"] },
    { jumpHosts: [""] },
    { jumpHosts: ["@host"] },
    { jumpHosts: ["none"] },
    { jumpHosts: ["bad:user@host"] },
    { jumpHosts: ["user@-host"] },
    { jumpHosts: ["user@::1"] },
    { jumpHosts: ["user@bad]"] },
    { certificateFile: "cert\nsecret" },
    { certificateFile: "%h-cert.pub" },
  ])
    expect(validSshEndpointPreview({ ...valid, ...patch })).toBe(false);
});

it("treats native null optional references like absent values without marking an empty route mixed", () => {
  const native = JSON.parse(
    '{"host":"server.example","port":22,"identityFile":null,"certificateFile":null,"jumpHost":null,"jumpHosts":null}',
  );
  expect(sameSshEndpoint(native, { host: "SERVER.example", port: 22 })).toBe(true);
  expect(validSshEndpointPreview(native)).toBe(true);
});

it("allows spaces in certificate references but rejects quotes required by OpenSSH config escaping", () => {
  expect(
    validSshEndpointPreview({ ...endpoint, certificateFile: "C:/public keys/user certificate" }),
  ).toBe(true);
  expect(
    validSshEndpointPreview({ ...endpoint, certificateFile: 'C:/public keys/user"certificate' }),
  ).toBe(false);
  expect(
    validSshEndpointPreview({ ...endpoint, identityFile: 'C:/private keys/user"identity' }),
  ).toBe(true);
});
