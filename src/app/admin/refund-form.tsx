"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// FR-44: admin can refund minutes.
export function RefundForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);

  async function handleRefund() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, minutes }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={1}
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
        aria-label="Minutes to refund"
        className="w-16 rounded-md border p-1 text-sm"
      />
      <Button size="sm" variant="outline" disabled={busy} onClick={handleRefund}>
        Refund
      </Button>
    </div>
  );
}
