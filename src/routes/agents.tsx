import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AVAILABLE_MODELS_CLIENT } from "@/lib/models";
import { TOOL_CATALOG, type ToolId } from "@/lib/connector-catalog";
import { deleteAgent, listAgents, saveAgent, type AgentInput } from "@/lib/agents.functions";
import boltAvatar from "@/assets/agent-bolt.jpg";
import leslieAvatar from "@/assets/agent-leslie.jpg";
import rexAvatar from "@/assets/agent-rex.jpg";

const AGENT_AVATARS: Record<string, string> = {
  bolt: boltAvatar,
  leslie: leslieAvatar,
  rex: rexAvatar,
};

const avatarFor = (name: string) => AGENT_AVATARS[name.trim().toLowerCase()];

const TITLE = "Agent Hub — build specialist agents | PROJECT 5";
const DESCRIPTION =
  "Create, edit and delete AI agents with their own prompt, model, connector tools and delegation depth.";

export const Route = createFileRoute("/agents")({
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
  component: AgentsPage,
});

type AgentRow = AgentInput & { id: string; created_at: string };

const emptyAgent: AgentInput = {
  name: "",
  description: "",
  system_prompt: "",
  model: "google/gemini-2.5-flash",
  tools: [],
  delegation_enabled: false,
  max_delegation_depth: 1,
};

function AgentsPage() {
  const load = useServerFn(listAgents);
  const save = useServerFn(saveAgent);
  const remove = useServerFn(deleteAgent);

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [draft, setDraft] = useState<AgentInput>(emptyAgent);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setAgents((await load()) as unknown as AgentRow[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load agents");
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTool = (id: ToolId) => {
    setDraft((current) => ({
      ...current,
      tools: current.tools.includes(id)
        ? current.tools.filter((t) => t !== id)
        : [...current.tools, id],
    }));
  };

  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error("Give the agent a name");
      return;
    }
    setBusy(true);
    try {
      await save({ data: draft });
      toast.success(draft.id ? "Agent updated" : "Agent created");
      setDraft(emptyAgent);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight">Agent Hub</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Specialist agents the orchestrator can delegate to.
      </p>

      <div className="mt-6 space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Your agents ({agents.length})
          </h2>
          {agents.length === 0 && (
            <p className="text-sm text-muted-foreground">No agents yet — create one below.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const avatar = avatarFor(agent.name);
              return (
                <article
                  key={agent.id}
                  className="flex flex-col rounded-xl border border-border bg-card/50 p-4"
                >
                  <div className="flex items-center gap-3">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={`${agent.name} profile photo`}
                        loading="lazy"
                        width={512}
                        height={512}
                        className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-sm font-semibold">
                        {agent.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">{agent.name}</h3>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {agent.description}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 flex-1 text-xs text-muted-foreground">
                    {agent.model} · tools: {(agent.tools ?? []).join(", ") || "none"} · delegation{" "}
                    {agent.delegation_enabled ? `on (depth ${agent.max_delegation_depth})` : "off"}
                  </p>

                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setDraft({
                          id: agent.id,
                          name: agent.name,
                          description: agent.description ?? "",
                          system_prompt: agent.system_prompt,
                          model: agent.model,
                          tools: agent.tools ?? [],
                          delegation_enabled: agent.delegation_enabled,
                          max_delegation_depth: agent.max_delegation_depth,
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await remove({ data: { id: agent.id } });
                        toast.success("Agent deleted");
                        await refresh();
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>


        <section className="space-y-4 rounded-xl border border-border bg-card/50 p-5">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {draft.id ? "Edit agent" : "New agent"}
          </h2>

          <div className="space-y-2">
            <Label htmlFor="agent-name">Name</Label>
            <Input
              id="agent-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Research agent"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-description">Description</Label>
            <Input
              id="agent-description"
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Finds and summarises online discussion"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-prompt">System prompt</Label>
            <Textarea
              id="agent-prompt"
              rows={5}
              value={draft.system_prompt}
              onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
              placeholder="You are a research specialist…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-model">Model</Label>
            <select
              id="agent-model"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            >
              {AVAILABLE_MODELS_CLIENT.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Tools</Label>
            <div className="flex flex-wrap gap-2">
              {TOOL_CATALOG.map((tool) => {
                const active = draft.tools.includes(tool.id);
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => toggleTool(tool.id)}
                    className={
                      active
                        ? "rounded-full border border-accent-blue bg-secondary px-3 py-1 text-xs"
                        : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                    }
                  >
                    {tool.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <div>
              <Label htmlFor="agent-delegation">Can delegate further</Label>
              <p className="text-xs text-muted-foreground">Allow this agent to call other agents.</p>
            </div>
            <Switch
              id="agent-delegation"
              checked={draft.delegation_enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, delegation_enabled: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-depth">Max delegation depth</Label>
            <Input
              id="agent-depth"
              type="number"
              min={0}
              max={3}
              value={draft.max_delegation_depth}
              onChange={(e) =>
                setDraft({ ...draft, max_delegation_depth: Number(e.target.value) || 1 })
              }
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => void submit()} disabled={busy}>
              {draft.id ? "Save changes" : "Create agent"}
            </Button>
            {draft.id && (
              <Button variant="ghost" onClick={() => setDraft(emptyAgent)}>
                Cancel
              </Button>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
