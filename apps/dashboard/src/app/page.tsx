import { auth } from "@repo/db/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SignInButton } from "@/components/sign-in-button";

export default async function HomePage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">AI Code Review Bot</h1>
          <p className="text-muted-foreground text-lg">
            Automated, context-aware code reviews for modern frameworks.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <SignInButton />
          <Link
            href="/pricing"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
          >
            View pricing
          </Link>
        </div>
      </div>
    </main>
  );
}
