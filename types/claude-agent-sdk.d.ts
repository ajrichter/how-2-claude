/**
 * Type declarations for the Claude Agent SDK.
 *
 * These are minimal type stubs so the project type-checks without
 * the full SDK installed. Replace with the real SDK types when available.
 */
declare module "@anthropic-ai/claude-agent-sdk" {
  interface QueryOptions {
    maxTurns?: number;
    systemPrompt?: string;
  }

  interface QueryParams {
    prompt: string;
    options?: QueryOptions;
  }

  interface TextBlock {
    type: "text";
    text: string;
  }

  interface ToolUseBlock {
    type: "tool_use";
    [key: string]: unknown;
  }

  type ContentBlock = TextBlock | ToolUseBlock;

  interface Message {
    content: ContentBlock[];
  }

  interface AssistantEvent {
    type: "assistant";
    message?: Message;
  }

  interface OtherEvent {
    type: string;
    message?: Message;
  }

  type StreamEvent = AssistantEvent | OtherEvent;

  function query(params: QueryParams): AsyncIterable<StreamEvent>;
}
