import { createServerFn } from "@tanstack/react-start";

import { demoContext } from "./demo-context";
import type { FlowGraph } from "./flow-types";

export type SaveFlowInput = {
  id?: string | null;
  name: string;
  description?: string | null;
  nodes: FlowGraph["nodes"];
  connections: FlowGraph["connections"];
};

export const listFlows = createServerFn({ method: "GET" })
  .middleware([demoContext])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("node_flows")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveFlow = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: SaveFlowInput) => {
    if (!input?.name?.trim()) throw new Error("Flow name is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const row = {
      user_id: context.userId,
      name: data.name.trim(),
      description: data.description ?? null,
      nodes: data.nodes ?? [],
      connections: data.connections ?? [],
    };

    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("node_flows")
        .update(row)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return updated;
    }

    const { data: inserted, error } = await context.supabase
      .from("node_flows")
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const deleteFlow = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("node_flows").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  });

export const createFlowRun = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { flowId?: string | null; graph: FlowGraph }) => {
    if (!input?.graph?.nodes?.length) throw new Error("The flow has no nodes to run");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("node_flow_runs")
      .insert({
        flow_id: data.flowId ?? null,
        user_id: context.userId,
        status: "running",
        node_statuses: Object.fromEntries(data.graph.nodes.map((n) => [n.id, "idle"])),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { runId: run.id as string };
  });

export const startFlowRun = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { runId: string; graph: FlowGraph; input?: string }) => {
    if (!input?.runId) throw new Error("Missing run id");
    if (!input?.graph?.nodes?.length) throw new Error("The flow has no nodes to run");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { executeFlow } = await import("./flow-engine.server");
    try {
      await executeFlow({
        supabase: context.supabase,
        userId: context.userId,
        graph: data.graph,
        runId: data.runId,
        input: data.input ?? "",
      });
    } catch (error_) {
      return {
        runId: data.runId,
        error: error_ instanceof Error ? error_.message : String(error_),
      };
    }
    return { runId: data.runId, error: null };
  });


export const getFlowRun = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { runId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("node_flow_runs")
      .select("*")
      .eq("id", data.runId)
      .single();
    if (error) throw new Error(error.message);
    return run;
  });

export const generateFlow = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { request: string }) => {
    if (!input?.request?.trim()) throw new Error("Describe the automation you want");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: agents } = await context.supabase
      .from("agents")
      .select("id, name, description, tools");

    const { buildFlowFromPrompt } = await import("./flow-prompter.server");
    try {
      return await buildFlowFromPrompt({
        request: data.request,
        agents: (agents ?? []) as { id: string; name: string; description: string | null; tools: string[] }[],
      });
    } catch (error) {
      return {
        name: "",
        description: "",
        graph: { nodes: [], connections: [] },
        validation: {
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [] as string[],
        },
      };
    }
  });
