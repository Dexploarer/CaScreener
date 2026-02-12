"use client";

import { useMemo } from "react";
import { operationToSpec } from "@/lib/integrations/openapi/openapi-to-spec";
import { OpenAPIForm } from "@/lib/integrations/openapi/openapi-form";

const CREATE_USER_SCHEMA = {
  type: "object",
  required: ["email", "name"],
  properties: {
    name: {
      type: "string",
      description: "User's full name",
      minLength: 1,
      maxLength: 100,
    },
    email: {
      type: "string",
      format: "email",
      description: "User's email address",
    },
    age: {
      type: "integer",
      minimum: 0,
      maximum: 150,
      description: "User's age",
    },
    role: {
      type: "string",
      enum: ["admin", "user", "guest"],
      default: "user",
      description: "User's role",
    },
  },
};

export default function OpenAPIPage() {
  const spec = useMemo(
    () =>
      operationToSpec(
        "createUser",
        "POST",
        "/api/users",
        CREATE_USER_SCHEMA as Parameters<typeof operationToSpec>[3],
        "Create User",
        "Add a new user to the system"
      ),
    []
  );

  const handleSubmit = async (data: Record<string, unknown>) => {
    console.log("OpenAPI form submit:", data);
  };

  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-100 mb-2">
        OpenAPI Integration
      </h1>
      <p className="text-zinc-400 mb-6">
        Generate forms from OpenAPI/Swagger request body schemas. Type-aware
        fields (string, number, boolean, enum).
      </p>
      <div className="max-w-md">
        <OpenAPIForm spec={spec} onSubmit={handleSubmit} />
      </div>
    </main>
  );
}
