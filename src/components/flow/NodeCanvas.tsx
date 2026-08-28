import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  NODE_KIND_COLORS,
  hasInputPort,
  outputPorts,
  type FlowConnection,
  type FlowGraph,
  type FlowNode,
  type NodeStatus,
} from "@/lib/flow-types";

export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 92;

function portPosition(node: FlowNode, port: string) {
  const ports = outputPorts(node);
  const index = Math.max(0, ports.indexOf(port));
  const step = NODE_HEIGHT / (ports.length + 1);
  return { x: node.x + NODE_WIDTH, y: node.y + step * (index + 1) };
}

function inputPosition(node: FlowNode) {
  return { x: node.x, y: node.y + NODE_HEIGHT / 2 };
}

const STATUS_RING: Record<NodeStatus, string> = {
  idle: "ring-0",
  running: "ring-2 ring-accent-yellow flow-node-running",
  success: "ring-2 ring-accent-green",
  error: "ring-2 ring-accent-red",
};

export function NodeCanvas({
  graph,
  statuses,
  selectedId,
  agents = [],
  onSelect,
  onChange,
}: {
  graph: FlowGraph;
  statuses: Record<string, NodeStatus>;
  selectedId: string | null;
  agents?: { id: string; name: string; model?: string | null }[];
  onSelect: (id: string | null) => void;
  onChange: (graph: FlowGraph) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [pending, setPending] = useState<{ nodeId: string; port: string } | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const updateNode = useCallback(
    (id: string, patch: Partial<FlowNode>) => {
      onChange({
        ...graph,
        nodes: graph.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      });
    },
    [graph, onChange],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => Math.min(2, Math.max(0.35, z - event.deltaY * 0.0015)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (dragRef.current) {
        const drag = dragRef.current;
        updateNode(drag.id, {
          x: drag.nodeX + (event.clientX - drag.startX) / zoom,
          y: drag.nodeY + (event.clientY - drag.startY) / zoom,
        });
      } else if (panRef.current) {
        const p = panRef.current;
        setPan({ x: p.panX + (event.clientX - p.startX), y: p.panY + (event.clientY - p.startY) });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      panRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateNode, zoom]);

  const connect = (toNodeId: string) => {
    if (!pending) return;
    if (pending.nodeId === toNodeId) {
      setPending(null);
      return;
    }
    const exists = graph.connections.some(
      (c) => c.from === pending.nodeId && c.fromPort === pending.port && c.to === toNodeId,
    );
    if (!exists) {
      const connection: FlowConnection = {
        id: `c_${Math.random().toString(36).slice(2, 9)}`,
        from: pending.nodeId,
        fromPort: pending.port,
        to: toNodeId,
        toPort: "in",
      };
      onChange({ ...graph, connections: [...graph.connections, connection] });
    }
    setPending(null);
  };

  const removeConnection = (id: string) => {
    onChange({ ...graph, connections: graph.connections.filter((c) => c.id !== id) });
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] [background-size:22px_22px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).dataset["canvas"] === "bg") {
          panRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
          onSelect(null);
          setPending(null);
        }
      }}
    >
      <div data-canvas="bg" className="absolute inset-0" />

      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 h-[4000px] w-[4000px] overflow-visible">
          {graph.connections.map((connection) => {
            const from = graph.nodes.find((n) => n.id === connection.from);
            const to = graph.nodes.find((n) => n.id === connection.to);
            if (!from || !to) return null;
            const start = portPosition(from, connection.fromPort);
            const end = inputPosition(to);
            const mid = (start.y + end.y) / 2;
            const path = `M ${start.x} ${start.y} C ${start.x} ${mid}, ${end.x} ${mid}, ${end.x} ${end.y}`;

            const fromStatus = statuses[from.id] ?? "idle";
            const toStatus = statuses[to.id] ?? "idle";
            // A link is "live" while the handoff is happening, and "done" once both ends finished.
            const live = fromStatus === "success" && (toStatus === "running" || toStatus === "idle");
            const done = fromStatus === "success" && (toStatus === "success" || toStatus === "error");

            const baseStroke =
              connection.fromPort === "true" || connection.fromPort === "body"
                ? "var(--accent-green)"
                : connection.fromPort === "false"
                  ? "var(--accent-red)"
                  : "rgba(255,255,255,0.35)";
            const stroke = live ? "var(--accent-yellow)" : done ? "var(--accent-green)" : baseStroke;

            return (
              <g key={connection.id} className="pointer-events-auto">
                <path
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={live || done ? 2.4 : 1.6}
                  opacity={live ? 1 : done ? 0.85 : 1}
                  className={live ? "flow-link-live" : undefined}
                />
                {live ? (
                  <>
                    <path
                      d={path}
                      fill="none"
                      stroke="var(--accent-yellow)"
                      strokeWidth={6}
                      opacity={0.18}
                      className="flow-link-glow"
                    />
                    <circle r={4} fill="var(--accent-yellow)">
                      <animateMotion dur="1.1s" repeatCount="indefinite" path={path} />
                    </circle>
                  </>
                ) : null}
                <circle
                  cx={(start.x + end.x) / 2}
                  cy={mid}
                  r={6}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => removeConnection(connection.id)}
                />
              </g>
            );
          })}
        </svg>

        {graph.nodes.map((node) => {
          const status = statuses[node.id] ?? "idle";
          return (
            <div
              key={node.id}
              className={cn(
                "absolute select-none rounded-lg border-2 bg-card/90 px-3 py-2 shadow-lg backdrop-blur",
                NODE_KIND_COLORS[node.kind],
                STATUS_RING[status],
                selectedId === node.id && "outline outline-2 outline-foreground/60",
              )}
              style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(node.id);
                dragRef.current = {
                  id: node.id,
                  startX: event.clientX,
                  startY: event.clientY,
                  nodeX: node.x,
                  nodeY: node.y,
                };
              }}
            >
              {hasInputPort(node) && (
                <button
                  type="button"
                  title="input"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    connect(node.id);
                  }}
                  className={cn(
                    "absolute -top-2 left-1/2 size-3.5 -translate-x-1/2 rounded-full border border-foreground/50 bg-background",
                    pending && "border-accent-blue bg-accent-blue/40",
                  )}
                />
              )}

              <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                {node.kind} · {node.subtype}
              </p>
              <p className="mt-1 truncate text-sm font-medium">{node.label}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {node.kind === "action" && node.subtype === "agent"
                  ? (() => {
                      const agentId = typeof node.config?.["agentId"] === "string" ? node.config["agentId"] : "";
                      const agent = agents.find((a) => a.id === agentId);
                      return agent
                        ? `${agent.name} · ${agent.model ?? "default"}`
                        : "Orchestrator · auto-picks agent";
                    })()
                  : status === "idle"
                    ? ""
                    : status}
              </p>

              {outputPorts(node).map((port) => {
                const ports = outputPorts(node);
                const step = 100 / (ports.length + 1);
                const left = step * (ports.indexOf(port) + 1);
                const active = pending?.nodeId === node.id && pending.port === port;
                return (
                  <button
                    key={port}
                    type="button"
                    title={port}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPending(active ? null : { nodeId: node.id, port });
                    }}
                    className={cn(
                      "absolute -bottom-2 size-3.5 -translate-x-1/2 rounded-full border border-foreground/50 bg-background",
                      active && "border-accent-blue bg-accent-blue",
                      port === "true" || port === "body" ? "border-accent-green" : "",
                      port === "false" ? "border-accent-red" : "",
                    )}
                    style={{ left: `${left}%` }}
                  >
                    <span className="absolute left-1/2 top-4 -translate-x-1/2 text-[9px] text-muted-foreground">
                      {port === "out" ? "" : port}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-lg border border-border bg-card/80 px-2 py-1 text-xs backdrop-blur">
        <button className="px-2" onClick={() => setZoom((z) => Math.max(0.35, z - 0.1))}>
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="px-2" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
          +
        </button>
        <button
          className="px-2"
          onClick={() => {
            setZoom(1);
            setPan({ x: 40, y: 40 });
          }}
        >
          reset
        </button>
      </div>

      {pending && (
        <div className="absolute left-4 top-4 rounded-md border border-accent-blue bg-card/90 px-3 py-1.5 text-xs">
          Click a node's top input port to connect from “{pending.port}”.
        </div>
      )}
    </div>
  );
}
