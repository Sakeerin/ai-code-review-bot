"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function RepoToggle({ repoId, isActive }: { repoId: string; isActive: boolean }) {
  const [active, setActive] = useState(isActive)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function toggle() {
    setLoading(true)
    try {
      const res = await fetch(`/api/repos/${repoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !active }),
      })
      if (!res.ok) throw new Error("Failed to update")
      setActive((v) => !v)
      router.refresh()
    } catch {
      // no-op — button reverts visually
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow transition-colors disabled:opacity-50 ${
        active
          ? "border border-border hover:bg-accent"
          : "bg-primary text-primary-foreground hover:bg-primary/90"
      }`}
    >
      {loading ? "Updating…" : active ? "Deactivate" : "Activate"}
    </button>
  )
}
