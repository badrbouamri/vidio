import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PLAN_LIMITS } from "@/lib/plans";

const STEPS = [
  { title: "Upload or paste a link", body: "A video file, or a YouTube URL." },
  {
    title: "Pick your options",
    body: "Clip length, how many clips, subtitle style, and an optional dub language.",
  },
  {
    title: "We do the work",
    body: "Transcribe, find the best moments, cut, reframe to 9:16, burn in subtitles.",
  },
  {
    title: "Download & post",
    body: "Ranked clips with captions baked in — grab the MP4s (or a ZIP) and the SRT.",
  },
];

const FEATURES = [
  {
    title: "Ranked, ready-to-post clips",
    body: "Every clip is scored (hook, flow, value, trend) so you know which ones to post first.",
  },
  {
    title: "Speaker-aware reframing",
    body: "9:16 vertical output that tracks the active speaker, not a dumb center crop.",
  },
  {
    title: "Animated, styled captions",
    body: "Word-by-word karaoke-style subtitles, burned in, with style presets — including Arabic/RTL.",
  },
  {
    title: "Translate & dub",
    body: "Turn one clip into English, French, Arabic, German, or Spanish — subtitles or full audio dub.",
  },
];

// UI screen 1 (PRD §10): value prop, examples, pricing, CTA.
export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-6 px-8 py-24 text-center">
        <h1 className="text-5xl font-semibold tracking-tight">Nabd</h1>
        <p className="max-w-lg text-lg text-muted-foreground">
          Turn long videos into ranked, ready-to-post short clips — cut, reframed
          to 9:16, subtitled, and optionally dubbed into another language.
        </p>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link href="/sign-up">Get started free</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl px-8 py-16">
        <h2 className="mb-8 text-center text-2xl font-semibold">How it works</h2>
        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border p-5">
              <span className="text-sm font-medium text-muted-foreground">
                Step {i + 1}
              </span>
              <h3 className="mt-1 mb-1 font-medium">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto w-full max-w-4xl px-8 py-16">
        <h2 className="mb-8 text-center text-2xl font-semibold">
          Built for creators, podcasters, and clipping teams
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-lg border p-5">
              <h3 className="mb-1 font-medium">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-3xl px-8 py-16">
        <h2 className="mb-8 text-center text-2xl font-semibold">Plans</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="rounded-lg border p-6">
            <h3 className="mb-1 text-lg font-medium">Free</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Try it out on your own videos.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              <li>{PLAN_LIMITS.free.minutesPerMonth} processing minutes / month</li>
              <li>Up to {PLAN_LIMITS.free.maxHeight}p exports</li>
              <li>Watermarked exports</li>
            </ul>
          </div>
          <div className="rounded-lg border p-6">
            <div className="mb-1 flex items-center gap-2">
              <h3 className="text-lg font-medium">Pro</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Coming soon
              </span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              For creators posting regularly.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              <li>{PLAN_LIMITS.pro.minutesPerMonth} processing minutes / month</li>
              <li>Up to {PLAN_LIMITS.pro.maxHeight}p exports, no watermark</li>
              <li>Translation & dubbing</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="flex flex-col items-center gap-4 px-8 py-20 text-center">
        <h2 className="text-2xl font-semibold">Ready to try it?</h2>
        <Button asChild size="lg">
          <Link href="/sign-up">Get started free</Link>
        </Button>
      </section>

      <footer className="flex justify-center gap-6 border-t p-6 text-sm text-muted-foreground">
        <Link href="/terms" className="hover:underline">
          Terms
        </Link>
        <Link href="/privacy" className="hover:underline">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
