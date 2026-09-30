// M8.2: structured logs (the other half — Sentry — is blocked; see
// docs/DECISIONS.md). One JSON line per event so any log drain/aggregator
// can parse it without a schema; swap the `console` calls for a Sentry SDK
// call in each spot once that integration installs, no API change needed
// upstream.
type LogFields = Record<string, unknown>;

function line(level: "info" | "warn" | "error", event: string, fields?: LogFields) {
  return JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...fields,
  });
}

export const log = {
  info(event: string, fields?: LogFields) {
    console.log(line("info", event, fields));
  },
  warn(event: string, fields?: LogFields) {
    console.warn(line("warn", event, fields));
  },
  error(event: string, err: unknown, fields?: LogFields) {
    console.error(
      line("error", event, {
        ...fields,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
  },
};
