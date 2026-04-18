const XXX_RE = /\bXXX\b/;

export const PLACEHOLDER_TOOLTIP =
  "Replace every XXX with a numeric value or name before playing.";

export function lineHasPlaceholder(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("//")) return false;
  if (t.startsWith("#")) return false;
  return XXX_RE.test(line);
}

export function scriptHasPlaceholder(text: string): boolean {
  return text.split("\n").some(lineHasPlaceholder);
}

export function recordValuesHavePlaceholder(r: Record<string, string>): boolean {
  return Object.values(r).some(scriptHasPlaceholder);
}
