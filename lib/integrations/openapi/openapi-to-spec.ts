/**
 * Converts an OpenAPI-style JSON Schema (request body) into a flat json-render spec
 * for the built-in schema (root + elements).
 */

export type OpenAPISchema = {
  type?: string;
  required?: string[];
  properties?: Record<string, OpenAPIProperty>;
  description?: string;
};

export type OpenAPIProperty = {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
};

export interface OperationSpec {
  operationId: string;
  method: string;
  path: string;
  title: string;
  description?: string;
  root: string;
  elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }>;
}

const ELEMENT_IDS = new Map<string, number>();

function nextId(prefix: string): string {
  const n = (ELEMENT_IDS.get(prefix) ?? 0) + 1;
  ELEMENT_IDS.set(prefix, n);
  return `${prefix}-${n}`;
}

function propertyToElement(
  name: string,
  prop: OpenAPIProperty,
  required: boolean,
  pathPrefix: string
): { id: string; type: string; props: Record<string, unknown>; children: string[] } {
  const valuePath = `${pathPrefix}/${name}`;
  const id = nextId(name);

  if (prop.type === "integer" || prop.type === "number") {
    return {
      id,
      type: "NumberField",
      props: {
        name,
        label: prop.description ?? name,
        required: required ?? false,
        minimum: prop.minimum,
        maximum: prop.maximum,
        defaultValue: prop.default,
      },
      children: [],
    };
  }

  if (prop.type === "boolean") {
    return {
      id,
      type: "BooleanField",
      props: {
        name,
        label: prop.description ?? name,
        defaultValue: prop.default,
      },
      children: [],
    };
  }

  if (prop.enum) {
    return {
      id,
      type: "EnumField",
      props: {
        name,
        label: prop.description ?? name,
        required: required ?? false,
        options: prop.enum.map((v) => ({ value: v, label: v })),
        defaultValue: prop.default,
      },
      children: [],
    };
  }

  return {
    id,
    type: "StringField",
    props: {
      name,
      label: prop.description ?? name,
      required: required ?? false,
      format: prop.format ?? "text",
      minLength: prop.minLength,
      maxLength: prop.maxLength,
      placeholder: prop.description ?? name,
      defaultValue: prop.default,
    },
    children: [],
  };
}

export function operationToSpec(
  operationId: string,
  method: string,
  path: string,
  schema: OpenAPISchema,
  title: string,
  description?: string
): OperationSpec {
  ELEMENT_IDS.clear();
  const required = new Set(schema.required ?? []);
  const properties = schema.properties ?? {};
  const elementIds: string[] = [];
  const elements: Record<string, { type: string; props: Record<string, unknown>; children: string[] }> = {};

  for (const [name, prop] of Object.entries(properties)) {
    const el = propertyToElement(name, prop as OpenAPIProperty, required.has(name), "/form");
    elements[el.id] = { type: el.type, props: el.props, children: [] };
    elementIds.push(el.id);
  }

  const formId = nextId("form");
  elements[formId] = {
    type: "Form",
    props: {
      operationId,
      endpoint: path,
      method,
      title,
      description,
    },
    children: elementIds,
  };

  return {
    operationId,
    method,
    path,
    title,
    description,
    root: formId,
    elements,
  };
}
