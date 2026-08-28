import { generateText } from "ai";

import { DEFAULT_MODEL, createLovableAiGatewayProvider, getLovableApiKey } from "./ai-gateway.server";
import { TOOL_CATALOG } from "./connector-catalog";
import { autoLayout } from "./flow-layout";
import { NODE_SUBTYPES, type FlowConnection, type FlowGraph, type FlowNode } from "./flow-types";

export type ValidationResult = { errors: string[]; warnings: string[] };

const VALID_KINDS = Object.keys(NODE_SUBTYPES);

export function validateGraph(graph: FlowGraph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    return { errors: ["The generated flow has no nodes."], warnings };
  }

  for (const node of graph.nodes) {
    if (!node.id) errors.push("A node is missing an id.");
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (!VALID_KINDS.includes(node.kind)) errors.push(`Node ${node.id} has unknown kind "${node.kind}".`);
    const subtypes = (NODE_SUBTYPES[node.kind] ?? []).map((s) => s.value);
    if (subtypes.length > 0 && !subtypes.includes(node.subtype)) {
      errors.push(`Node ${node.id} has unknown subtype "${node.subtype}" for kind ${node.kind}.`);
    }

    const config = node.config ?? {};
    const missing = (key: string) => !config[key] || String(config[key]).trim() === "";

    if (node.kind === "action") {
      if (node.subtype === "prompt" && missing("prompt")) errors.push(`Node ${node.id} needs a prompt.`);
      if (node.subtype === "agent" && missing("message")) warnings.push(`Node ${node.id} has no message template.`);
      if (node.subtype === "tool" && missing("action")) errors.push(`Node ${node.id} needs a tool action.`);
      if (node.subtype === "http" && missing("url")) errors.push(`Node ${node.id} needs a URL.`);
    }
    if (node.kind === "logic") {
      if (node.subtype === "keyword" && missing("keyword")) errors.push(`Node ${node.id} needs a keyword.`);
      if (node.subtype === "regex" && missing("pattern")) errors.push(`Node ${node.id} needs a regex pattern.`);
      if (node.subtype === "ai" && missing("question")) errors.push(`Node ${node.id} needs a question.`);
    }
    if (node.kind === "loop" && !Number(config["maxIterations"])) {
      node.config = { ...config, maxIterations: 5 };
    }
    if (node.kind === "output" && node.subtype === "email" && missing("to")) {
      errors.push(`Node ${node.id} needs an email recipient.`);
    }
  }

  const connections: FlowConnection[] = Array.isArray(graph.connections) ? graph.connections : [];
  for (const connection of connections) {
    if (!ids.has(connection.from) || !ids.has(connection.to)) {
      errors.push(`Connection ${connection.from} -> ${connection.to} points at a missing node.`);
    }
  }

  for (const node of graph.nodes) {
    if (node.kind === "logic") {
      const ports = new Set(connections.filter((c) => c.from === node.id).map((c) => c.fromPort));
      if (!ports.has("true") || !ports.has("false")) {
        errors.push(`Logic node ${node.id} must connect both a true and a false branch.`);
      }
    }
    if (node.kind === "loop") {
      const ports = new Set(connections.filter((c) => c.from === node.id).map((c) => c.fromPort));
      if (!ports.has("body")) errors.push(`Loop node ${node.id} must connect its body branch.`);
    }
    if (graph.nodes.length > 1) {
      const connected = connections.some((c) => c.from === node.id || c.to === node.id);
      if (!connected) errors.push(`Node ${node.id} is orphaned (no connections).`);
    }
  }

  if (!graph.nodes.some((n) => !connections.some((c) => c.to === n.id))) {
    errors.push("The flow has no entry node.");
  }

  return { errors, warnings };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The AI did not return a flow definition.");
  return JSON.parse(candidate.slice(start, end + 1));
}

const KIND_ALIASES: Record<string, FlowNode["kind"]> = {
  input: "input",
  trigger: "input",
  start: "input",
  action: "action",
  task: "action",
  step: "action",
  logic: "logic",
  condition: "logic",
  branch: "logic",
  if: "logic",
  loop: "loop",
  iterate: "loop",
  output: "output",
  end: "output",
  result: "output",
};

const SUBTYPE_ALIASES: Record<string, string> = {
  // action
  ai: "prompt",
  llm: "prompt",
  model: "prompt",
  prompt: "prompt",
  agent: "agent",
  subagent: "agent",
  tool: "tool",
  connector: "tool",
  function: "tool",
  http: "http",
  api: "http",
  fetch: "http",
  request: "http",
  // input
  text: "text",
  manual: "text",
  webhook: "webhook",
  cron: "cron",
  schedule: "cron",
  // logic
  keyword: "keyword",
  regex: "regex",
  // loop
  for_each: "for_each",
  foreach: "for_each",
  each: "for_each",
  map: "for_each",
  while: "while",
  // output
  display: "display",
  show: "display",
  email: "email",
  mail: "email",
  gmail: "email",
  save: "save",
  store: "save",
  notify: "notify",
};

/**
 * Models regularly emit "action/tool", "Action", "ACTION_TOOL" or put the kind
 * in the subtype. Coerce whatever they wrote into a valid kind + subtype pair
 * instead of failing validation on a graph that is otherwise fine.
 */
function coerceKindSubtype(rawKind: unknown, rawSubtype: unknown) {
  const tokens = `${String(rawKind ?? "")}/${String(rawSubtype ?? "")}`
    .toLowerCase()
    .split(/[^a-z_]+/)
    .filter(Boolean);

  let kind: FlowNode["kind"] | undefined;
  let subtype: string | undefined;

  for (const token of tokens) {
    if (!kind && KIND_ALIASES[token]) {
      kind = KIND_ALIASES[token];
      continue;
    }
    if (!subtype && SUBTYPE_ALIASES[token]) subtype = SUBTYPE_ALIASES[token];
  }

  // "for_each" arrives as two tokens once split on non-letters is applied.
  if (!subtype && tokens.includes("for")) subtype = "for_each";

  kind ??= "action";
  const allowed = (NODE_SUBTYPES[kind] ?? []).map((s) => s.value);
  if (!subtype || !allowed.includes(subtype)) {
    // Prefer a same-named subtype under another kind before falling back.
    const owner = (Object.keys(NODE_SUBTYPES) as FlowNode["kind"][]).find((k) =>
      subtype ? (NODE_SUBTYPES[k] ?? []).some((s) => s.value === subtype) : false,
    );
    if (subtype && owner && !KIND_ALIASES[String(rawKind ?? "").toLowerCase()]) {
      kind = owner;
    } else {
      subtype = allowed[0] ?? "prompt";
    }
  }

  return { kind, subtype: subtype! };
}

function normalizeGraph(raw: unknown): { graph: FlowGraph; name: string; description: string } {
  const parsed = raw as {
    name?: string;
    description?: string;
    nodes?: Partial<FlowNode>[];
    connections?: Partial<FlowConnection>[];
  };

  const nodes: FlowNode[] = (parsed.nodes ?? []).map((node, index) => {
    const { kind, subtype } = coerceKindSubtype(node.kind, node.subtype);
    return {
      id: String(node.id ?? `n${index + 1}`),
      kind,
      subtype,
      label: String(node.label ?? `Node ${index + 1}`),
      x: Number.isFinite(Number(node.x)) ? Number(node.x) : 120 + index * 60,
      y: Number.isFinite(Number(node.y)) ? Number(node.y) : 120 + index * 150,
      config: (node.config ?? {}) as FlowNode["config"],
    };
  });


  const connections: FlowConnection[] = (parsed.connections ?? []).map((connection, index) => ({
    id: String(connection.id ?? `c${index + 1}`),
    from: String(connection.from ?? ""),
    fromPort: String(connection.fromPort ?? "out"),
    to: String(connection.to ?? ""),
    toPort: "in",
  }));

  return {
    graph: autoLayout({ nodes, connections }),
    name: String(parsed.name ?? "Generated flow"),
    description: String(parsed.description ?? ""),
  };
}

export type PrompterAgent = {
  id: string;
  name: string;
  description: string | null;
  tools: string[];
  model: string;
  system_prompt?: string | null;
};

function agentRoster(agents: PrompterAgent[]) {
  if (agents.length === 0) return "(none — do not create action/agent nodes, use action/prompt instead)";
  return agents
    .map((a) => {
      const persona = (a.system_prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      return [
        `- id: ${a.id}`,
        `  name: ${a.name}`,
        `  model: ${a.model}`,
        `  specialty: ${a.description ?? "unspecified"}`,
        `  tools: ${a.tools.join(", ") || "none"}`,
        `  persona: ${persona || "unspecified"}`,
      ].join("\n");
    })
    .join("\n");
}

export async function buildFlowFromPrompt(params: {
  request: string;
  agents: PrompterAgent[];
}) {
  const provider = createLovableAiGatewayProvider(getLovableApiKey());

  const spec = `
Node kinds and subtypes ("kind" and "subtype" are SEPARATE fields — subtype must be the bare value, e.g. {"kind":"action","subtype":"tool"}, never "action/tool"):
${Object.entries(NODE_SUBTYPES)
  .map(([kind, subtypes]) => `- ${kind}: ${subtypes.map((s) => s.value).join(", ")}`)
  .join("\n")}

Required config per node:
- input/text: { "value": string }
- input/webhook | input/cron: { "sample": string, "schedule"?: string }
- action/agent: { "agentId": string, "message": string }
- action/prompt: { "prompt": string, "model"?: string }
- action/tool: { "action": string, "args": object }
- action/http: { "url": string, "method": string, "body"?: string }
- logic/keyword: { "keyword": string }
- logic/regex: { "pattern": string }
- logic/ai: { "question": string }
- loop/for_each: { "separator": string, "maxIterations": number }
- loop/while: { "condition": string, "maxIterations": number }
- output/display: {}
- output/email: { "to": string, "subject": string }
- output/save: { "agentId"?: string }
- output/notify: { "channel"?: string }

Available tool actions for action/tool nodes:
${TOOL_CATALOG.map((t) => `- ${t.label}: ${t.actions.join(", ")}`).join("\n")}

The user's saved agents — each has a specialty, its own model and its own tools:
${agentRoster(params.agents)}

Agent routing rules (IMPORTANT):
- For any step that needs skill or judgement, prefer an action/agent node over action/prompt, and pick the agent whose specialty, persona and tools best match that step.
- "agentId" MUST be one of the exact ids listed above — never invent an id, a name, or a slug.
- Match the work to the specialty: web research / crawling / gathering sources → the research agent that owns the web tools; drafting, rewriting, summarising or creative copy → the writing agent; reviewing, fact-checking, QA or final approval → the QA agent.
- Only use an agent for tool work if that tool appears in its own tools list; if no agent owns the needed tool, use an action/tool node instead.
- Split multi-skill requests into one agent node per specialty and chain them (e.g. research → write → QA review) rather than overloading a single agent.
- Label each agent node "<Agent name> — <what it does>" so the canvas shows who is doing the work.
- Each agent node's "message" must state that step's task and inject upstream output with "{{input}}".
- Do not repeat the same agent back-to-back unless the request genuinely needs two passes.
- A QA / review step that feeds an output node must be told to return the final corrected deliverable itself (clean markdown with "## Section" headers, no feedback notes, no critique list), because that text is what gets delivered.
- The last agent node before an output/email node must be told to output only the finished, ready-to-send document — no preamble, no "here is the article", no commentary.

Rules:
- Use "{{input}}" inside prompt/message/url/body/args strings to inject the previous node's output.
- Ports: normal nodes emit "out"; logic nodes emit "true" and "false" (both MUST be connected); loop nodes emit "body" and "done" (body MUST be connected).
- Every node must be connected; exactly one entry node with no incoming connection is preferred.
- Lay nodes out left-to-right: x increasing by ~260 per step, y between 80 and 700.


Return ONLY JSON:
{"name":"...","description":"...","nodes":[{"id":"n1","kind":"input","subtype":"text","label":"...","x":120,"y":80,"config":{}}],"connections":[{"id":"c1","from":"n1","fromPort":"out","to":"n2","toPort":"in"}]}
`;

  const result = await generateText({
    model: provider(DEFAULT_MODEL),
    system: `You design automation node graphs. Output strict JSON only, no prose.\n${spec}`,
    prompt: params.request,
  });

  const normalized = normalizeGraph(extractJson(result.text ?? ""));
  repairNodeConfigs(normalized.graph, params.agents);
  const validation = validateGraph(normalized.graph);
  reconcileAgentNodes(normalized.graph, params.agents, validation);
  return { ...normalized, validation };
}

/**
 * Fill in config the model tends to omit so a structurally sound graph is not
 * rejected for a blank field the canvas can already edit.
 */
function repairNodeConfigs(graph: FlowGraph, agents: PrompterAgent[]) {
  const validActions = new Set(TOOL_CATALOG.flatMap((t) => t.actions));

  for (const node of graph.nodes) {
    const config = { ...((node.config ?? {}) as Record<string, unknown>) };
    const blank = (key: string) => !config[key] || String(config[key]).trim() === "";

    if (node.kind === "action") {
      if (node.subtype === "tool" && (blank("action") || !validActions.has(String(config["action"])))) {
        // No usable tool action: run the step as an agent when we have one,
        // otherwise as a plain prompt.
        if (agents.length > 0) {
          node.subtype = "agent";
          config["agentId"] = config["agentId"] ?? agents[0]!.id;
          if (blank("message")) config["message"] = `${node.label}\n\n{{input}}`;
        } else {
          node.subtype = "prompt";
          if (blank("prompt")) config["prompt"] = `${node.label}\n\n{{input}}`;
        }
      }
      if (node.subtype === "prompt" && blank("prompt")) config["prompt"] = `${node.label}\n\n{{input}}`;
      if (node.subtype === "agent" && blank("message")) config["message"] = `${node.label}\n\n{{input}}`;
    }

    if (node.kind === "logic" && node.subtype === "ai" && blank("question")) {
      config["question"] = node.label;
    }

    node.config = config as FlowNode["config"];
  }
}


/**
 * The model occasionally writes an agent name (or a stale id) into agentId.
 * Repair it by name when we can, otherwise surface it instead of silently
 * shipping a node that cannot run.
 */
function reconcileAgentNodes(
  graph: FlowGraph,
  agents: PrompterAgent[],
  validation: ValidationResult,
) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const byName = new Map(agents.map((a) => [a.name.trim().toLowerCase(), a]));

  for (const node of graph.nodes) {
    if (node.kind !== "action" || node.subtype !== "agent") continue;
    const config = (node.config ?? {}) as Record<string, unknown>;
    const raw = String(config["agentId"] ?? "").trim();
    let agent = byId.get(raw);

    if (!agent) {
      const guess =
        byName.get(raw.toLowerCase()) ??
        agents.find((a) => node.label.toLowerCase().includes(a.name.toLowerCase()));
      if (guess) {
        agent = guess;
        node.config = { ...config, agentId: guess.id };
      } else {
        validation.errors.push(
          `Node ${node.id} points at an unknown agent${raw ? ` ("${raw}")` : ""} — pick one in the inspector.`,
        );
        continue;
      }
    }

    if (!node.label.toLowerCase().includes(agent.name.toLowerCase())) {
      node.label = `${agent.name} — ${node.label}`;
    }
  }
}
