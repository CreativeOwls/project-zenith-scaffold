// Client-safe flow graph types shared by the canvas, prompter and engine.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type NodeKind = "input" | "action" | "logic" | "loop" | "output";

export type FlowNode = {
  id: string;
  kind: NodeKind;
  subtype: string;
  label: string;
  x: number;
  y: number;
  config: Record<string, JsonValue>;
};

export type FlowConnection = {
  id: string;
  from: string;
  fromPort: string; // "out" | "true" | "false" | "body" | "done"
  to: string;
  toPort: string; // "in"
};

export type FlowGraph = {
  nodes: FlowNode[];
  connections: FlowConnection[];
};

export type NodeStatus = "idle" | "running" | "success" | "error";

export const NODE_SUBTYPES: Record<NodeKind, { value: string; label: string }[]> = {
  input: [
    { value: "text", label: "Text input" },
    { value: "webhook", label: "Webhook trigger" },
    { value: "cron", label: "Cron trigger" },
  ],
  action: [
    { value: "agent", label: "AI agent" },
    { value: "prompt", label: "AI prompt" },
    { value: "tool", label: "Tool call" },
    { value: "http", label: "HTTP request" },
  ],
  logic: [
    { value: "keyword", label: "Keyword branch" },
    { value: "regex", label: "Regex branch" },
    { value: "ai", label: "AI yes/no branch" },
  ],
  loop: [
    { value: "for_each", label: "For each" },
    { value: "while", label: "While" },
  ],
  output: [
    { value: "display", label: "Display" },
    { value: "email", label: "Email" },
    { value: "save", label: "Save" },
    { value: "notify", label: "Notify" },
  ],
};

export function outputPorts(node: FlowNode): string[] {
  if (node.kind === "logic") return ["true", "false"];
  if (node.kind === "loop") return ["body", "done"];
  if (node.kind === "output") return [];
  return ["out"];
}

export function hasInputPort(node: FlowNode): boolean {
  return node.kind !== "input";
}

export const NODE_KIND_COLORS: Record<NodeKind, string> = {
  input: "border-accent-blue",
  action: "border-accent-green",
  logic: "border-accent-yellow",
  loop: "border-accent-red",
  output: "border-foreground/40",
};
