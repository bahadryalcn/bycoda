import { t } from "../../../../shared/i18n";
import {
  selectedAnswerLabels,
  type UserQuestion,
  type UserQuestionReply,
} from "../../../../features/sessions/model/userQuestion";
import { asRecord, stringField } from "./codexProtocol";

/** Only confirmations can be represented faithfully by the Allow/Deny UI. */
export function codexMcpConfirmation(params: unknown): {
  title: string;
  content: Record<string, boolean>;
} | null {
  const rec = asRecord(params);
  const schema = asRecord(rec?.requestedSchema);
  const properties = asRecord(schema?.properties);
  if (
    !["form", "openai/form", "openaiForm"].includes(String(rec?.mode)) ||
    schema?.type !== "object" ||
    !properties ||
    Object.keys(schema).some(
      (key) =>
        ![
          "type",
          "properties",
          "required",
          "title",
          "description",
          "$schema",
          "additionalProperties",
        ].includes(key),
    )
  )
    return null;

  const entries = Object.entries(properties);
  const required = schema.required ?? [];
  if (
    !Array.isArray(required) ||
    required.some(
      (key) => typeof key !== "string" || !Object.prototype.hasOwnProperty.call(properties, key),
    ) ||
    entries.length > 1
  )
    return null;

  let detail: string | undefined;
  let content: Record<string, boolean> = {};
  if (entries.length === 1) {
    const [key, value] = entries[0];
    const field = asRecord(value);
    if (
      field?.type !== "boolean" ||
      Object.keys(field).some((name) => !["type", "title", "description", "default"].includes(name))
    )
      return null;
    detail = [stringField(field, "title") ?? key, stringField(field, "description")]
      .filter(Boolean)
      .join(" — ");
    content = { [key]: true };
  }

  const message = stringField(rec, "message") ?? "Approve request";
  return {
    title: `${stringField(rec, "serverName") ?? "MCP"}: ${message}${detail ? ` — ${detail}` : ""}`,
    content,
  };
}

type FormValue = string | number | boolean | string[];
type FormField = {
  key: string;
  id: string;
  schema: Record<string, unknown>;
  required: boolean;
};
export type CodexMcpForm = {
  title: string;
  questions: UserQuestion[];
  fields: FormField[];
};
const OMIT_OPTION = "mcp_omit";
const EMPTY_OPTION = "mcp_empty";
const COMMON_KEYS = ["type", "title", "description", "default"];
function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function validBound(value: unknown, integer = false): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      (!integer || (Number.isInteger(value) && value >= 0)))
  );
}
function validStringEnum(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length
  );
}
/** A strict, representable form subset. Unknown constraints are rejected rather
 * than silently collecting a value that has not been validated. No secret-input formats/URL
 * authorization, nested objects, regex patterns or invented defaults are accepted.
 */
export function codexMcpForm(params: unknown): CodexMcpForm | null {
  const rec = asRecord(params);
  const schema = asRecord(rec?.requestedSchema);
  const properties = asRecord(schema?.properties);
  if (
    !schema ||
    !properties ||
    schema.type !== "object" ||
    !["form", "openai/form", "openaiForm"].includes(String(rec?.mode)) ||
    !onlyKeys(schema, [
      "type",
      "properties",
      "required",
      "title",
      "description",
      "$schema",
      "additionalProperties",
    ])
  )
    return null;
  const required = schema.required ?? [];
  const entries = Object.entries(properties);
  if (
    !Array.isArray(required) ||
    required.some(
      (key) => typeof key !== "string" || !Object.prototype.hasOwnProperty.call(properties, key),
    ) ||
    entries.length === 0 ||
    entries.length > 20
  )
    return null;
  const fields: FormField[] = [];
  const questions: UserQuestion[] = [];
  for (const [index, [key, value]] of entries.entries()) {
    const field = asRecord(value);
    if (!field) return null;
    const type = field.type;
    let options: UserQuestion["options"] = [];
    let allowCustom = false;
    const label = stringField(field, "title") ?? key;
    if (type === "string") {
      if (
        !onlyKeys(field, [...COMMON_KEYS, "enum", "enumNames", "minLength", "maxLength"]) ||
        !validBound(field.minLength, true) ||
        !validBound(field.maxLength, true)
      )
        return null;
      if (field.enum !== undefined) {
        if (!validStringEnum(field.enum)) return null;
        const names = field.enumNames;
        if (
          names !== undefined &&
          (!Array.isArray(names) ||
            names.length !== field.enum.length ||
            !names.every((name) => typeof name === "string"))
        )
          return null;
        options = field.enum.map((item, i) => ({
          id: `value_${i}`,
          label:
            Array.isArray(names) && (names[i] as string).trim()
              ? (names[i] as string)
              : item.trim()
                ? item
                : item
                  ? JSON.stringify(item)
                  : t("Empty value"),
          literal: true,
          ...(Array.isArray(names) && names[i] !== item
            ? { description: item || t("Empty value") }
            : {}),
        }));
      } else {
        allowCustom = true;
        if (field.minLength === undefined || field.minLength === 0)
          options.push({
            id: EMPTY_OPTION,
            label: t("Empty value"),
            literal: true,
          });
      }
    } else if (type === "boolean") {
      if (!onlyKeys(field, COMMON_KEYS)) return null;
      options = [
        { id: "true", label: t("Yes"), literal: true },
        { id: "false", label: t("No"), literal: true },
      ];
    } else if (type === "number" || type === "integer") {
      if (
        !onlyKeys(field, [...COMMON_KEYS, "minimum", "maximum"]) ||
        !validBound(field.minimum) ||
        !validBound(field.maximum)
      )
        return null;
      allowCustom = true;
    } else if (type === "array") {
      const items = asRecord(field.items);
      if (
        !onlyKeys(field, [...COMMON_KEYS, "items", "minItems", "maxItems"]) ||
        !items ||
        items.type !== "string" ||
        !onlyKeys(items, ["type", "enum"]) ||
        !validStringEnum(items.enum) ||
        !validBound(field.minItems, true) ||
        !validBound(field.maxItems, true)
      )
        return null;
      options = items.enum.map((item, i) => ({
        id: `value_${i}`,
        label: item.trim() ? item : item ? JSON.stringify(item) : t("Empty value"),
        literal: true,
      }));
    } else return null;
    if (
      [
        ["minLength", "maxLength"],
        ["minimum", "maximum"],
        ["minItems", "maxItems"],
      ].some(
        ([min, max]) =>
          typeof field[min] === "number" &&
          typeof field[max] === "number" &&
          (field[min] as number) > (field[max] as number),
      )
    )
      return null;
    if (
      type === "array" &&
      typeof field.minItems === "number" &&
      field.minItems > (asRecord(field.items)?.enum as unknown[]).length
    )
      return null;
    if (type === "array" && (field.minItems === undefined || field.minItems === 0))
      options.push({
        id: EMPTY_OPTION,
        label: t("Empty selection"),
        literal: true,
      });
    const isRequired = required.includes(key);
    if (!isRequired) options.push({ id: OMIT_OPTION, label: t("Leave blank"), literal: true });
    const constraints =
      type === "integer" ? t("Whole number") : type === "number" ? t("Number") : undefined;
    const bounds = [
      ["minLength", "Minimum length"],
      ["maxLength", "Maximum length"],
      ["minimum", "Minimum"],
      ["maximum", "Maximum"],
      ["minItems", "Minimum selections"],
      ["maxItems", "Maximum selections"],
    ].flatMap(([name, title]) =>
      field[name] !== undefined ? [t("{p0}: {p1}", { p0: t(title), p1: field[name] })] : [],
    );
    const id = `mcp_field_${index}`;
    fields.push({ key, id, schema: field, required: isRequired });
    questions.push({
      id,
      header: label,
      prompt: [label, stringField(field, "description"), constraints, ...bounds]
        .filter(Boolean)
        .join(" — "),
      multiSelect: type === "array",
      ...(type === "string" && !Array.isArray(field.enum)
        ? { preserveCustomWhitespace: true }
        : {}),
      allowCustom,
      options,
    });
  }
  return {
    title: `${stringField(rec, "serverName") ?? "MCP"}: ${stringField(rec, "message") ?? t("Complete form")}`,
    fields,
    questions,
  };
}
export function codexMcpFormResponse(
  form: CodexMcpForm,
  reply: UserQuestionReply,
): {
  action: "accept" | "cancel";
  content: Record<string, FormValue> | null;
  _meta: null;
} {
  if (reply.kind === "skipped") return { action: "cancel", content: null, _meta: null };
  const entries: [string, FormValue][] = [];
  for (const field of form.fields) {
    const question = form.questions.find((item) => item.id === field.id)!;
    const selected = reply.answers[field.id] ?? [];
    if (
      selected.some(
        (id) =>
          id !== OMIT_OPTION &&
          id !== "__custom__" &&
          !question.options.some((option) => option.id === id),
      )
    )
      throw new Error(t("{p0}: choose a listed option.", { p0: question.header }));
    if (selected.includes(OMIT_OPTION)) {
      if (field.required || selected.length !== 1)
        throw new Error(t("{p0}: choose a value or leave blank.", { p0: question.header }));
      continue;
    }
    const schema = field.schema;
    const isLiteral =
      schema.type === "boolean" || schema.type === "array" || Array.isArray(schema.enum);
    const answers = isLiteral
      ? selected
      : selected.includes(EMPTY_OPTION)
        ? [""]
        : selectedAnswerLabels(question, reply);
    if (!answers.length) {
      if (field.required) throw new Error(t("{p0}: a value is required.", { p0: question.header }));
      continue;
    }
    let value: FormValue;
    if (schema.type === "array") {
      if (selected.includes(EMPTY_OPTION)) {
        if (selected.length !== 1)
          throw new Error(t("{p0}: choose a value or leave blank.", { p0: question.header }));
        entries.push([field.key, []]);
        continue;
      }
      const values = (asRecord(schema.items)?.enum ?? []) as string[];
      value = selected.map((id) => values[Number(id.replace("value_", ""))]);
      if (
        value.some((item) => typeof item !== "string") ||
        new Set(value).size !== value.length ||
        (typeof schema.minItems === "number" && value.length < schema.minItems) ||
        (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      )
        throw new Error(t("{p0}: check the number of selections.", { p0: question.header }));
    } else {
      if (answers.length !== 1)
        throw new Error(t("{p0}: provide one value.", { p0: question.header }));
      if (schema.type === "boolean") {
        if (selected.length !== 1 || !["true", "false"].includes(selected[0]))
          throw new Error(t("{p0}: choose Yes or No.", { p0: question.header }));
        value = selected[0] === "true";
      } else if (schema.type === "number" || schema.type === "integer") {
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(answers[0]))
          throw new Error(t("{p0}: enter a number.", { p0: question.header }));
        value = Number(answers[0]);
        if (
          !Number.isFinite(value) ||
          (schema.type === "integer" && !Number.isSafeInteger(value)) ||
          (typeof schema.minimum === "number" && value < schema.minimum) ||
          (typeof schema.maximum === "number" && value > schema.maximum)
        )
          throw new Error(t("{p0}: check the numeric bounds.", { p0: question.header }));
      } else {
        value = Array.isArray(schema.enum)
          ? (schema.enum[Number(selected[0]?.replace("value_", ""))] as string)
          : answers[0];
        if (
          typeof value !== "string" ||
          (typeof schema.minLength === "number" && [...value].length < schema.minLength) ||
          (typeof schema.maxLength === "number" && [...value].length > schema.maxLength)
        )
          throw new Error(t("{p0}: check the text length.", { p0: question.header }));
      }
    }
    entries.push([field.key, value]);
  }
  return {
    action: "accept",
    content: Object.fromEntries(entries),
    _meta: null,
  };
}
