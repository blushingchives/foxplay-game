// Display form of a type-prefixed id (fn-/art-/log- + UUID): drop the
// prefix and show the first 8 hash characters, git-style. The full id
// remains the identity everywhere (URLs, API, DB) — this is cosmetic only.
export function shortId(id: string) {
  return id.replace(/^[a-z]+-/, "").slice(0, 8);
}
