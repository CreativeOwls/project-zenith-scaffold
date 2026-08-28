import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { FlowPrompter } from "@/components/flow/FlowPrompter";
import { NodeCanvas } from "@/components/flow/NodeCanvas";
import { NodeInspector, type AgentOption } from "@/components/flow/NodeInspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listAgents } from "@/lib/agents.functions";
import {
  deleteFlow,
  getFlowRun,
  listFlows,
  saveFlow,
  startFlowRun,
  createFlowRun,
} from "@/lib/flows.functions";
import { NODE_SUBTYPES, type FlowGraph, type FlowNode, type NodeKind, type NodeStatus } from "@/lib/flow-types";

const TITLE = "Flows — visual workflow builder | PROJECT 5";
const DESCRIPTION =
  "Drag-and-drop node canvas for AI automations: inputs, agents, branches, loops and outputs, generated or hand-built.";

export const Route = createFileRoute("/flows")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FlowsPage,
});

type FlowRow = {
  id: string;
  name: string;
  description: string | null;
  nodes: FlowNode[];
  connections: FlowGraph["connections"];
};

const KINDS: NodeKind[] = ["input", "action", "logic", "loop", "output"];

function FlowsPage() {
  const load = useServerFn(listFlows);
  const save = useServerFn(saveFlow);
  const remove = useServerFn(deleteFlow);
  const start = useServerFn(startFlowRun);
  const createRun = useServerFn(createFlowRun);
  const fetchRun = useServerFn(getFlowRun);
  const loadAgents = useServerFn(listAgents);

  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled flow");
  const [description, setDescription] = useState("");
  const [graph, setGraph] = useState<FlowGraph>({ nodes: [], connections: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>({});
  const [running, setRunning] = useState(false);
  const [panel, setPanel] = useState<"inspector" | "prompter">("prompter");
  const [runInput, setRunInput] = useState("");
  const [outputs, setOutputs] = useState<{ label: string; output: string }[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      setFlows((await load()) as unknown as FlowRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load flows");
    }
  };

  useEffect(() => {
    void refresh();
    void loadAgents()
      .then((rows) => setAgents(rows as unknown as AgentOption[]))
      .catch(() => undefined);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addNode = (kind: NodeKind) => {
    const id = `n_${Math.random().toString(36).slice(2, 8)}`;
    const node: FlowNode = {
      id,
      kind,
      subtype: NODE_SUBTYPES[kind]![0]!.value,
      label: `${kind} node`,
      x: 120 + graph.nodes.length * 40,
      y: 100 + graph.nodes.length * 60,
      config: {},
    };
    setGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelectedId(id);
    setPanel("inspector");
  };

  const selectedNode = graph.nodes.find((n) => n.id === selectedId) ?? null;

  const patchSelected = (patch: Partial<FlowNode>) => {
    if (!selectedId) return;
    setGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === selectedId ? { ...node, ...patch } : node)),
    });
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setGraph({
      nodes: graph.nodes.filter((n) => n.id !== selectedId),
      connections: graph.connections.filter((c) => c.from !== selectedId && c.to !== selectedId),
    });
    setSelectedId(null);
  };

  const persist = async () => {
    try {
      const saved = (await save({
        data: { id: flowId, name, description, nodes: graph.nodes, connections: graph.connections },
      })) as unknown as FlowRow;
      setFlowId(saved.id);
      toast.success("Flow saved");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    }
  };

  const openFlow = (flow: FlowRow) => {
    setFlowId(flow.id);
    setName(flow.name);
    setDescription(flow.description ?? "");
    setGraph({ nodes: flow.nodes ?? [], connections: flow.connections ?? [] });
    setStatuses({});
    setOutputs([]);
    setSelectedId(null);
  };

  const run = async () => {
    if (graph.nodes.length === 0) {
      toast.error("Add at least one node first");
      return;
    }
    setRunning(true);
    setOutputs([]);
    setStatuses(Object.fromEntries(graph.nodes.map((n) => [n.id, "idle" as NodeStatus])));

    try {
      const created = await createRun({ data: { flowId, graph } });
      const runId = created.runId;

      pollRef.current = setInterval(async () => {
        try {
          const live = (await fetchRun({ data: { runId } })) as {
            node_statuses: Record<string, NodeStatus>;
            status: string;
          };
          setStatuses(live.node_statuses ?? {});
        } catch {
          /* keep polling */
        }
      }, 500);

      const result = await start({ data: { runId, graph, input: runInput } });

      const finalRun = (await fetchRun({ data: { runId } })) as {
        node_statuses: Record<string, NodeStatus>;
        result: { outputs?: { label: string; output: string }[] } | null;
      };
      setStatuses(finalRun.node_statuses ?? {});
      setOutputs(finalRun.result?.outputs ?? []);
      if (result.error) toast.error(result.error);
      else toast.success("Flow finished");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Run failed");
    } finally {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setRunning(false);
    }
  };


  return (
    <AppShell fullBleed>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-48"
            aria-label="Flow name"
          />
          {KINDS.map((kind) => (
            <Button key={kind} size="sm" variant="secondary" onClick={() => addNode(kind)}>
              + {kind}
            </Button>
          ))}
          <Input
            value={runInput}
            onChange={(event) => setRunInput(event.target.value)}
            placeholder="Run input (optional)"
            className="h-8 w-56"
          />
          <Button size="sm" onClick={() => void run()} disabled={running}>
            {running ? "Running…" : "Run"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void persist()}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFlowId(null);
              setName("Untitled flow");
              setDescription("");
              setGraph({ nodes: [], connections: [] });
              setStatuses({});
              setOutputs([]);
            }}
          >
            New
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant={panel === "inspector" ? "default" : "ghost"}
              onClick={() => setPanel("inspector")}
            >
              Inspector
            </Button>
            <Button
              size="sm"
              variant={panel === "prompter" ? "default" : "ghost"}
              onClick={() => setPanel("prompter")}
            >
              Prompter
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-52 shrink-0 overflow-y-auto border-r border-border p-3 lg:block">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Saved flows</h3>
            <ul className="mt-2 space-y-1">
              {flows.map((flow) => (
                <li key={flow.id} className="flex items-center gap-1">
                  <button
                    className={
                      flow.id === flowId
                        ? "flex-1 truncate rounded px-2 py-1 text-left text-sm bg-secondary"
                        : "flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-secondary/60"
                    }
                    onClick={() => openFlow(flow)}
                  >
                    {flow.name}
                  </button>
                  <button
                    className="px-1 text-xs text-muted-foreground"
                    onClick={async () => {
                      await remove({ data: { id: flow.id } });
                      if (flow.id === flowId) setFlowId(null);
                      await refresh();
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {flows.length === 0 && (
                <li className="px-2 text-xs text-muted-foreground">No saved flows yet.</li>
              )}
            </ul>
          </aside>

          <div className="relative min-w-0 flex-1">
            <NodeCanvas
              graph={graph}
              statuses={statuses}
              selectedId={selectedId}
              agents={agents}
              onSelect={setSelectedId}
              onChange={setGraph}
            />
            {outputs.length > 0 && (
              <div className="absolute bottom-4 left-4 max-h-56 w-96 overflow-y-auto rounded-lg border border-border bg-card/95 p-3 text-xs backdrop-blur">
                <p className="mb-2 text-sm font-medium">Run output</p>
                {outputs.map((entry, index) => (
                  <div key={index} className="mb-2">
                    <p className="text-muted-foreground">{entry.label}</p>
                    <p className="whitespace-pre-wrap">{entry.output.slice(0, 1200)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="w-80 shrink-0 overflow-y-auto border-l border-border">
            {panel === "inspector" ? (
              <NodeInspector
                node={selectedNode}
                agents={agents}
                onChange={patchSelected}
                onDelete={deleteSelected}
              />
            ) : (
              <FlowPrompter
                onLoad={(newGraph, newName, newDescription) => {
                  setGraph(newGraph);
                  setName(newName || "Generated flow");
                  setDescription(newDescription);
                  setFlowId(null);
                  setStatuses({});
                  setSelectedId(null);
                  toast.success("Loaded onto canvas");
                }}
              />
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
