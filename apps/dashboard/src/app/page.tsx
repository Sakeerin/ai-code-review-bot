import { auth } from "@repo/db/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInButton } from "@/components/sign-in-button";

export default async function HomePage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({
    headers: requestHeaders
  });

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
        <div className="flex justify-center">
          <SignInButton />
        </div>
      </div>
    </main>
  );
}
