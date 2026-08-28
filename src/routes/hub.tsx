import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";

import orchestratorAvatar from "@/assets/agent-orchestrator.jpg";
import { AppShell } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { avatarFor, initialsFor } from "@/lib/agent-avatars";
import { sendChat, type ChatTurn } from "@/lib/chat.functions";
import { TOOL_CATALOG } from "@/lib/connector-catalog";

const CONNECTOR_ACCENTS = [
  "border-blue-500/40 bg-blue-500/10 text-blue-400",
  "border-red-500/40 bg-red-500/10 text-red-400",
  "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
  "border-green-500/40 bg-green-500/10 text-green-400",
  "border-orange-500/40 bg-orange-500/10 text-orange-400",
];

const TITLE = "AI Hub — orchestrator chat | PROJECT 5";
const DESCRIPTION =
  "Talk to the PROJECT 5 orchestrator: it delegates work to your specialist agents and connector tools.";

export const Route = createFileRoute("/hub")({
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
  component: HubPage,
});

/** Flatten markdown to plain text for compact one-line previews. */
function stripMarkdown(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type TraceEntry = { agentName: string; model?: string; depth: number; reply: string };
type Turn = ChatTurn & { trace?: TraceEntry[] };

function AgentBadge({ entry }: { entry: TraceEntry }) {
  const avatar = avatarFor(entry.agentName);
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3">
      {avatar ? (
        <img
          src={avatar}
          alt={`${entry.agentName} avatar`}
          className="h-9 w-9 shrink-0 rounded-full border border-border object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold">
          {initialsFor(entry.agentName)}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold">
          {entry.agentName}
          {entry.model ? (
            <span className="ml-2 font-normal text-muted-foreground">{entry.model}</span>
          ) : null}
          <span className="ml-2 font-normal text-muted-foreground">· step {entry.depth}</span>
        </p>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{stripMarkdown(entry.reply)}</p>
      </div>
    </div>
  );
}

function HubPage() {
  const chat = useServerFn(sendChat);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const submit = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next: Turn[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const result = await chat({
        data: { messages: next.map(({ role, content }) => ({ role, content })) },
      });
      setMessages([
        ...next,
        { role: "assistant", content: result.reply, trace: result.trace },
      ]);
    } catch (error) {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: `Request failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-9rem)] flex-col">
        <div className="flex flex-col items-center text-center">
          <img
            src={orchestratorAvatar}
            alt="AI orchestrator avatar"
            width={1024}
            height={1024}
            className="h-20 w-20 rounded-full border border-border object-cover shadow-lg shadow-blue-500/10"
          />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">AI Hub Orchestrator Hub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One orchestrator, your agents, your connectors. It delegates when a specialist fits.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {TOOL_CATALOG.map((tool, index) => (
              <span
                key={tool.id}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${CONNECTOR_ACCENTS[index % CONNECTOR_ACCENTS.length]}`}
              >
                {tool.label}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-6 flex-1 space-y-4 overflow-y-auto rounded-xl border border-border bg-card/40 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Try: “Ask my research agent what people on Reddit say about AI note-taking apps, then email me a
              summary.”
            </p>
          )}
          {messages.map((message, index) => (
            <div key={index} className="space-y-2">
              {message.role === "user" ? (
                <div className="ml-auto max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm whitespace-pre-wrap">
                  {message.content}
                </div>
              ) : (
                <div className="max-w-[90%] rounded-lg bg-card px-4 py-3">
                  <Markdown>{message.content}</Markdown>
                </div>
              )}
              {message.trace && message.trace.length > 0 && (
                <div className="max-w-[90%] space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Agents used
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {message.trace.map((entry, i) => (
                      <AgentBadge key={i} entry={entry} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-sm text-muted-foreground">Orchestrating…</p>}
          <div ref={endRef} />
        </div>

        <div className="mt-4 flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Ask the orchestrator…"
            rows={2}
            className="resize-none"
          />
          <Button onClick={() => void submit()} disabled={busy || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
