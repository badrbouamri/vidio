// M8.6: draft Privacy Policy. [ASSUMPTION] — standard SaaS boilerplate,
// not reviewed by a lawyer; see docs/DECISIONS.md. Reflects the actual
// retention/deletion behavior implemented in M8.4, not aspirational claims.
export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-8">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">
        Last updated: draft — not yet reviewed by counsel.
      </p>

      <section>
        <h2 className="mb-1 font-medium">What we store</h2>
        <p className="text-sm text-muted-foreground">
          Your account info (email, plan), the videos you upload or import, the
          transcripts and clips generated from them, and usage records (processing
          minutes, job costs) used to enforce plan limits.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Retention</h2>
        <p className="text-sm text-muted-foreground">
          Source videos are automatically deleted 30 days after upload. You can delete
          a project (and its files) at any time from your dashboard. Generated clips
          you&apos;ve downloaded remain until you delete the project.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">How we use your content</h2>
        <p className="text-sm text-muted-foreground">
          Your videos and transcripts are processed solely to generate your clips
          (transcription, moment detection, rendering, translation, dubbing). We do
          not use your content to train AI models.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Third-party processing</h2>
        <p className="text-sm text-muted-foreground">
          We use third-party providers for authentication, storage, and AI
          processing (speech-to-text, text generation, text-to-speech) to deliver
          the service. These providers process your content only as needed to
          provide that processing.
        </p>
      </section>

      <section>
        <h2 className="mb-1 font-medium">Your rights</h2>
        <p className="text-sm text-muted-foreground">
          You can delete your projects at any time. Contact us to request a copy of
          your account data or full account deletion.
        </p>
      </section>
    </div>
  );
}
