/**
 * Shared helpers for Module 7 (Docs, Wikis & Notepad).
 *
 * Page content is HTML produced by the client editor; we defang it
 * server-side BEFORE storing so stored content can never carry executable
 * script. Simple regex-based sanitizer by design (no new deps) — it strips
 * <script>/<style> blocks, on* event-handler attributes and javascript:
 * URLs, looping until a pass changes nothing so nested/overlapping payloads
 * (e.g. `<scr<script>ipt>`) cannot reassemble after one pass.
 */

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi;
const STYLE_BLOCK = /<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi;
const STRAY_SCRIPT_STYLE_TAG = /<\/?(?:script|style)\b[^>]*>/gi;
// on* handler attributes in any of the three HTML attribute value forms.
const ON_ATTR = /\son[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
// javascript: URLs inside url-bearing attributes (allowing embedded
// whitespace inside the scheme, a common filter-evasion trick).
const JS_URL =
  /(\s(?:href|src|xlink:href|action|formaction|data)\s*=\s*)(["']?)\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:[^"'\s>]*/gi;

/** Strip script/style blocks, on* attributes and javascript: URLs. */
export function sanitizeContent(input: string): string {
  let out = input;
  let prev: string;
  do {
    prev = out;
    out = out
      .replace(SCRIPT_BLOCK, "")
      .replace(STYLE_BLOCK, "")
      .replace(STRAY_SCRIPT_STYLE_TAG, "")
      .replace(ON_ATTR, "")
      .replace(JS_URL, "$1$2#");
  } while (out !== prev);
  return out;
}
