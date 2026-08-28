import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/hub", label: "AI Hub" },
  { to: "/agents", label: "Agents" },
  { to: "/flows", label: "Flows" },
  { to: "/connectors", label: "Connectors" },
] as const;

export function AppShell({
  children,
  fullBleed = false,
}: {
  children: ReactNode;
  fullBleed?: boolean;
}) {
  const { session, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <h1 className="text-2xl font-semibold">Sign in required</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Sign in with Google on the landing page to use the AI Hub.
        </p>
        <Link to="/">
          <Button variant="secondary">Go to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex items-center gap-1 border-b border-border bg-background/85 px-4 py-3 backdrop-blur">
        <Link to="/" className="wordmark mr-4 text-lg">
          PROJECT 5
        </Link>
        <nav className="flex flex-1 items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                pathname === item.to
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="hidden max-w-[180px] truncate text-xs text-muted-foreground sm:inline">
          {session.user.email}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </Button>
      </header>
      <main className={cn("flex-1", fullBleed ? "min-h-0" : "mx-auto w-full max-w-6xl px-4 py-8")}>
        {children}
      </main>
    </div>
  );
}
