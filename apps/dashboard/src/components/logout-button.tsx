"use client";

import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  
  return (
    <button
      onClick={async () => {
        await signOut({
          fetchOptions: {
            onSuccess: () => {
              router.push("/");
            },
          },
        });
      }}
      className="w-full text-left px-3 py-2 text-sm rounded-md text-destructive hover:bg-destructive/10 font-medium transition-colors"
    >
      Sign out
    </button>
  );
}
