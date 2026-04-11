"use client";

import { signIn } from "@/lib/auth-client";
import { useState } from "react";

export function SignInButton() {
  const [loading, setLoading] = useState(false);

  return (
    <button
      onClick={async () => {
        setLoading(true);
        await signIn.social({
          provider: "github",
          callbackURL: "/dashboard",
        });
      }}
      disabled={loading}
      className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      {loading ? "Signing in..." : "Continue with GitHub"}
    </button>
  );
}
