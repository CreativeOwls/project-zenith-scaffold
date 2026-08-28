import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TOOL_CATALOG } from "@/lib/connector-catalog";
import { NODE_SUBTYPES, type FlowNode, type JsonValue, type NodeKind } from "@/lib/flow-types";

export type AgentOption = {
  id: string;
  name: string;
  model?: string | null;
  description?: string | null;
  tools?: string[] | null;
};

export function NodeInspector({
  node,
  agents,
  onChange,
  onDelete,
}: {
  node: FlowNode | null;
  agents: AgentOption[];
  onChange: (patch: Partial<FlowNode>) => void;
  onDelete: () => void;
}) {
  if (!node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a node to edit it, or add one from the toolbar.
      </div>
    );
  }

  const config = node.config ?? {};
  const setConfig = (key: string, value: JsonValue) =>
    onChange({ config: { ...config, [key]: value } });
  const text = (key: string, fallback = "") => String(config[key] ?? fallback);

  const field = (key: string, label: string, placeholder?: string, multiline = false) => (
    <div className="space-y-1.5" key={key}>
      <Label htmlFor={`cfg-${key}`}>{label}</Label>
      {multiline ? (
        <Textarea
          id={`cfg-${key}`}
          rows={4}
          value={text(key)}
          placeholder={placeholder}
          onChange={(e) => setConfig(key, e.target.value)}
        />
      ) : (
        <Input
          id={`cfg-${key}`}
          value={text(key)}
          placeholder={placeholder}
          onChange={(e) => setConfig(key, e.target.value)}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="node-label">Label</Label>
        <Input
          id="node-label"
          value={node.label}
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="node-kind">Kind</Label>
        <select
          id="node-kind"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={node.kind}
          onChange={(e) => {
            const kind = e.target.value as NodeKind;
            onChange({ kind, subtype: NODE_SUBTYPES[kind]![0]!.value, config: {} });
          }}
        >
          {Object.keys(NODE_SUBTYPES).map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="node-subtype">Subtype</Label>
        <select
          id="node-subtype"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={node.subtype}
          onChange={(e) => onChange({ subtype: e.target.value, config: {} })}
        >
          {NODE_SUBTYPES[node.kind]!.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-border pt-4">
        {node.kind === "input" && node.subtype === "text" && field("value", "Text value", "Starting input", true)}
        {node.kind === "input" && node.subtype === "webhook" && field("sample", "Sample payload", "{}", true)}
        {node.kind === "input" && node.subtype === "cron" && (
          <div className="space-y-4">
            {field("schedule", "Cron schedule", "0 9 * * *")}
            {field("sample", "Sample input", "", true)}
          </div>
        )}

        {node.kind === "action" && node.subtype === "agent" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-agentId">Agent</Label>
              <select
                id="cfg-agentId"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={text("agentId")}
                onChange={(e) => setConfig("agentId", e.target.value)}
              >
                <option value="">Orchestrator (picks the best agent)</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} — {agent.model ?? "default model"}
                  </option>
                ))}
              </select>
              {(() => {
                const selected = agents.find((a) => a.id === text("agentId"));
                if (!selected) {
                  return (
                    <p className="text-xs text-muted-foreground">
                      The orchestrator will choose the best-matching agent at run time.
                    </p>
                  );
                }
                return (
                  <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                    <p className="font-medium">{selected.name}</p>
                    <p className="text-muted-foreground">Model: {selected.model ?? "default"}</p>
                    <p className="text-muted-foreground">
                      Tools: {selected.tools?.length ? selected.tools.join(", ") : "none"}
                    </p>
                    {selected.description && (
                      <p className="mt-1 text-muted-foreground">{selected.description}</p>
                    )}
                  </div>
                );
              })()}
            </div>
            {field("message", "Message", "Summarise this: {{input}}", true)}
          </div>
        )}

        {node.kind === "action" && node.subtype === "prompt" &&
          field("prompt", "Prompt", "Summarise: {{input}}", true)}

        {node.kind === "action" && node.subtype === "tool" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-action">Tool action</Label>
              <select
                id="cfg-action"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={text("action")}
                onChange={(e) => setConfig("action", e.target.value)}
              >
                <option value="">Select an action…</option>
                {TOOL_CATALOG.map((tool) => (
                  <optgroup key={tool.id} label={tool.label}>
                    {tool.actions.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {field("args", "Arguments (JSON)", '{"query":"{{input}}","limit":5}', true)}
          </div>
        )}

        {node.kind === "action" && node.subtype === "http" && (
          <div className="space-y-4">
            {field("url", "URL", "https://api.example.com/search?q={{input}}")}
            {field("method", "Method", "GET")}
            {field("body", "Body", '{"q":"{{input}}"}', true)}
          </div>
        )}

        {node.kind === "logic" && node.subtype === "keyword" && field("keyword", "Keyword", "urgent")}
        {node.kind === "logic" && node.subtype === "regex" && field("pattern", "Regex pattern", "^ERROR")}
        {node.kind === "logic" && node.subtype === "ai" &&
          field("question", "Yes/no question", "Is this about our product?", true)}

        {node.kind === "loop" && node.subtype === "for_each" && (
          <div className="space-y-4">
            {field("separator", "Item separator", "\\n")}
            {field("maxIterations", "Max iterations", "5")}
          </div>
        )}
        {node.kind === "loop" && node.subtype === "while" && (
          <div className="space-y-4">
            {field("condition", "Continue while (yes/no question)", "Is there more to refine?", true)}
            {field("maxIterations", "Max iterations", "5")}
          </div>
        )}

        {node.kind === "output" && node.subtype === "email" && (
          <div className="space-y-4">
            {field("to", "Recipient", "me@example.com")}
            {field("subject", "Subject", "Flow result")}
          </div>
        )}
        {node.kind === "output" && node.subtype === "save" && (
          <div className="space-y-1.5">
            <Label htmlFor="cfg-save-agent">Save to agent memory</Label>
            <select
              id="cfg-save-agent"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={text("agentId")}
              onChange={(e) => setConfig("agentId", e.target.value)}
            >
              <option value="">Orchestrator memory</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {node.kind === "output" && node.subtype === "notify" && field("channel", "Channel", "in-app")}
      </div>

      <Button variant="ghost" size="sm" onClick={onDelete}>
        Delete node
      </Button>
    </div>
  );
}
