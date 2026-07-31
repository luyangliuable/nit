// Port of the repo normalization block in pr-review-bot.sh. Accepts full GitHub
// URLs and strips common accidental suffixes, yielding a bare owner/name.

export function normalizeRepo(input: string): string {
  let repo = input.trim();
  if (repo === "") return "";

  repo = repo.replace(/^http:\/\//, "").replace(/^https:\/\//, "");
  repo = repo.replace(/^github\.com\//, "");
  repo = repo.replace(/\.git$/, "");
  repo = repo.replace(/\/$/, "");
  repo = repo.replace(/\/pulls$/, "");
  repo = repo.replace(/\/(pull|pulls|issues|tree|blob)(\/.*)?$/, "");
  repo = repo.replace(/\/$/, "");
  return repo;
}

// Matches the require_tools validation: owner/name with no slashes or spaces
// inside either segment.
export function isValidRepo(repo: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(repo);
}
