import { createServerFn } from "@tanstack/react-start";

import { demoContext } from "./demo-context";

export type AgentInput = {
  id?: string | null;
  name: string;
  description?: string | null;
  system_prompt: string;
  model: string;
  tools: string[];
  delegation_enabled: boolean;
  max_delegation_depth: number;
};

export const listAgents = createServerFn({ method: "GET" })
  .middleware([demoContext])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("agents")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveAgent = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: AgentInput) => {
    if (!input?.name?.trim()) throw new Error("Agent name is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name.trim(),
      description: data.description ?? null,
      system_prompt: data.system_prompt ?? "",
      model: data.model || "google/gemini-2.5-flash",
      tools: data.tools ?? [],
      delegation_enabled: Boolean(data.delegation_enabled),
      max_delegation_depth: Math.max(0, Math.min(3, Number(data.max_delegation_depth) || 1)),
    };

    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("agents")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return updated;
    }

    const { data: inserted, error } = await context.supabase
      .from("agents")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const deleteAgent = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("agents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  });

export const listMemories = createServerFn({ method: "GET" })
  .middleware([demoContext])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("agent_memories")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
