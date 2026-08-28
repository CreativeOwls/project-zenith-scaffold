import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendChat, type ChatTurn } from "@/lib/chat.functions";

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

type Turn = ChatTurn & { trace?: { agentName: string; depth: number; reply: string }[] };

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
        <h1 className="text-2xl font-semibold tracking-tight">AI Hub Orchestrator Hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One orchestrator, your agents, your connectors. It delegates when a specialist fits.
        </p>

        <div className="mt-6 flex-1 space-y-4 overflow-y-auto rounded-xl border border-border bg-card/40 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Try: “Ask my research agent what people on Reddit say about AI note-taking apps, then email me a
              summary.”
            </p>
          )}
          {messages.map((message, index) => (
            <div key={index} className="space-y-2">
              <div
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm"
                    : "max-w-[90%] rounded-lg bg-card px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {message.content}
              </div>
              {message.trace && message.trace.length > 0 && (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {message.trace.map((entry, i) => (
                    <li key={i}>
                      ↳ delegated to <span className="text-accent-blue">{entry.agentName}</span> (depth{" "}
                      {entry.depth}): {entry.reply.slice(0, 160)}
                    </li>
                  ))}
                </ul>
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
