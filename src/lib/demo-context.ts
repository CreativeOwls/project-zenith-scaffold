import { createMiddleware } from "@tanstack/react-start";

// Authentication was removed for the hackathon demo: every visitor shares one
// workspace identified by this fixed id, and all data access happens
// server-side with the trusted admin client.
export const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

export const demoContext = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return next({
    context: {
      supabase: supabaseAdmin,
      userId: DEMO_USER_ID,
    },
  });
});
