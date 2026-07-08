import { isRecord } from "../shared/models";
import type { SourceDiagnostic } from "./textStructuredTypes";

export function jsonSchemaDiagnostics(
  value: unknown,
  schemaContent: string,
  enabled: boolean,
): SourceDiagnostic[] {
  if (!enabled || !schemaContent.trim()) return [];
  let schema: unknown;
  try {
    schema = JSON.parse(schemaContent);
  } catch (error) {
    return [
      {
        path: "schema",
        message: error instanceof Error ? error.message : "Invalid JSON Schema",
      },
    ];
  }
  if (value === undefined) return [];
  return validateJsonSchemaValue(value, schema, "$");
}

function validateJsonSchemaValue(
  value: unknown,
  schema: unknown,
  path: string,
): SourceDiagnostic[] {
  if (!isRecord(schema)) return [];
  const diagnostics: SourceDiagnostic[] = [];
  const expectedTypes = jsonSchemaTypes(schema.type);
  if (expectedTypes.length > 0 && !expectedTypes.some((type) => jsonValueMatchesType(value, type))) {
    diagnostics.push({
      path,
      message: `Expected ${expectedTypes.join(" or ")}, got ${jsonValueType(value)}.`,
    });
    return diagnostics;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => stableJsonLike(item) === stableJsonLike(value))) {
    diagnostics.push({ path, message: "Value is not in schema enum." });
  }
  if ("const" in schema && stableJsonLike(schema.const) !== stableJsonLike(value)) {
    diagnostics.push({ path, message: "Value does not match schema const." });
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];
    required.forEach((key) => {
      if (!(key in value)) diagnostics.push({ path: `${path}.${key}`, message: "Required key is missing." });
    });
    if (isRecord(schema.properties)) {
      Object.entries(schema.properties).forEach(([key, propertySchema]) => {
        if (key in value) {
          diagnostics.push(
            ...validateJsonSchemaValue(value[key], propertySchema, `${path}.${key}`),
          );
        }
      });
    }
    if (schema.additionalProperties === false && isRecord(schema.properties)) {
      const properties = schema.properties;
      Object.keys(value).forEach((key) => {
        if (!(key in properties)) {
          diagnostics.push({
            path: `${path}.${key}`,
            message: "Additional property is not allowed.",
          });
        }
      });
    }
  }

  if (Array.isArray(value) && schema.items) {
    const minItems = jsonSchemaNumber(schema.minItems);
    const maxItems = jsonSchemaNumber(schema.maxItems);
    if (minItems !== undefined && value.length < minItems) {
      diagnostics.push({ path, message: `Expected at least ${minItems} items.` });
    }
    if (maxItems !== undefined && value.length > maxItems) {
      diagnostics.push({ path, message: `Expected at most ${maxItems} items.` });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      value.forEach((item, index) => {
        const key = stableJsonLike(item);
        if (seen.has(key)) {
          diagnostics.push({
            path: `${path}[${index}]`,
            message: "Array item is not unique.",
          });
        }
        seen.add(key);
      });
    }
    value.forEach((item, index) => {
      diagnostics.push(
        ...validateJsonSchemaValue(item, schema.items, `${path}[${index}]`),
      );
    });
  }

  if (typeof value === "string") {
    const minLength = jsonSchemaNumber(schema.minLength);
    const maxLength = jsonSchemaNumber(schema.maxLength);
    if (minLength !== undefined && value.length < minLength) {
      diagnostics.push({ path, message: `Expected at least ${minLength} characters.` });
    }
    if (maxLength !== undefined && value.length > maxLength) {
      diagnostics.push({ path, message: `Expected at most ${maxLength} characters.` });
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          diagnostics.push({ path, message: "String does not match schema pattern." });
        }
      } catch {
        diagnostics.push({ path: "schema.pattern", message: "Invalid schema pattern." });
      }
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const minimum = jsonSchemaNumber(schema.minimum);
    const maximum = jsonSchemaNumber(schema.maximum);
    const exclusiveMinimum = jsonSchemaNumber(schema.exclusiveMinimum);
    const exclusiveMaximum = jsonSchemaNumber(schema.exclusiveMaximum);
    if (minimum !== undefined && value < minimum) {
      diagnostics.push({ path, message: `Expected value >= ${minimum}.` });
    }
    if (maximum !== undefined && value > maximum) {
      diagnostics.push({ path, message: `Expected value <= ${maximum}.` });
    }
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum) {
      diagnostics.push({ path, message: `Expected value > ${exclusiveMinimum}.` });
    }
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum) {
      diagnostics.push({ path, message: `Expected value < ${exclusiveMaximum}.` });
    }
  }

  return diagnostics;
}

function jsonSchemaTypes(value: unknown) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function jsonValueMatchesType(value: unknown, type: string) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function jsonValueType(value: unknown) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function stableJsonLike(value: unknown) {
  return JSON.stringify(value);
}

function jsonSchemaNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
