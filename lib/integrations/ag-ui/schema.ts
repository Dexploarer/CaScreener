import { z } from "zod";

const BaseEvent = z.object({
  type: z.string(),
  timestamp: z.number().optional(),
});

export const TextMessageStart = BaseEvent.extend({
  type: z.literal("TEXT_MESSAGE_START"),
  messageId: z.string(),
  role: z.enum(["user", "assistant"]),
});

export const TextMessageContent = BaseEvent.extend({
  type: z.literal("TEXT_MESSAGE_CONTENT"),
  messageId: z.string(),
  delta: z.string(),
});

export const TextMessageEnd = BaseEvent.extend({
  type: z.literal("TEXT_MESSAGE_END"),
  messageId: z.string(),
});

export const ToolCallStart = BaseEvent.extend({
  type: z.literal("TOOL_CALL_START"),
  toolCallId: z.string(),
  toolCallName: z.string(),
  parentMessageId: z.string().optional(),
});

export const ToolCallArgs = BaseEvent.extend({
  type: z.literal("TOOL_CALL_ARGS"),
  toolCallId: z.string(),
  delta: z.string(),
});

export const ToolCallEnd = BaseEvent.extend({
  type: z.literal("TOOL_CALL_END"),
  toolCallId: z.string(),
});

export const StateSnapshot = BaseEvent.extend({
  type: z.literal("STATE_SNAPSHOT"),
  snapshot: z.record(z.string(), z.unknown()),
});

export const RunStarted = BaseEvent.extend({
  type: z.literal("RUN_STARTED"),
  threadId: z.string(),
  runId: z.string(),
});

export const RunFinished = BaseEvent.extend({
  type: z.literal("RUN_FINISHED"),
});

export const RunError = BaseEvent.extend({
  type: z.literal("RUN_ERROR"),
  message: z.string(),
  code: z.string().optional(),
});

export const CustomEvent = BaseEvent.extend({
  type: z.literal("CUSTOM"),
  name: z.string(),
  value: z.unknown(),
});

export const AGUIEvent = z.discriminatedUnion("type", [
  TextMessageStart,
  TextMessageContent,
  TextMessageEnd,
  ToolCallStart,
  ToolCallArgs,
  ToolCallEnd,
  StateSnapshot,
  RunStarted,
  RunFinished,
  RunError,
  CustomEvent,
]);

export type AGUIEventType = z.infer<typeof AGUIEvent>;
