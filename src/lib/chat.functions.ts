import { createServerFn } from "@tanstack/react-start";

import { demoContext } from "./demo-context";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const sendChat = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { messages: ChatTurn[]; agentId?: string | null }) => {
    if (!Array.isArray(input?.messages) || input.messages.length === 0) {
      throw new Error("At least one message is required");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { runOrchestrator } = await import("./agent-runtime.server");
    try {
      return await runOrchestrator({
        supabase: context.supabase,
        userId: context.userId,
        messages: data.messages.slice(-20),
        agentId: data.agentId ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { reply: `The assistant could not complete this request: ${message}`, trace: [] };
    }
  });
