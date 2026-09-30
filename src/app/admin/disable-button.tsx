"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// Edge case §11: "admin can disable accounts."
export function DisableButton({
  userId,
  isDisabled,
}: {
  userId: string;
  isDisabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleToggle() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/toggle-disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, disabled: !isDisabled }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={isDisabled ? "default" : "outline"}
      disabled={busy}
      onClick={handleToggle}
    >
      {isDisabled ? "Enable" : "Disable"}
    </Button>
  );
}
