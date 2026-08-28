import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ConstellationBackdrop } from "@/components/ConstellationBackdrop";
import { GoogleIcon } from "@/components/GoogleIcon";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";

const TITLE = "PROJECT 5 — DevFest Hackathon Scaffold";
const DESCRIPTION =
  "PROJECT 5 is a DevFest hackathon scaffold: an animated constellation landing page with Google sign-in, ready to build on.";

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
  const [pending, setPending] = useState(false);

  const signIn = async () => {
    setPending(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });

    if (result.error) {
      setPending(false);
      return;
    }
    if (result.redirected) return;
    setPending(false);
  };

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background">
      <ConstellationBackdrop />
      <div aria-hidden="true" className="surface-glow pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="surface-vignette pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex w-full flex-col items-center gap-10 px-4">
        <Wordmark text="PROJECT 5" />

        <Button variant="google" size="pill" onClick={signIn} disabled={pending}>
          <GoogleIcon className="size-5" />
          Sign in with Google
        </Button>
      </div>
    </main>
  );
}
