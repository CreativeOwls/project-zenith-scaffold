import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { TOOL_CATALOG } from "@/lib/connector-catalog";
import { getConnectorStatus, testConnectorAction } from "@/lib/connectors.functions";

const TITLE = "Connectors — Gmail, Slides, FHIR, Reddit | PROJECT 5";
const DESCRIPTION =
  "Connection status for the tools your agents and flows can call: Gmail, Google Slides, FHIR and Reddit.";

export const Route = createFileRoute("/connectors")({
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
  component: ConnectorsPage,
});

const SECRET_HINTS: Record<string, string[]> = {
  fhir: ["FHIR_BASE_URL", "FHIR_BEARER_TOKEN"],
  reddit: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
};

const SMOKE_TESTS: Record<string, { action: string; args: Record<string, unknown> }> = {
  gmail: { action: "gmail_search", args: { query: "is:unread", limit: 3 } },
  google_slides: { action: "slides_read", args: { presentationId: "" } },
  fhir: { action: "fhir_search_patient", args: { name: "a", limit: 2 } },
  reddit: { action: "reddit_get_top_posts", args: { subreddit: "artificial", timeframe: "week", limit: 3 } },
};

function ConnectorsPage() {
  const loadStatus = useServerFn(getConnectorStatus);
  const test = useServerFn(testConnectorAction);
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus()
      .then((rows) =>
        setStatus(Object.fromEntries((rows as { id: string; configured: boolean }[]).map((r) => [r.id, r.configured]))),
      )
      .catch(() => toast.error("Could not read connector status"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTest = async (id: string) => {
    const smoke = SMOKE_TESTS[id];
    if (!smoke) return;
    setTesting(id);
    try {
      const result = await test({ data: smoke });
      if (result.ok) toast.success(`${id}: call succeeded`);
      else toast.error(`${id}: ${result.error}`);
    } finally {
      setTesting(null);
    }
  };

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        These tools are available to agents (as tool calls) and to the node canvas (as tool nodes).
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {TOOL_CATALOG.map((tool) => {
          const configured = status[tool.id];
          return (
            <article key={tool.id} className="rounded-xl border border-border bg-card/50 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium">{tool.label}</h2>
                <span
                  className={
                    configured
                      ? "rounded-full border border-accent-green px-2 py-0.5 text-xs text-accent-green"
                      : "rounded-full border border-accent-yellow px-2 py-0.5 text-xs text-accent-yellow"
                  }
                >
                  {configured ? "connected" : "not configured"}
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{tool.description}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {tool.kind === "native" ? "Native Lovable connector" : "Custom backend integration"} · actions:{" "}
                {tool.actions.join(", ")}
              </p>
              {!configured && SECRET_HINTS[tool.id] && (
                <p className="mt-3 text-xs text-accent-yellow">
                  Add {SECRET_HINTS[tool.id]!.join(" and ")} in Project Settings → Secrets.
                </p>
              )}
              <Button
                className="mt-4"
                size="sm"
                variant="secondary"
                disabled={!configured || testing === tool.id}
                onClick={() => void runTest(tool.id)}
              >
                {testing === tool.id ? "Testing…" : "Test connection"}
              </Button>
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
