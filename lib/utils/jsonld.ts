/**
 * Serialization for inline JSON-LD script elements.
 *
 * JSON.stringify escapes quotes and control characters but leaves the "<"
 * character intact, so a value containing a closing script tag would
 * terminate the script element from inside a JSON string and the remainder
 * would be parsed as HTML -- the classic JSON-LD script breakout. Escaping
 * every "<" keeps the JSON valid (parsers decode it back on parse) while
 * making the breakout impossible.
 *
 * Dependency-free on purpose: the verify suite imports this file directly.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
