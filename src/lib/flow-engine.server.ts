import { runOrchestrator, runPlainPrompt } from "./agent-runtime.server";
import { gmailSend, runConnectorAction } from "./connectors.server";
import type { FlowConnection, FlowGraph, FlowNode, NodeStatus } from "./flow-types";

type SupabaseLike = { from: (table: string) => any };

type FlowLog = { nodeId: string; label: string; output: string };


const MAX_NODE_VISITS = 200;

function applyTemplate(template: string, input: string): string {
  return (template ?? "").replaceAll("{{input}}", input);
}

function cfgString(node: FlowNode, key: string, fallback = ""): string {
  const value = node.config?.[key];
  return typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
}

function cfgNumber(node: FlowNode, key: string, fallback: number): number {
  const value = Number(node.config?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export class FlowExecutor {
  private statuses: Record<string, NodeStatus> = {};
  private logs: FlowLog[] = [];
  private visits = 0;

  constructor(
    private supabase: SupabaseLike,
    private userId: string,
    private graph: FlowGraph,
    private runId: string,
  ) {
    for (const node of graph.nodes) this.statuses[node.id] = "idle";
  }

  private outgoing(nodeId: string, port: string): FlowConnection[] {
    return this.graph.connections.filter((c) => c.from === nodeId && c.fromPort === port);
  }

  private node(id: string): FlowNode | undefined {
    return this.graph.nodes.find((n) => n.id === id);
  }

  /** True when this node's output is (directly, or via other agent steps) delivered to an email output. */
  private feedsDelivery(nodeId: string, seen = new Set<string>()): boolean {
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    return this.graph.connections
      .filter((c) => c.from === nodeId)
      .some((c) => {
        const next = this.node(c.to);
        if (!next) return false;
        if (next.kind === "output") return next.subtype === "email" || next.subtype === "text";
        if (next.kind === "action" && (next.subtype === "agent" || next.subtype === "prompt")) {
          return this.feedsDelivery(next.id, seen);
        }
        return false;
      });
  }


  private async persist(status?: string, result?: unknown) {
    const patch: Record<string, unknown> = { node_statuses: this.statuses };
    if (status) patch["status"] = status;
    if (result !== undefined) patch["result"] = result;
    if (status === "success" || status === "error") patch["completed_at"] = new Date().toISOString();
    await this.supabase.from("node_flow_runs").update(patch).eq("id", this.runId);
  }

  async run(initialInput: string): Promise<{ outputs: FlowLog[] }> {
    const entryNodes = this.graph.nodes.filter(
      (n) => !this.graph.connections.some((c) => c.to === n.id),
    );
    try {
      for (const entry of entryNodes) {
        await this.walk(entry, initialInput);
      }
      await this.persist("success", { outputs: this.logs });
    } catch (error) {
      await this.persist("error", {
        outputs: this.logs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return { outputs: this.logs };
  }

  private async walk(node: FlowNode, input: string): Promise<string> {
    if (++this.visits > MAX_NODE_VISITS) throw new Error("Flow exceeded maximum node executions");

    this.statuses[node.id] = "running";
    await this.persist("running");

    let output = "";
    try {
      if (node.kind === "loop") {
        output = await this.runLoop(node, input);
      } else if (node.kind === "logic") {
        output = await this.runLogic(node, input);
        return output;
      } else {
        output = await this.execute(node, input);
      }
      this.statuses[node.id] = "success";
      await this.persist("running");
    } catch (error) {
      this.statuses[node.id] = "error";
      await this.persist("running");
      throw error;
    }

    if (node.kind === "output") {
      this.logs.push({ nodeId: node.id, label: node.label, output });
      return output;
    }

    const port = node.kind === "loop" ? "done" : "out";
    let last = output;
    for (const connection of this.outgoing(node.id, port)) {
      const next = this.node(connection.to);
      if (next) last = await this.walk(next, output);
    }
    return last;
  }

  private async runLogic(node: FlowNode, input: string): Promise<string> {
    let matched = false;
    if (node.subtype === "keyword") {
      const keyword = cfgString(node, "keyword");
      matched = keyword !== "" && input.toLowerCase().includes(keyword.toLowerCase());
    } else if (node.subtype === "regex") {
      try {
        matched = new RegExp(cfgString(node, "pattern", ".*"), "i").test(input);
      } catch {
        matched = false;
      }
    } else {
      const question = cfgString(node, "question", "Is this relevant?");
      const answer = await runPlainPrompt(
        `Answer strictly with "yes" or "no".\nQuestion: ${question}\n\nContent:\n${input}`,
      );
      matched = /^\s*yes/i.test(answer);
    }

    this.statuses[node.id] = "success";
    await this.persist("running");

    let last = input;
    for (const connection of this.outgoing(node.id, matched ? "true" : "false")) {
      const next = this.node(connection.to);
      if (next) last = await this.walk(next, input);
    }
    return last;
  }

  private async runLoop(node: FlowNode, input: string): Promise<string> {
    const maxIterations = Math.min(cfgNumber(node, "maxIterations", 5), 25);
    const bodyEntries = this.outgoing(node.id, "body")
      .map((c) => this.node(c.to))
      .filter((n): n is FlowNode => Boolean(n));

    const results: string[] = [];

    if (node.subtype === "for_each") {
      const separator = cfgString(node, "separator", "\n") || "\n";
      const items = input
        .split(separator === "\\n" ? "\n" : separator)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, maxIterations);
      for (const item of items) {
        for (const bodyNode of bodyEntries) results.push(await this.walk(bodyNode, item));
      }
    } else {
      const condition = cfgString(node, "condition", "");
      let current = input;
      for (let i = 0; i < maxIterations; i++) {
        if (condition) {
          const answer = await runPlainPrompt(
            `Answer strictly "yes" or "no". Condition: ${condition}\n\nCurrent value:\n${current}`,
          );
          if (!/^\s*yes/i.test(answer)) break;
        }
        for (const bodyNode of bodyEntries) {
          current = await this.walk(bodyNode, current);
          results.push(current);
        }
        if (!condition) break;
      }
    }

    return results.join("\n---\n");
  }

  private async execute(node: FlowNode, input: string): Promise<string> {
    switch (node.kind) {
      case "input": {
        if (node.subtype === "text") return cfgString(node, "value", input) || input;
        return input || cfgString(node, "sample");
      }
      case "action":
        return this.runAction(node, input);
      case "output":
        return this.runOutput(node, input);
      default:
        return input;
    }
  }

  private async runAction(node: FlowNode, input: string): Promise<string> {
    if (node.subtype === "agent") {
      const agentId = cfgString(node, "agentId");
      let message = applyTemplate(cfgString(node, "message", "{{input}}"), input);
      if (this.feedsDelivery(node.id)) {
        message +=
          '\n\nDELIVERY STEP — your reply is delivered verbatim to the end recipient. Output ONLY the finished deliverable itself: the complete, corrected, ready-to-publish document in clean markdown (short lead paragraph, "## Section" headers, "-" bullets). Do NOT output review notes, critique, scores, checklists, feedback, approval statements, or any commentary about the task. If the incoming draft needs fixes, silently apply them and return the full corrected document.';
      }
      const { reply } = await runOrchestrator({
        supabase: this.supabase,
        userId: this.userId,
        messages: [{ role: "user", content: message }],
        agentId: agentId || null,
      });
      return reply;
    }


    if (node.subtype === "prompt") {
      const prompt = applyTemplate(cfgString(node, "prompt", "{{input}}"), input);
      return runPlainPrompt(prompt, cfgString(node, "model", "") || undefined);
    }

    if (node.subtype === "tool") {
      const action = cfgString(node, "action");
      if (!action) throw new Error(`Node "${node.label}" is missing a tool action`);
      let args: Record<string, unknown> = {};
      const rawArgs = node.config?.["args"];
      if (typeof rawArgs === "string" && rawArgs.trim()) {
        args = JSON.parse(applyTemplate(rawArgs, input.replace(/"/g, '\\"'))) as Record<string, unknown>;
      } else if (rawArgs && typeof rawArgs === "object") {
        args = Object.fromEntries(
          Object.entries(rawArgs as Record<string, unknown>).map(([k, v]) => [
            k,
            typeof v === "string" ? applyTemplate(v, input) : v,
          ]),
        );
      }
      const result = await runConnectorAction(action, args);
      return JSON.stringify(result).slice(0, 8000);
    }

    // http
    const url = applyTemplate(cfgString(node, "url"), input);
    if (!url) throw new Error(`Node "${node.label}" is missing a URL`);
    const method = cfgString(node, "method", "GET").toUpperCase();
    const body = applyTemplate(cfgString(node, "body"), input);
    const sendsBody = method !== "GET" && method !== "HEAD" && Boolean(body);
    const init: RequestInit = { method };
    if (sendsBody) {
      init.headers = { "Content-Type": "application/json" };
      init.body = body;
    }
    const response = await fetch(url, init);
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    return text.slice(0, 8000);
  }

  private async runOutput(node: FlowNode, input: string): Promise<string> {
    if (node.subtype === "email") {
      const to = cfgString(node, "to");
      if (!to) throw new Error(`Email output "${node.label}" is missing a recipient`);
      await gmailSend(to, cfgString(node, "subject", "Flow result"), input);
      return `Email sent to ${to}`;
    }
    if (node.subtype === "save") {
      await this.supabase.from("agent_memories").insert({
        agent_id: cfgString(node, "agentId") || null,
        user_id: this.userId,
        memory_type: "summary",
        content: input.slice(0, 1500),
      });
      return "Saved to agent memory";
    }
    return input;
  }
}

export async function executeFlow(params: {
  supabase: SupabaseLike;
  userId: string;
  graph: FlowGraph;
  runId: string;
  input: string;
}) {
  const executor = new FlowExecutor(params.supabase, params.userId, params.graph, params.runId);
  return executor.run(params.input);
}
