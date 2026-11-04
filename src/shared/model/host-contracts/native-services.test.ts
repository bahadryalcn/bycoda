import { expect, it } from "vitest";
import {
  NATIVE_SERVICE_METHODS,
  NATIVE_SERVICES_RPC_SCHEMAS,
  nativeServiceReadOnly,
} from "./native-services";
import {
  NATIVE_SERVICE_UPLOAD_METHODS,
  NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS,
} from "./native-service-upload";
import {
  getHostRpcMethod,
  exportWireSchema,
  parseHostRpcParams,
  hostRpcHasEffect,
  nativeDesktopMethod,
  HOST_RPC_METHOD_ALIASES,
} from "./index";

it("accepts only known legacy Prettier metadata for formatter recovery", () => {
  const schema = NATIVE_SERVICES_RPC_SCHEMAS["native.services.workspace.format"].result;
  const result = { formatted: "const x = 1;\n", cursorOffset: 0 };
  expect(schema.safeParse(result).success).toBe(true);
  expect(
    schema.safeParse({ ...result, comments: [{ type: "CommentLine", value: " keep" }] }).success,
  ).toBe(true);
  expect(schema.safeParse({ ...result, comments: false }).success).toBe(false);
  expect(schema.safeParse({ ...result, other: [] }).success).toBe(false);
});

it("registers private services and uploads without exposing old HTTP helper aliases", () => {
  expect(NATIVE_SERVICE_METHODS).toHaveLength(35);
  expect(NATIVE_SERVICE_METHODS).toEqual(
    expect.arrayContaining([
      "native.services.assistant.presence.get",
      "native.services.assistant.presence.set",
      "native.services.assistant.browser.panel",
      "native.services.desktop.status",
      "native.services.desktop.stop",
    ]),
  );
  expect(NATIVE_SERVICE_UPLOAD_METHODS).toHaveLength(5);
  for (const method of NATIVE_SERVICE_METHODS) {
    const definition = getHostRpcMethod(method)!;
    expect(definition, method).toBeDefined();
    expect(definition.scope, method).toBe("device");
    expect(definition.requiredCapability).toBe("native.services.v1");
    expect(definition.responseTimeoutMs).toBe(30000);
    expect(hostRpcHasEffect(method, definition.kind)).toBe(!nativeServiceReadOnly(method));
    expect(definition.cancellation).toBe(nativeServiceReadOnly(method) ? "query" : "wait-only");
    expect(nativeDesktopMethod(method)).toBe(true);
    expect(exportWireSchema(NATIVE_SERVICES_RPC_SCHEMAS[method].params)).toBeTruthy();
    expect(exportWireSchema(NATIVE_SERVICES_RPC_SCHEMAS[method].result)).toBeTruthy();
  }
  for (const name of [
    "conversation.access.issue",
    "conversation.desktop.finish",
    "social.native.register",
    "runtimeLogs.access.issue",
    "workspace.run",
    "desktop.status",
    "desktop.stop",
  ]) {
    expect(getHostRpcMethod(name)).toBeUndefined();
    expect(Object.hasOwnProperty.call(HOST_RPC_METHOD_ALIASES, name)).toBe(false);
  }
});
it("allows staging only the two finite targets and only status may return authenticated null", () => {
  for (const method of NATIVE_SERVICE_UPLOAD_METHODS) {
    const definition = getHostRpcMethod(method)!;
    expect(definition.requiredCapability).toBe("native.services.v1");
    expect(definition.resultSchema.safeParse(null).success).toBe(method.endsWith(".status"));
    expect(exportWireSchema(NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS[method].params)).toBeTruthy();
    expect(exportWireSchema(NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS[method].result)).toBeTruthy();
  }
  const begin = {
    uploadId: "upload",
    target: "native.services.workspace.format",
    byteLength: 3,
    sha256: "a".repeat(64),
  };
  expect(parseHostRpcParams("native.services.upload.begin", begin)).toEqual(begin);
  for (const bad of [
    { ...begin, target: "workspace.run" },
    { ...begin, target: "files.write" },
    { ...begin, byteLength: 16777217 },
    { ...begin, owner: true },
  ])
    expect(() => parseHostRpcParams("native.services.upload.begin", bad)).toThrow();
  expect(() =>
    parseHostRpcParams("native.services.workspace.format", {
      command: "write_text_file",
      args: {},
    }),
  ).toThrow();
  expect(() =>
    parseHostRpcParams("native.services.conversation.desktop.finish", {
      id: "request",
      result: Infinity,
    }),
  ).toThrow();
});
