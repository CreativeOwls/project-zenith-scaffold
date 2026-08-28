import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { generateFlow } from "@/lib/flows.functions";
import type { FlowGraph } from "@/lib/flow-types";

type Generated = {
  name: string;
  description: string;
  graph: FlowGraph;
  validation: { errors: string[]; warnings: string[] };
};

export function FlowPrompter({
  onLoad,
}: {
  onLoad: (graph: FlowGraph, name: string, description: string) => void;
}) {
  const generate = useServerFn(generateFlow);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Generated | null>(null);

  const submit = async () => {
    if (!request.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const generated = (await generate({ data: { request } })) as Generated;
      setResult(generated);
      if (generated.validation.errors.length > 0) {
        toast.error("The generated flow needs fixes before it can run");
      } else {
        toast.success("Flow generated");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div>
        <h3 className="text-sm font-medium">Prompter</h3>
        <p className="text-xs text-muted-foreground">
          Describe the automation in plain English and the AI builds the node graph.
        </p>
      </div>

      <Textarea
        rows={4}
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        placeholder="Search Reddit for posts about our product, summarise with AI, email me the digest"
      />
      <Button onClick={() => void submit()} disabled={busy || !request.trim()}>
        {busy ? "Generating…" : "Generate flow"}
      </Button>

      {result && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card/50 p-3 text-xs">
          <p className="text-sm font-medium">{result.name}</p>
          <p className="mt-1 text-muted-foreground">{result.description}</p>

          <ul className="mt-3 space-y-1">
            {result.graph.nodes.map((node) => (
              <li key={node.id}>
                <span className="text-accent-blue">{node.kind}/{node.subtype}</span> — {node.label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-muted-foreground">
            {result.graph.connections.length} connections
          </p>

          {result.validation.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-accent-red">
              {result.validation.errors.map((error, index) => (
                <li key={index}>✕ {error}</li>
              ))}
            </ul>
          )}
          {result.validation.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-accent-yellow">
              {result.validation.warnings.map((warning, index) => (
                <li key={index}>! {warning}</li>
              ))}
            </ul>
          )}

          <Button
            className="mt-3"
            size="sm"
            disabled={result.graph.nodes.length === 0}
            onClick={() => onLoad(result.graph, result.name, result.description)}
          >
            Load onto canvas
          </Button>
        </div>
      )}
    </div>
  );
}
