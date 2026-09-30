export default function Forbidden() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold">403 — Forbidden</h1>
      <p className="text-muted-foreground">
        You don&apos;t have access to the admin dashboard.
      </p>
    </div>
  );
}
