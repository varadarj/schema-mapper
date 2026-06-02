export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-\s\.\/\\]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

export function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export function stringSimilarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  const ta = tokenize(a), tb = tokenize(b);
  const intersection = ta.filter((t) => tb.includes(t)).length;
  const jaccard = intersection / (ta.length + tb.length - intersection || 1);
  const editSim = 1 - levenshtein(na, nb) / (Math.max(na.length, nb.length) || 1);
  return Math.max(jaccard * 0.6 + editSim * 0.4, editSim * 0.5 + jaccard * 0.5);
}
