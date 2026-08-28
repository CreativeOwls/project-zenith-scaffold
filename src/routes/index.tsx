import { Link, createFileRoute } from "@tanstack/react-router";

import { ConstellationBackdrop } from "@/components/ConstellationBackdrop";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";

const TITLE = "PROJECT 5 — DevFest Hackathon Scaffold";
const DESCRIPTION =
  "PROJECT 5 is a DevFest hackathon scaffold: an animated constellation landing page that opens straight into the AI hub.";

export const Route = createFileRoute("/")({
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
  component: Index,
});

function Index() {
  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background">
      <ConstellationBackdrop />
      <div aria-hidden="true" className="surface-glow pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="surface-vignette pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex w-full flex-col items-center gap-16 px-4">
        <Wordmark text="PROJECT 5" />

        <Link to="/hub">
          <Button variant="google" size="pill">
            Enter
          </Button>
        </Link>
      </div>
    </main>
  );
}
