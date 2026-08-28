import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

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
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
      </header>

      <main className={cn("flex-1", fullBleed ? "min-h-0" : "mx-auto w-full max-w-6xl px-4 py-8")}>
        {children}
      </main>
    </div>
  );
}
