"use client";

import React, { useState } from "react";

type AdaptiveCard = {
  type: "AdaptiveCard";
  version?: string;
  body?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
};

function TextBlock({ text, size, weight }: { text?: string; size?: string; weight?: string }) {
  const sizeClass = size === "large" ? "text-xl" : size === "medium" ? "text-lg" : "";
  const weightClass = weight === "bolder" ? "font-bold" : "";
  return (
    <p className={`text-zinc-100 ${sizeClass} ${weightClass}`}>
      {text ?? ""}
    </p>
  );
}

function Container({
  items,
  renderBody,
}: {
  items: Array<Record<string, unknown>>;
  renderBody: (body: Array<Record<string, unknown>>) => React.ReactNode;
}) {
  return <div className="space-y-2">{renderBody(items)}</div>;
}

function InputText({
  id,
  label,
  placeholder,
  value: initialValue,
  onChange,
}: {
  id: string;
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (id: string, value: string) => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  return (
    <label className="block text-sm text-zinc-400">
      {label}
      <input
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(id, e.target.value);
        }}
        placeholder={placeholder}
        className="mt-1 w-full border border-zinc-600 rounded-lg bg-zinc-900 px-3 py-2 text-zinc-100"
      />
    </label>
  );
}

function ActionSubmit({
  title,
  data,
  onSubmit,
}: {
  title?: string;
  data?: unknown;
  onSubmit?: (data: unknown, inputs: Record<string, string>) => void;
}) {
  return (
    <button
      type="button"
      className="px-4 py-2 bg-emerald-600 text-white rounded-lg"
      onClick={() => onSubmit?.(data, {})}
    >
      {title ?? "Submit"}
    </button>
  );
}

function ActionOpenUrl({ title, url }: { title?: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="px-4 py-2 border border-zinc-600 rounded-lg text-zinc-300 hover:bg-zinc-800"
    >
      {title ?? url}
    </a>
  );
}

export function AdaptiveCardRenderer({
  card,
  onAction,
  inputValues,
  onInputChange,
}: {
  card: AdaptiveCard;
  onAction?: (action: Record<string, unknown>, inputData: Record<string, string>) => void;
  inputValues?: Record<string, string>;
  onInputChange?: (id: string, value: string) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>(inputValues ?? {});

  const handleInputChange = (id: string, value: string) => {
    setInputs((prev) => ({ ...prev, [id]: value }));
    onInputChange?.(id, value);
  };

  function renderBody(body: Array<Record<string, unknown>>): React.ReactNode {
    return body.map((el, i) => {
      const type = el.type as string;
      if (type === "TextBlock") {
        return <TextBlock key={i} text={el.text as string} size={el.size as string} weight={el.weight as string} />;
      }
      if (type === "Container") {
        return (
          <Container
            key={i}
            items={(el.items as Array<Record<string, unknown>>) ?? []}
            renderBody={renderBody}
          />
        );
      }
      if (type === "Input.Text") {
        return (
          <InputText
            key={i}
            id={el.id as string}
            label={el.label as string}
            placeholder={el.placeholder as string}
            value={inputs[el.id as string]}
            onChange={handleInputChange}
          />
        );
      }
      return null;
    });
  }

  const body = card.body ?? [];
  const actions = card.actions ?? [];

  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-6 space-y-4">
      <div className="space-y-3">{renderBody(body)}</div>
      <div className="flex gap-2 pt-2">
        {actions.map((action, i) => {
          const atype = action.type as string;
          if (atype === "Action.Submit") {
            return (
              <ActionSubmit
                key={i}
                title={action.title as string}
                data={action.data}
                onSubmit={(data) => onAction?.(action, inputs)}
              />
            );
          }
          if (atype === "Action.OpenUrl") {
            return (
              <ActionOpenUrl
                key={i}
                title={action.title as string}
                url={action.url as string}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
