// Minimal, house-style-only frontmatter reader for SKILL.md. This is not a
// general YAML parser — it only understands the single-line `key: value`
// shape our own skills use for `name`, `description`, and `license`. If a
// skill ever needs multi-line YAML in those fields, this needs to grow, or
// they need to switch to a real parser.

/** Split a SKILL.md file into its frontmatter block and body. */
export function splitFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: text };
  return { frontmatter: match[1], body: match[2] };
}

/** Pull a single-line scalar field (`key: value`, optionally quoted) out of a frontmatter block. */
export function readScalarField(frontmatter, key) {
  const line = frontmatter
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}:`));
  if (line === undefined) return undefined;
  let value = line.slice(key.length + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}
