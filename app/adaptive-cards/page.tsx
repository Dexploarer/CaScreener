"use client";

import { AdaptiveCardRenderer } from "@/lib/integrations/adaptive-cards/renderer";

const SAMPLE_CARD = {
  type: "AdaptiveCard" as const,
  version: "1.5",
  body: [
    {
      type: "TextBlock",
      text: "Contact Form",
      size: "large",
      weight: "bolder",
    },
    {
      type: "Input.Text",
      id: "name",
      label: "Your Name",
      placeholder: "Enter your name",
    },
    {
      type: "Input.Text",
      id: "message",
      label: "Message",
      placeholder: "Enter your message",
      isMultiline: true,
    },
  ],
  actions: [
    {
      type: "Action.Submit",
      title: "Send",
      data: { action: "submitForm" },
    },
    {
      type: "Action.OpenUrl",
      title: "Learn More",
      url: "https://adaptivecards.io",
    },
  ],
};

export default function AdaptiveCardsPage() {
  const handleAction = (
    action: Record<string, unknown>,
    inputData: Record<string, string>
  ) => {
    console.log("Adaptive Card action:", action, "inputs:", inputData);
  };

  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold text-zinc-100 mb-2">
        Adaptive Cards Integration
      </h1>
      <p className="text-zinc-400 mb-6">
        Microsoft Adaptive Cards: platform-agnostic UI snippets with body and
        actions.
      </p>
      <div className="max-w-md">
        <AdaptiveCardRenderer card={SAMPLE_CARD} onAction={handleAction} />
      </div>
    </main>
  );
}
