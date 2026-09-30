// M8.6: draft Terms of Service. [ASSUMPTION] — standard SaaS boilerplate,
// not reviewed by a lawyer; see docs/DECISIONS.md. Covers PRD edge case §11
// ("Copyright/abuse → Terms require rights to content; admin can disable
// accounts") explicitly below.
export default function TermsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p className="text-sm text-muted-foreground">
        Last updated: draft — not yet reviewed by counsel.
      </p>

      <section>
        <h2 className="mb-1 font-medium">1. Your account</h2>
        <p className="text-sm text-muted-foreground">
          You&apos;re responsible for activity under your account and for keeping your
          credentials secure.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">2. Rights to your content</h2>
        <p className="text-sm text-muted-foreground">
          You must own, or have the necessary rights and permissions to use, every video
          you upload or import (including via YouTube URL) and to create derivative
          clips from it. You&apos;re solely responsible for ensuring you have the right
          to the content you process, and for how you use the clips we generate. Don&apos;t
          upload content that infringes someone else&apos;s copyright or other rights.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">3. Acceptable use</h2>
        <p className="text-sm text-muted-foreground">
          We may suspend or terminate accounts that violate these terms, infringe
          copyright, or otherwise abuse the service.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">4. Plans & billing</h2>
        <p className="text-sm text-muted-foreground">
          Free-tier usage is capped as described on the pricing page. Paid plans (once
          available) are billed per the terms shown at checkout.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">5. Disclaimer</h2>
        <p className="text-sm text-muted-foreground">
          The service is provided &quot;as is&quot; without warranties of any kind, to the
          extent permitted by law.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">6. Contact</h2>
        <p className="text-sm text-muted-foreground">
          Questions about these terms? Reach out via your account support channel.
        </p>
      </section>
    </div>
  );
}
