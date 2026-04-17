import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-col min-h-screen items-center justify-center p-24 text-center">
      <h1 className="text-6xl font-extrabold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-600">
        AI Review Bot
      </h1>
      <p className="text-2xl mb-8 text-muted-foreground max-w-[600px]">
        Modern AI-native code review for GitHub and GitLab. 
        Framework-aware, team-specific, and lightning fast.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          Read Documentation
        </Link>
        <Link
          href="https://dashboard.aireviewbot.com"
          className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          Go to Dashboard
        </Link>
      </div>
      
      <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 text-left max-w-5xl">
        <div className="p-6 border rounded-xl bg-card">
          <h3 className="text-xl font-bold mb-2">Framework Aware</h3>
          <p className="text-muted-foreground">
            Built-in profiles for Laravel, Vue, and TypeScript. We know your stack's best practices.
          </p>
        </div>
        <div className="p-6 border rounded-xl bg-card">
          <h3 className="text-xl font-bold mb-2">Custom Rules</h3>
          <p className="text-muted-foreground">
            Define your team's specific rules in a simple YAML config file.
          </p>
        </div>
        <div className="p-6 border rounded-xl bg-card">
          <h3 className="text-xl font-bold mb-2">Multi-Platform</h3>
          <p className="text-muted-foreground">
            Full support for both GitHub Pull Requests and GitLab Merge Requests.
          </p>
        </div>
      </div>
    </main>
  );
}
