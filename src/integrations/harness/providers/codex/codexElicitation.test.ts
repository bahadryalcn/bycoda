import { questionsFromUnknown } from "../../../../features/sessions/model/userQuestion";
import { describe, expect, it } from "vitest";
import { codexMcpConfirmation, codexMcpForm, codexMcpFormResponse } from "./codexElicitation";
const confirmation = {
  mode: "form",
  serverName: "example",
  message: "Confirm access",
  requestedSchema: {
    type: "object",
    properties: {
      approved: { type: "boolean", title: "Read this source?", default: false },
    },
    required: ["approved"],
    additionalProperties: false,
  },
};
describe("Codex MCP confirmations", () => {
  it.each(["form", "openai/form", "openaiForm"])(
    "supports a Boolean confirmation in %s mode",
    (mode) => {
      expect(codexMcpConfirmation({ ...confirmation, mode })).toEqual({
        title: "example: Confirm access — Read this source?",
        content: { approved: true },
      });
    },
  );
  it("keeps empty confirmations compatible", () => {
    expect(
      codexMcpConfirmation({
        ...confirmation,
        requestedSchema: { type: "object", properties: {}, required: [] },
      })?.content,
    ).toEqual({});
  });
  it.each([
    { type: "object", properties: {}, required: ["missing"] },
    { type: "object", properties: {}, required: "approved" },
    { type: "object", properties: { approved: { type: "string" } } },
    {
      type: "object",
      properties: { approved: { type: "boolean", const: false } },
    },
    {
      type: "object",
      properties: { approved: { type: "boolean" }, name: { type: "string" } },
    },
    { ...confirmation.requestedSchema, allOf: [{ required: ["missing"] }] },
  ])("does not invent answers for unsupported schemas: %j", (requestedSchema) => {
    expect(codexMcpConfirmation({ ...confirmation, requestedSchema })).toBeNull();
  });
  it("does not treat browser authorization as a confirmation", () => {
    expect(codexMcpConfirmation({ ...confirmation, mode: "url" })).toBeNull();
  });
});
const typed = {
  mode: "form",
  serverName: "example",
  message: "Configure",
  requestedSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 2, maxLength: 8 },
      count: { type: "integer", minimum: 1, maximum: 4 },
      enabled: { type: "boolean" },
      source: {
        type: "string",
        enum: ["repo", "cache"],
        enumNames: ["Repository", "Cache"],
      },
      tags: {
        type: "array",
        items: { type: "string", enum: ["one", "two"] },
        minItems: 1,
        maxItems: 2,
      },
      extra: { type: "string" },
    },
    required: ["name", "count", "enabled", "source", "tags"],
  },
};
describe("MCP typed forms", () => {
  it("yanıtları türlere dönüştürür ve isteğe bağlı alanı atlar", () => {
    const form = codexMcpForm(typed)!;
    expect(form).not.toBeNull();
    expect(
      codexMcpFormResponse(form, {
        kind: "answered",
        answers: {
          mcp_field_0: ["__custom__"],
          mcp_field_1: ["__custom__"],
          mcp_field_2: ["false"],
          mcp_field_3: ["value_0"],
          mcp_field_4: ["value_0", "value_1"],
          mcp_field_5: ["mcp_omit"],
        },
        custom: { mcp_field_0: "sample", mcp_field_1: "3" },
      }),
    ).toEqual({
      action: "accept",
      content: {
        name: "sample",
        count: 3,
        enabled: false,
        source: "repo",
        tags: ["one", "two"],
      },
      _meta: null,
    });
  });
  it.each(["NaN", "1.5", "5", "Infinity", "", "0x10"])(
    "geçersiz integer yanıtını reddeder: %s",
    (count) => {
      const form = codexMcpForm({
        ...typed,
        requestedSchema: {
          type: "object",
          properties: { count: typed.requestedSchema.properties.count },
          required: ["count"],
        },
      })!;
      expect(() =>
        codexMcpFormResponse(form, {
          kind: "answered",
          answers: { mcp_field_0: ["__custom__"] },
          custom: { mcp_field_0: count },
        }),
      ).toThrow();
    },
  );
  it("required ve enum/multiselect sınırlarını doğrular", () => {
    const form = codexMcpForm(typed)!;
    expect(() => codexMcpFormResponse(form, { kind: "answered", answers: {} })).toThrow("required");
    const enumForm = codexMcpForm({
      ...typed,
      requestedSchema: {
        type: "object",
        properties: { source: typed.requestedSchema.properties.source },
        required: ["source"],
      },
    })!;
    expect(() =>
      codexMcpFormResponse(enumForm, {
        kind: "answered",
        answers: { mcp_field_0: ["invented"] },
      }),
    ).toThrow("listed option");
    expect(codexMcpFormResponse(form, { kind: "skipped" })).toEqual({
      action: "cancel",
      content: null,
      _meta: null,
    });
  });
  it.each([
    { type: "object", properties: {} },
    { type: "string", format: "password" },
    { type: "string", pattern: "secret.*" },
    { type: "integer", multipleOf: 2 },
  ])("bilinmeyen veya gizli alan sözleşmesini sessizce kabul etmez: %j", (field) => {
    expect(
      codexMcpForm({
        ...typed,
        requestedSchema: { type: "object", properties: { value: field } },
      }),
    ).toBeNull();
  });
});
it.each([true, false])(
  "literal Other enum ve enumNames aynı başlıkları ID ile çözer; required=%s",
  (required) => {
    const form = codexMcpForm({
      mode: "form",
      requestedSchema: {
        type: "object",
        properties: {
          value: {
            type: "string",
            enum: ["Other", "second"],
            enumNames: ["Other", "Other"],
          },
        },
        required: required ? ["value"] : [],
      },
    })!;
    expect(form.questions[0].options[0]).toMatchObject({
      label: "Other",
      literal: true,
    });
    expect(form.questions[0].options[1].description).toBe("second");
    expect(
      codexMcpFormResponse(form, {
        kind: "answered",
        answers: { mcp_field_0: ["value_0"] },
      }).content,
    ).toEqual({ value: "Other" });
    expect(
      codexMcpFormResponse(form, {
        kind: "answered",
        answers: { mcp_field_0: ["value_1"] },
      }).content,
    ).toEqual({ value: "second" });
  },
);
it("array Other literal kalır ve boş text/enum/array değerleri görünür temsil edilir", () => {
  const form = codexMcpForm({
    mode: "form",
    requestedSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 0 },
        choice: { type: "string", enum: [""] },
        list: { type: "array", items: { type: "string", enum: ["Other", ""] } },
      },
      required: ["text", "choice", "list"],
    },
  })!;
  expect(form.questions[0].options.find((option) => option.id === "mcp_empty")?.label).not.toBe("");
  expect(form.questions[1].options[0].label).not.toBe("");
  expect(
    codexMcpFormResponse(form, {
      kind: "answered",
      answers: {
        mcp_field_0: ["mcp_empty"],
        mcp_field_1: ["value_0"],
        mcp_field_2: ["value_0", "value_1"],
      },
    }).content,
  ).toEqual({ text: "", choice: "", list: ["Other", ""] });
  expect(
    codexMcpFormResponse(form, {
      kind: "answered",
      answers: {
        mcp_field_0: ["mcp_empty"],
        mcp_field_1: ["value_0"],
        mcp_field_2: ["mcp_empty"],
      },
    }).content,
  ).toEqual({ text: "", choice: "", list: [] });
});
it("schema default required kullanıcı yanıtının yerine geçmez", () => {
  const form = codexMcpForm({
    mode: "form",
    requestedSchema: {
      type: "object",
      properties: { count: { type: "integer", default: 2 } },
      required: ["count"],
    },
  })!;
  expect(() => codexMcpFormResponse(form, { kind: "answered", answers: {} })).toThrow();
});
it("whitespace enum labels survive normalize and keep canonical values", () => {
  const form = codexMcpForm({
    mode: "form",
    requestedSchema: {
      type: "object",
      properties: {
        value: {
          type: "string",
          enum: [" ", "canonical"],
          enumNames: [" ", " "],
        },
        list: { type: "array", items: { type: "string", enum: [" "] } },
      },
      required: ["value", "list"],
    },
  })!;
  const questions = questionsFromUnknown(JSON.parse(JSON.stringify({ questions: form.questions })));
  expect(
    questions.map(
      (question) => question.options.filter((option) => option.id.startsWith("value_")).length,
    ),
  ).toEqual([2, 1]);
  expect(
    questions.every((question) =>
      question.options.every((option) => option.label.trim().length > 0),
    ),
  ).toBe(true);
  expect(
    codexMcpFormResponse(
      { ...form, questions },
      {
        kind: "answered",
        answers: { mcp_field_0: ["value_0"], mcp_field_1: ["value_0"] },
      },
    ).content,
  ).toEqual({ value: " ", list: [" "] });
});
it.each([
  { type: "number", minimum: 3, maximum: 2 },
  { type: "string", minLength: 3, maxLength: 2 },
  {
    type: "array",
    items: { type: "string", enum: ["a", "b"] },
    minItems: 2,
    maxItems: 1,
  },
  { type: "array", items: { type: "string", enum: ["a"] }, minItems: 2 },
])("contradictory constraints fail closed: %j", (field) => {
  expect(
    codexMcpForm({
      mode: "form",
      requestedSchema: { type: "object", properties: { value: field } },
    }),
  ).toBeNull();
});
