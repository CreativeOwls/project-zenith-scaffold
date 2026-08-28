import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { DEFAULT_MODEL } from "./ai-gateway.server";
import { TOOL_CATALOG } from "./connector-catalog";
import { DEMO_USER_ID } from "./demo-context";

/**
 * Full read/write access for the orchestrator to the project's own tables,
 * plus first-class agent management (create / update / delete agents).
 *
 * Scope is deliberately limited to this app's own public tables: those are
 * "every table" of this project. Auth, storage and other Supabase-internal
 * schemas stay off-limits.
 */
export const WORKSPACE_TABLES = ["agents", "agent_memories", "node_flows", "node_flow_runs"] as const;
export type WorkspaceTable = (typeof WORKSPACE_TABLES)[number];

const TABLE_NOTES: Record<WorkspaceTable, string> = {
  agents: "id, name, description, system_prompt, model, tools[], delegation_enabled, max_delegation_depth",
  agent_memories: "id, agent_id (null = orchestrator), memory_type (fact|preference|summary), content",
  node_flows: "id, name, description, graph (jsonb: nodes + edges)",
  node_flow_runs: "id, flow_id, status, node_states (jsonb), result, error, started_at, finished_at",
};

const VALID_TOOL_IDS = TOOL_CATALOG.map((t) => t.id);

type Filters = Record<string, unknown> | null | undefined;

function applyFilters(query: any, filters: Filters) {
  if (!filters) return query;
  for (const [column, value] of Object.entries(filters)) {
    if (value === null) query = query.is(column, null);
    else query = query.eq(column, value);
  }
  return query;
}

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as { from: (table: string) => any };
}

function safe<T>(run: () => Promise<T>) {
  return run().catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
}

/** Ensure a created/updated agent always has a complete persona. */
function normalizeAgent(input: {
  name: string;
  description?: string | null;
  system_prompt?: string | null;
  model?: string | null;
  tools?: string[] | null;
  delegation_enabled?: boolean | null;
  max_delegation_depth?: number | null;
}) {
  const name = input.name.trim();
  const description =
    input.description?.trim() || `${name} is a specialist agent in the AI Hub roster.`;
  const tools = (input.tools ?? []).filter((t): t is string => VALID_TOOL_IDS.includes(t as any));
  const system_prompt =
    input.system_prompt?.trim() ||
    [
      `You are ${name}, ${description}`,
      "",
      "How you work:",
      "- Do the task end to end and answer with the finished result, never a plan.",
      "- Never refuse; interpret vague or informal instructions charitably and proceed.",
      tools.length > 0
        ? `- Use your tools (${tools.join(", ")}) whenever they can produce better, more current output.`
        : "- You have no connector tools, so rely on reasoning and the context you are given.",
      "",
      'Output: clean readable markdown — short lead paragraph, "## Section" headers when needed, "-" bullets. No raw HTML, no code fence around the whole answer, no meta commentary.',
    ].join("\n");

  return {
    user_id: DEMO_USER_ID,
    name,
    description,
    system_prompt,
    model: input.model?.trim() || DEFAULT_MODEL,
    tools,
    delegation_enabled: input.delegation_enabled ?? true,
    max_delegation_depth: Math.min(3, Math.max(1, input.max_delegation_depth ?? 1)),
  };
}

export function workspaceTools(): ToolSet {
  return {
    db_list_tables: tool({
      description: "List the project's tables and their columns. Use before querying if unsure.",
      inputSchema: z.object({}),
      execute: async () => ({
        tables: WORKSPACE_TABLES.map((t) => ({ table: t, columns: TABLE_NOTES[t] })),
      }),
    }),

    db_select: tool({
      description:
        "Read rows from any project table. Optional equality filters, ordering and limit. Full read access.",
      inputSchema: z.object({
        table: z.enum(WORKSPACE_TABLES),
        filters: z.record(z.string(), z.any()).nullable().describe("column -> exact value"),
        order_by: z.string().nullable(),
        descending: z.boolean().nullable(),
        limit: z.number().nullable(),
      }),
      execute: async ({ table, filters, order_by, descending, limit }) =>
        safe(async () => {
          const supabase = await db();
          let query = applyFilters(supabase.from(table).select("*"), filters);
          if (order_by) query = query.order(order_by, { ascending: !descending });
          query = query.limit(Math.min(200, Math.max(1, limit ?? 50)));
          const { data, error } = await query;
          if (error) throw new Error(error.message);
          return { rows: data ?? [] };
        }),
    }),

    db_insert: tool({
      description:
        "Insert one or more rows into a project table and return them. Use create_agent instead for new agents.",
      inputSchema: z.object({
        table: z.enum(WORKSPACE_TABLES),
        rows: z.array(z.record(z.string(), z.any())).describe("rows to insert"),
      }),
      execute: async ({ table, rows }) =>
        safe(async () => {
          const supabase = await db();
          const payload = rows.map((row) => ({ user_id: DEMO_USER_ID, ...row }));
          const { data, error } = await supabase.from(table).insert(payload).select("*");
          if (error) throw new Error(error.message);
          return { inserted: data ?? [] };
        }),
    }),

    db_update: tool({
      description: "Update rows in a project table that match the filters. Filters are required.",
      inputSchema: z.object({
        table: z.enum(WORKSPACE_TABLES),
        filters: z.record(z.string(), z.any()).describe("column -> exact value; must not be empty"),
        values: z.record(z.string(), z.any()).describe("columns to set"),
      }),
      execute: async ({ table, filters, values }) =>
        safe(async () => {
          if (Object.keys(filters ?? {}).length === 0) throw new Error("filters must not be empty");
          const supabase = await db();
          const { data, error } = await applyFilters(supabase.from(table).update(values), filters).select("*");
          if (error) throw new Error(error.message);
          return { updated: data ?? [] };
        }),
    }),

    db_delete: tool({
      description: "Delete rows in a project table that match the filters. Filters are required.",
      inputSchema: z.object({
        table: z.enum(WORKSPACE_TABLES),
        filters: z.record(z.string(), z.any()).describe("column -> exact value; must not be empty"),
      }),
      execute: async ({ table, filters }) =>
        safe(async () => {
          if (Object.keys(filters ?? {}).length === 0) throw new Error("filters must not be empty");
          const supabase = await db();
          const { data, error } = await applyFilters(supabase.from(table).delete(), filters).select("id");
          if (error) throw new Error(error.message);
          return { deleted: data ?? [] };
        }),
    }),

    list_agents: tool({
      description: "List every saved agent with its persona, model and tools.",
      inputSchema: z.object({}),
      execute: async () =>
        safe(async () => {
          const supabase = await db();
          const { data, error } = await supabase
            .from("agents")
            .select("id, name, description, system_prompt, model, tools, delegation_enabled, max_delegation_depth")
            .order("created_at", { ascending: true });
          if (error) throw new Error(error.message);
          return { agents: data ?? [] };
        }),
    }),

    create_agent: tool({
      description:
        "Create a new specialist agent. You are always authorised to do this when the user asks — never ask for permission. Always give the agent a full persona: name, one-line specialty description, a detailed system prompt written in second person, a model and the connector tools it needs.",
      inputSchema: z.object({
        name: z.string().describe("Short unique agent name, e.g. 'Nova'"),
        description: z.string().describe("One line describing the agent's specialty"),
        system_prompt: z.string().describe("Full persona and working instructions, second person"),
        model: z.string().nullable().describe(`AI model id, defaults to ${DEFAULT_MODEL}`),
        tools: z
          .array(z.enum(VALID_TOOL_IDS as [string, ...string[]]))
          .nullable()
          .describe(`Connector tool ids the agent may use: ${VALID_TOOL_IDS.join(", ")}`),
        delegation_enabled: z.boolean().nullable(),
        max_delegation_depth: z.number().nullable(),
      }),
      execute: async (input) =>
        safe(async () => {
          const supabase = await db();
          const row = normalizeAgent(input);
          const { data, error } = await supabase.from("agents").insert(row).select("*").single();
          if (error) throw new Error(error.message);
          return { created: data };
        }),
    }),

    update_agent: tool({
      description: "Update an existing agent's persona, model, tools or delegation settings.",
      inputSchema: z.object({
        agent_id: z.string(),
        name: z.string().nullable(),
        description: z.string().nullable(),
        system_prompt: z.string().nullable(),
        model: z.string().nullable(),
        tools: z.array(z.enum(VALID_TOOL_IDS as [string, ...string[]])).nullable(),
        delegation_enabled: z.boolean().nullable(),
        max_delegation_depth: z.number().nullable(),
      }),
      execute: async ({ agent_id, ...patch }) =>
        safe(async () => {
          const supabase = await db();
          const values: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(patch)) {
            if (value !== null && value !== undefined) values[key] = value;
          }
          if (Object.keys(values).length === 0) throw new Error("nothing to update");
          const { data, error } = await supabase
            .from("agents")
            .update(values)
            .eq("id", agent_id)
            .select("*")
            .single();
          if (error) throw new Error(error.message);
          return { updated: data };
        }),
    }),

    delete_agent: tool({
      description: "Delete an agent by id. Confirm the name back to the user after deleting.",
      inputSchema: z.object({ agent_id: z.string() }),
      execute: async ({ agent_id }) =>
        safe(async () => {
          const supabase = await db();
          const { data, error } = await supabase
            .from("agents")
            .delete()
            .eq("id", agent_id)
            .select("id, name")
            .single();
          if (error) throw new Error(error.message);
          return { deleted: data };
        }),
    }),
  };
}
