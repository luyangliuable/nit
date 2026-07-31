// Ports of filter_diff and valid_right_lines from pr-review-bot.sh.

const LOCK_BASENAMES = new Set([
  "uv.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
]);

function isDroppablePath(secpath: string): boolean {
  const bn = secpath.replace(/.*\//, "");
  if (LOCK_BASENAMES.has(bn)) return true;
  if (/\.(lock|map|snap)$/.test(secpath)) return true;
  if (/\.min\.(js|css)$/.test(secpath)) return true;
  return false;
}

// Drop whole sections for generated/lock/binary files and neutralize
// pathologically long content lines, preserving the +/-/space prefix so RIGHT
// side line numbering stays accurate.
export function filterDiff(input: string, maxLine = 2000): string {
  const lines = input.split("\n");
  const out: string[] = [];
  let secpath = "";
  let isbinary = false;
  let buf: string[] = [];
  let dropped = 0;

  const flush = () => {
    if (secpath === "") return;
    const drop = isDroppablePath(secpath) || isbinary;
    if (drop) {
      dropped++;
    } else {
      for (const b of buf) out.push(b);
    }
    secpath = "";
    isbinary = false;
    buf = [];
  };

  for (const raw of lines) {
    if (raw.startsWith("diff --git ")) {
      flush();
      const parts = raw.split(/\s+/);
      secpath = (parts[parts.length - 1] ?? "").replace(/^b\//, "");
      isbinary = false;
      buf = [raw];
      continue;
    }

    let line = raw;
    if (/^Binary files .* differ$/.test(raw)) isbinary = true;
    if (
      line.length > maxLine &&
      /^[+ -]/.test(line) &&
      !/^(\+\+\+|---) /.test(line)
    ) {
      const c = line.charAt(0);
      line = `${c}[long line omitted: ${raw.length} chars]`;
    }

    if (secpath === "") {
      out.push(line);
    } else {
      buf.push(line);
    }
  }

  flush();
  if (dropped > 0) {
    out.push("");
    out.push(`[${dropped} generated/lock/binary file(s) omitted from this review]`);
  }
  return out.join("\n");
}

// Emit the set of commentable RIGHT side lines as "path\tline" strings. Added
// ('+') and context (' ') lines are commentable on the new side.
export function validRightLines(diff: string): Set<string> {
  const result = new Set<string>();
  let path = "";
  let newno = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const parts = line.split(/\s+/);
      path = (parts[1] ?? "").replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("@@ ")) {
      const fields = line.split(/\s+/);
      let tok = "";
      for (const f of fields) {
        if (/^\+[0-9]/.test(f)) {
          tok = f;
          break;
        }
      }
      tok = tok.replace(/^\+/, "");
      const a = tok.split(",");
      newno = parseInt(a[0] ?? "0", 10) || 0;
      continue;
    }
    if (line.startsWith("+")) {
      if (path !== "" && path !== "/dev/null") result.add(`${path}\t${newno}`);
      newno++;
      continue;
    }
    if (line.startsWith(" ")) {
      if (path !== "" && path !== "/dev/null") result.add(`${path}\t${newno}`);
      newno++;
      continue;
    }
    if (line.startsWith("-")) {
      continue;
    }
  }
  return result;
}

export function isCommentableLine(
  valid: Set<string>,
  path: string,
  line: number,
): boolean {
  return valid.has(`${path}\t${line}`);
}
