// M5.7: builds a collision-free filename for a clip inside an export ZIP.
// Pulled out of the route handler so the naming/dedup logic is testable
// without Blob/DB access.
export function sanitizeClipFilename(title: string, fallbackId: string): string {
  const cleaned = title.replace(/[^a-z0-9-_ ]/gi, "").trim();
  return cleaned || fallbackId;
}

/** Mutates `usedNames`, adding the returned name. */
export function uniqueZipFilename(
  title: string,
  clipId: string,
  usedNames: Set<string>,
): string {
  let name = sanitizeClipFilename(title, clipId);
  while (usedNames.has(name)) {
    name = `${name}-${clipId.slice(0, 8)}`;
  }
  usedNames.add(name);
  return name;
}
