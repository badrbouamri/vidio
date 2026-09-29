import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";

// Minimal entry point for M1/M2. Full marketing landing page is M8 (UI screen 1).
export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Nabd</h1>
      <p className="max-w-md text-muted-foreground">
        Turn long videos into ranked, ready-to-post short clips — cut,
        reframed, subtitled, and optionally dubbed.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/sign-up">Get started</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </div>
  );
}
