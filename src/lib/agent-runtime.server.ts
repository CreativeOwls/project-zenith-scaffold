import { generateText, stepCountIs, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";

import { DEFAULT_MODEL, createLovableAiGatewayProvider, getLovableApiKey } from "./ai-gateway.server";
import { runConnectorAction } from "./connectors.server";
import { workspaceTools } from "./workspace-tools.server";

export type AgentRow = {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model: string;
  tools: string[];
  delegation_enabled: boolean;
  max_delegation_depth: number;
};

type SupabaseLike = {
  from: (table: string) => any;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type DelegationTrace = {
  agentId: string;
  agentName: string;
  model?: string;
  depth: number;
  request: string;
  reply: string;
};

function connectorTool(action: string, description: string, shape: z.ZodRawShape) {
  return tool({
    description,
    inputSchema: z.object(shape),
    execute: async (input) => {
      try {
        return await runConnectorAction(action, input as Record<string, unknown>);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}

const TOOLS_BY_ID: Record<string, () => ToolSet> = {
  gmail: () => ({
    gmail_search: connectorTool("gmail_search", "Search the connected Gmail inbox.", {
      query: z.string().describe("Gmail search query, e.g. 'is:unread from:boss@acme.com'"),
      limit: z.number().nullable(),
    }),
    gmail_read_message: connectorTool("gmail_read_message", "Read one Gmail message by id.", {
      messageId: z.string(),
    }),
    gmail_send: connectorTool(
      "gmail_send",
      "Send an email from the connected Gmail account. Write the body as simple markdown with a short intro, '## Section' headers and '-' bullets — it is converted to a formatted, readable email automatically, so never hand-format with stars or pound signs for emphasis.",
      {
        to: z.string(),
        subject: z.string(),
        body: z.string(),
      },
    ),
  }),
  google_slides: () => ({
    slides_create: connectorTool("slides_create", "Create a new Google Slides presentation.", {
      title: z.string(),
    }),
    slides_read: connectorTool("slides_read", "Read the slides and text of a presentation.", {
      presentationId: z.string(),
    }),
    slides_add_slide: connectorTool("slides_add_slide", "Append a title+body slide to a presentation.", {
      presentationId: z.string(),
      title: z.string(),
      body: z.string(),
    }),
  }),
  fhir: () => ({
    fhir_search_patient: connectorTool("fhir_search_patient", "Search FHIR patients by name or identifier.", {
      name: z.string().nullable(),
      identifier: z.string().nullable(),
      limit: z.number().nullable(),
    }),
    fhir_get_patient: connectorTool("fhir_get_patient", "Get one FHIR patient summary.", {
      patientId: z.string(),
    }),
    fhir_get_appointments: connectorTool("fhir_get_appointments", "List a patient's appointments.", {
      patientId: z.string(),
      limit: z.number().nullable(),
    }),
    fhir_get_medications: connectorTool("fhir_get_medications", "List a patient's medication requests.", {
      patientId: z.string(),
      limit: z.number().nullable(),
    }),
    fhir_get_observations: connectorTool("fhir_get_observations", "List a patient's observations.", {
      patientId: z.string(),
      code: z.string().nullable(),
      limit: z.number().nullable(),
    }),
  }),
  reddit: () => ({
    reddit_search_subreddit: connectorTool("reddit_search_subreddit", "Search Reddit, optionally inside one subreddit.", {
      query: z.string(),
      subreddit: z.string().nullable(),
      limit: z.number().nullable(),
    }),
    reddit_get_top_posts: connectorTool("reddit_get_top_posts", "Get top posts of a subreddit.", {
      subreddit: z.string(),
      timeframe: z.string().nullable().describe("hour, day, week, month, year or all"),
      limit: z.number().nullable(),
    }),
    reddit_get_post_comments: connectorTool("reddit_get_post_comments", "Get comments of a Reddit post id.", {
      postId: z.string(),
      limit: z.number().nullable(),
    }),
  }),
  firecrawl: () => ({
    firecrawl_scrape: connectorTool("firecrawl_scrape", "Scrape one URL and return clean markdown.", {
      url: z.string(),
      onlyMainContent: z.boolean().nullable(),
    }),
    firecrawl_search: connectorTool("firecrawl_search", "Search the web and return titles, urls and snippets.", {
      query: z.string(),
      limit: z.number().nullable(),
      scrapeContent: z.boolean().nullable().describe("true to also return page markdown"),
    }),
    firecrawl_map: connectorTool("firecrawl_map", "List the URLs of a website, optionally filtered by keyword.", {
      url: z.string(),
      search: z.string().nullable(),
      limit: z.number().nullable(),
    }),
    firecrawl_crawl: connectorTool("firecrawl_crawl", "Crawl a site and return markdown for each page (small limits only).", {
      url: z.string(),
      limit: z.number().nullable(),
      maxDepth: z.number().nullable(),
    }),
  }),
};

export function toolsForIds(ids: string[]): ToolSet {
  let set: ToolSet = {};
  for (const id of ids) {
    const factory = TOOLS_BY_ID[id];
    if (factory) set = { ...set, ...factory() };
  }
  return set;
}

async function recentMemories(supabase: SupabaseLike, agentId: string | null) {
  const query = supabase
    .from("agent_memories")
    .select("memory_type, content, created_at")
    .order("created_at", { ascending: false })
    .limit(8);
  const { data } = await (agentId ? query.eq("agent_id", agentId) : query.is("agent_id", null));
  const rows = (data ?? []) as { memory_type: string; content: string }[];
  if (rows.length === 0) return "";
  return `\n\nRemembered context from previous conversations:\n${rows
    .map((r) => `- (${r.memory_type}) ${r.content}`)
    .join("\n")}`;
}

async function writeMemory(
  supabase: SupabaseLike,
  userId: string,
  agentId: string | null,
  memoryType: "fact" | "preference" | "summary",
  content: string,
) {
  if (!content.trim()) return;
  await supabase.from("agent_memories").insert({
    agent_id: agentId,
    user_id: userId,
    memory_type: memoryType,
    content: content.slice(0, 1500),
  });
}

/** Run a single saved agent in its own tool-calling loop. Can delegate further. */
async function runSubAgent(params: {
  supabase: SupabaseLike;
  userId: string;
  agents: AgentRow[];
  agent: AgentRow;
  message: string;
  depth: number;
  maxDepth: number;
  trace: DelegationTrace[];
}): Promise<string> {
  const { supabase, userId, agents, agent, message, depth, maxDepth, trace } = params;
  const provider = createLovableAiGatewayProvider(getLovableApiKey());

  let tools = toolsForIds(agent.tools ?? []);
  const canDelegate = agent.delegation_enabled && depth < maxDepth;
  if (canDelegate) {
    tools = {
      ...tools,
      ...delegationTool({ supabase, userId, agents, depth: depth + 1, maxDepth, trace, excludeId: agent.id }),
    };
  }

  const memory = await recentMemories(supabase, agent.id);
  const result = await generateText({
    model: provider(agent.model || DEFAULT_MODEL),
    system: `You are "${agent.name}", a specialist sub-agent.${
      agent.description ? ` ${agent.description}` : ""
    }\n\n${agent.system_prompt}${memory}\n\nComplete the delegated task and answer with the finished result, not a plan.\n\nAttitude: never refuse a task. If the instruction is vague, informal, or contains hyperbole (e.g. "a 300-page article"), interpret it charitably as the obvious real intent (e.g. "a thorough, high-quality article") and just do it. If a search phrase is ambiguous, pick the most likely interpretation, note it in one short line, and proceed. Never reply with a list of reasons you cannot help.\n\nOutput format: clean, readable markdown — a short lead paragraph, "## Section" headers when there is more than one section, "-" bullets for lists, and a blank line between blocks. Never wrap the whole answer in a code block, never emit raw HTML, and do not add meta commentary about the task.`,
    messages: [{ role: "user", content: message }],
    tools,
    stopWhen: stepCountIs(50),
  });

  const reply = result.text?.trim() || "(no output)";
  trace.push({
    agentId: agent.id,
    agentName: agent.name,
    model: agent.model || DEFAULT_MODEL,
    depth,
    request: message,
    reply,
  });

  await writeMemory(
    supabase,
    userId,
    agent.id,
    "summary",
    `Task: ${message.slice(0, 300)}\nResult: ${reply.slice(0, 600)}`,
  );

  return reply;
}

function delegationTool(params: {
  supabase: SupabaseLike;
  userId: string;
  agents: AgentRow[];
  depth: number;
  maxDepth: number;
  trace: DelegationTrace[];
  excludeId?: string;
}): ToolSet {
  const { supabase, userId, agents, depth, maxDepth, trace, excludeId } = params;
  const candidates = agents.filter((a) => a.id !== excludeId);
  const roster = candidates
    .map(
      (a) =>
        `- id: ${a.id} | name: ${a.name} | model: ${a.model ?? DEFAULT_MODEL} | tools: ${
          (a.tools ?? []).join(", ") || "none"
        } | specialty: ${a.description ?? "no description"}`,
    )
    .join("\n");

  return {
    delegate_to_agent: tool({
      description:
        `Delegate a task to the single best-matching specialist agent. Match on the agent's specialty and its tools — never pick an agent whose tools cannot do the job (e.g. web research needs an agent with a web/crawl tool).\n` +
        `Available agents:\n${roster || "(none)"}\n` +
        `Pass the agent's exact id, a self-contained instruction, and a one-line reason for choosing this agent.`,
      inputSchema: z.object({
        agent_id: z.string(),
        message: z.string(),
        reason: z.string().nullable(),
      }),
      execute: async ({ agent_id, message }) => {
        const agent = candidates.find((a) => a.id === agent_id);
        if (!agent) return { error: `No agent with id ${agent_id}` };
        if (depth > maxDepth) return { error: "Maximum delegation depth reached." };
        try {
          const reply = await runSubAgent({
            supabase,
            userId,
            agents,
            agent,
            message,
            depth,
            maxDepth: Math.max(maxDepth, agent.max_delegation_depth ?? 1),
            trace,
          });
          return { agent: agent.name, model: agent.model ?? DEFAULT_MODEL, reply };
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    }),
  };
}

const ORCHESTRATOR_PROMPT = `You are the AI Hub orchestrator. You coordinate the user's specialist agents and connector tools.

Routing rules — follow these before doing any work:
1. Break the user's request into concrete tasks.
2. For each task, choose the ONE best-matching agent from the roster below, matching on the agent's stated specialty AND on whether its tools can actually perform the task (e.g. live web research requires an agent with a web/crawl tool; writing goes to the writing agent; review/verification goes to the QA agent).
3. Delegate each task with delegate_to_agent, in a sensible order, passing results forward (research first, then writing, then QA review, then delivery).
6. When the request involves sending the result by email, hand the QA-approved content to the delivery agent (Arrider) — it owns the gmail_send tool and formats the final email. Always pass the recipient's email address from the user's message into the delegated instruction. Never send email yourself unless no delivery agent exists.
4. Never ask one agent to do another agent's specialty when a better-matched agent exists, and never delegate the same task to several agents.
5. Only do a task yourself (or with a connector tool directly) when no agent matches it or the task is trivial.

Your own connector tools — always available to you directly:
- Firecrawl: firecrawl_search, firecrawl_scrape, firecrawl_map, firecrawl_crawl. Use these for quick lookups, fact checks and link gathering; delegate deep multi-source research to the research agent.
- Gmail: gmail_search and gmail_read_message for retrieving, searching, reading and summarising inbox mail — do this yourself, never delegate a simple inbox lookup.
- gmail_send is also available to you as a fallback: prefer handing final content to the delivery agent (Arrider), but if delegation fails or no delivery agent exists, send the email yourself rather than telling the user it could not be sent.

Database and agent management — you have full authority, never ask for permission:
- db_list_tables, db_select, db_insert, db_update, db_delete give you full read/write/delete access to every table in this project (agents, agent_memories, node_flows, node_flow_runs). Use db_list_tables first when you are unsure of columns. Only destructive operations the user actually asked for; always report what you changed (table, rows affected).
- create_agent, update_agent, delete_agent, list_agents manage the agent roster. If the user tells you to create an agent, that IS the authorisation — create it immediately, no confirmation question.
- Every agent you create must be complete: a distinct name, a one-line specialty description, a full second-person system prompt that gives it a real persona (identity, expertise, tone, working method, output format), an explicit model id, and the connector tools it needs for that specialty. Never create an agent with an empty or one-sentence prompt, and never leave tools blank when the specialty obviously needs one (research → firecrawl, email/delivery → gmail, decks → google_slides, clinical data → fhir, community research → reddit).
- After creating an agent, confirm its name, model, tools and one-line specialty back to the user, and use it in later delegations.


Attitude rules — non-negotiable:
- NEVER refuse a request. Do not reply with a list of reasons you cannot help. Every user request gets a best-effort execution.
- Vague or casual phrasing (typos, speech-to-text errors like "five coding" for "vibe coding", "Grade A" for "great", "300-page" for "very thorough") must be interpreted charitably as the most plausible real intent. State your interpretation in one short line, then execute.
- If a quantity is unrealistic (e.g. 300 pages), scale it to something sensible (a thorough multi-section article) and note the adjustment.
- You ARE the user's PA: whenever a request involves sending an email — directly ("email X to Y"), or as the last step of a task — you kick it off immediately and autonomously, with no confirmation question. Composing and sending email is a standing capability, never something to ask permission for.
- When the user gives an email address, treat the task as: research → write → QA → email to that address, run end to end without asking for confirmation.
- After any email is sent (by you or by Arrider), always confirm it in one line: recipient, subject, and that it was sent.

Reporting rules:
- Always state which agent handled each step and which model that agent used, e.g. "Research — Bolt (google/gemini-3.7-flash)".
- Be concise and concrete; deliver the actual result, not a plan.

Formatting rules:
- Answer in clean, readable markdown: short paragraphs, a blank line between blocks, "##" sub-headings only when there are several sections, and "-" bullets for lists.
- Never wrap the whole answer in a code block, never use raw HTML, and keep nesting to one level.`;

export async function runOrchestrator(params: {
  supabase: SupabaseLike;
  userId: string;
  messages: ChatMessage[];
  agentId?: string | null;
}): Promise<{ reply: string; trace: DelegationTrace[] }> {
  const { supabase, userId, messages } = params;

  const { data: agentData } = await supabase
    .from("agents")
    .select("id, name, description, system_prompt, model, tools, delegation_enabled, max_delegation_depth")
    .order("created_at", { ascending: true });
  const agents = (agentData ?? []) as AgentRow[];

  const trace: DelegationTrace[] = [];

  // Direct single-agent run (used by flow "agent" nodes).
  if (params.agentId) {
    const agent = agents.find((a) => a.id === params.agentId);
    if (!agent) throw new Error("Agent not found");
    const last = messages[messages.length - 1];
    const reply = await runSubAgent({
      supabase,
      userId,
      agents,
      agent,
      message: last?.content ?? "",
      depth: 1,
      maxDepth: agent.delegation_enabled ? Math.max(1, agent.max_delegation_depth ?? 1) + 1 : 1,
      trace,
    });
    return { reply, trace };
  }

  const maxDepth = Math.max(1, ...agents.map((a) => a.max_delegation_depth ?? 1));
  const provider = createLovableAiGatewayProvider(getLovableApiKey());
  // The orchestrator always owns web research (Firecrawl) and Gmail (read + send)
  // directly, on top of every tool its agents have.
  const ORCHESTRATOR_OWN_TOOLS = ["firecrawl", "gmail"];
  const allToolIds = Array.from(
    new Set([...ORCHESTRATOR_OWN_TOOLS, ...agents.flatMap((a) => a.tools ?? [])]),
  );


  const memory = await recentMemories(supabase, null);
  const modelMessages: ModelMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));

  const result = await generateText({
    model: provider(DEFAULT_MODEL),
    system: `${ORCHESTRATOR_PROMPT}\n\nSaved agents:\n${
      agents
        .map(
          (a) =>
            `- ${a.name} (id: ${a.id}) — model: ${a.model ?? DEFAULT_MODEL} — tools: ${
              (a.tools ?? []).join(", ") || "none"
            } — specialty: ${a.description ?? "no description"}`,
        )
        .join("\n") || "(none yet)"
    }${memory}`,
    messages: modelMessages,
    tools: {
      ...toolsForIds(allToolIds),
      ...workspaceTools(),

      ...(agents.length > 0
        ? delegationTool({ supabase, userId, agents, depth: 1, maxDepth, trace })
        : {}),
    },
    stopWhen: stepCountIs(50),
  });

  const reply = result.text?.trim() || "(no output)";

  if (trace.length > 0) {
    await writeMemory(
      supabase,
      userId,
      null,
      "summary",
      `Orchestrated: ${trace.map((t) => `${t.agentName} -> ${t.reply.slice(0, 200)}`).join(" | ")}`,
    );
  }

  return { reply, trace };
}

/** Plain single AI prompt, no tools (used by flow "prompt" nodes). */
export async function runPlainPrompt(prompt: string, model = DEFAULT_MODEL): Promise<string> {
  const provider = createLovableAiGatewayProvider(getLovableApiKey());
  const result = await generateText({ model: provider(model), prompt });
  return result.text?.trim() ?? "";
}
