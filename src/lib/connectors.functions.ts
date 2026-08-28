import { createServerFn } from "@tanstack/react-start";

import { demoContext } from "./demo-context";

export const getConnectorStatus = createServerFn({ method: "GET" })
  .middleware([demoContext])
  .handler(async () => {
    const { connectorConfigured } = await import("./connectors.server");
    const { TOOL_CATALOG } = await import("./connector-catalog");
    return TOOL_CATALOG.map((entry) => ({
      id: entry.id,
      configured: connectorConfigured(entry.id),
    }));
  });

export const testConnectorAction = createServerFn({ method: "POST" })
  .middleware([demoContext])
  .inputValidator((input: { action: string; args?: Record<string, unknown> }) => {
    if (!input?.action) throw new Error("An action is required");
    return input;
  })
  .handler(async ({ data }) => {
    const { runConnectorAction } = await import("./connectors.server");
    try {
      const result = await runConnectorAction(data.action, data.args ?? {});
      return { ok: true as const, result: JSON.stringify(result).slice(0, 4000) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
