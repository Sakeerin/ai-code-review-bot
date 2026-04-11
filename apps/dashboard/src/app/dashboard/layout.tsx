import { auth } from "@repo/db/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({
    headers: requestHeaders,
  });

  if (!session?.user) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h2 className="font-bold text-lg">AI Code Review</h2>
          <p className="text-sm text-muted-foreground">{session.user.email}</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <Link href="/dashboard" className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground font-medium">
            Overview
          </Link>
          <Link href="/dashboard/repos" className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground font-medium">
            Repositories
          </Link>
          <Link href="/dashboard/history" className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground font-medium">
            Review History
          </Link>
          <Link href="/dashboard/billing" className="block px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground font-medium">
            Billing & Usage
          </Link>
        </nav>
        <div className="p-4 border-t border-border">
          <LogoutButton />
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 p-8">
        {children}
      </main>
    </div>
  );
}
