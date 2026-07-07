export const DEFAULT_PAYLOAD = JSON.stringify(
  {
    method: "GET",
    path: "/",
    query: "",
    headers: { "Content-Type": "application/json" },
    body: {},
  },
  null,
  2,
);

// The pool manager expects body as a string and header values as arrays.
// Accept the friendlier forms (object body, plain string headers) and
// convert them before sending.
function stringifyValue(v: unknown): string {
  return typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
}

export function normalizeEvent(raw: unknown): string {
  const event = { ...(raw as Record<string, unknown>) };
  if (event.body !== undefined && typeof event.body !== "string") {
    event.body = JSON.stringify(event.body);
  }
  const headers: Record<string, string[]> = {};
  if (event.headers && typeof event.headers === "object") {
    for (const [k, v] of Object.entries(event.headers)) {
      headers[k] = Array.isArray(v)
        ? v.map(stringifyValue)
        : [stringifyValue(v)];
    }
  }
  event.headers = headers;
  return JSON.stringify(event);
}

const BRACKET_PAIRS: Record<string, string> = { "{": "}", "[": "]", '"': '"' };

// Editor-style typing helpers for the payload textarea: auto-close brackets
// and quotes, skip over existing closers, delete empty pairs with backspace,
// and keep indentation on Enter.
export function handleJsonKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  onChange: (value: string) => void,
) {
  const ta = e.currentTarget;
  const { selectionStart: start, selectionEnd: end, value } = ta;

  // Typing a closer that's already next: just move past it
  if (
    (e.key === "}" || e.key === "]" || e.key === '"') &&
    start === end &&
    value[start] === e.key
  ) {
    e.preventDefault();
    ta.selectionStart = ta.selectionEnd = start + 1;
    return;
  }

  // Opening bracket/quote: insert the pair, or wrap the selection
  if (BRACKET_PAIRS[e.key]) {
    e.preventDefault();
    if (start !== end) {
      const selected = value.slice(start, end);
      ta.setRangeText(
        e.key + selected + BRACKET_PAIRS[e.key],
        start,
        end,
        "end",
      );
    } else {
      ta.setRangeText(e.key + BRACKET_PAIRS[e.key], start, end, "start");
      ta.selectionStart = ta.selectionEnd = start + 1;
    }
    onChange(ta.value);
    return;
  }

  // Backspace inside an empty pair removes both characters
  if (e.key === "Backspace" && start === end && start > 0) {
    if (BRACKET_PAIRS[value[start - 1]] === value[start]) {
      e.preventDefault();
      ta.setRangeText("", start - 1, start + 1, "end");
      onChange(ta.value);
    }
    return;
  }

  // Enter: keep the current line's indentation; when between a bracket
  // pair, open it out with an indented blank line
  if (e.key === "Enter" && start === end) {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const indent = value.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "";
    const prev = value[start - 1];
    const next = value[start];
    e.preventDefault();
    if ((prev === "{" && next === "}") || (prev === "[" && next === "]")) {
      ta.setRangeText(`\n${indent}  \n${indent}`, start, end, "start");
      ta.selectionStart = ta.selectionEnd = start + 1 + indent.length + 2;
    } else {
      ta.setRangeText(`\n${indent}`, start, end, "end");
    }
    onChange(ta.value);
  }
}
