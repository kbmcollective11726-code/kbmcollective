/** Slug helpers for multi-track registration forms. */

export function slugifyFormName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'form';
}

/** Ensure uniqueness against existing slugs in the same event. */
export function uniqueFormSlug(base: string, existing: string[], excludeId?: string): string {
  const taken = new Set(
    existing
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  // Caller should pass only other forms' slugs; excludeId is reserved for future use.
  void excludeId;
  let candidate = slugifyFormName(base);
  if (!taken.has(candidate)) return candidate;
  let n = 2;
  while (taken.has(`${candidate}-${n}`)) n += 1;
  return `${candidate}-${n}`;
}
