// Port of sanitize_text in pr-review-bot.sh. Strips AI attribution phrases,
// converts em dashes to hyphens, removes emojis and symbol ranges, collapses
// runs of spaces, then trims leading dangling punctuation and whitespace.

const EMOJI_RANGES = new RegExp(
  "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2190}-\\u{21FF}\\u{2B00}-\\u{2BFF}]",
  "gu",
);

function sanitizePlainText(input: string): string {
  let t = input;

  // Strip attribution phrases (case insensitive).
  t = t.replace(/\bas an? (?:ai|language model|assistant)\b[,:;]?\s*/gi, "");
  t = t.replace(
    /\bgenerated (?:by|with) (?:ai|claude|chatgpt|gpt|copilot|an? (?:ai|llm))\b[,:;]?\s*/gi,
    "",
  );
  t = t.replace(/\bco-authored-by:\s*claude\b.*$/gim, "");
  t = t.replace(/\b(claude|chatgpt|openai|anthropic)\b[,:;]?\s*/gi, "");

  // Em dash to hyphen.
  t = t.replace(/\u2014/g, "-");

  // Emojis and symbol ranges.
  t = t.replace(EMOJI_RANGES, "");

  // Collapse runs of spaces and tabs.
  t = t.replace(/[ \t]{2,}/g, " ");

  // Trim leading dangling punctuation and whitespace, then trailing whitespace.
  t = t.replace(/^[\s\p{P}]*/u, "").replace(/\s*$/u, "");

  return t;
}

export function sanitizeText(input: string): string {
  return sanitizePlainText(input);
}

// Comment bodies may contain GitHub ```suggestion fences. Preserve fenced code
// byte-for-byte so indentation remains commit-suggestion compatible, while
// applying the usual attribution/emoji cleanup to the prose around the fences.
export function sanitizeReviewComment(input: string): string {
  const fences: string[] = [];
  const placeholder = (i: number) => `NITFENCE${i}TOKEN`;
  const withoutFences = input.replace(/```[\s\S]*?```/g, (block) => {
    const idx = fences.push(block) - 1;
    return placeholder(idx);
  });
  let t = sanitizePlainText(withoutFences).replace(/[ \t]+\n/g, "\n");
  for (let i = 0; i < fences.length; i++) {
    t = t.replace(placeholder(i), fences[i]);
  }
  return t;
}
