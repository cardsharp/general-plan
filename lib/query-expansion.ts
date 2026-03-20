type SynonymRule = {
  match: RegExp;
  terms: string[];
};

const RULES: SynonymRule[] = [
  {
    match: /\bgrant(s)?\b/i,
    terms: ["state sponsored funding", "state funding", "federal funding", "funding assistance"],
  },
  {
    match: /\bfund(ing)?\b/i,
    terms: ["grant", "appropriation", "public financing", "state sponsored funding"],
  },
  {
    match: /\btrail(s)?\b/i,
    terms: ["pathway", "multi-use path", "easement", "trail corridor", "pedestrian route"],
  },
  {
    match: /\beasement(s)?\b/i,
    terms: ["right-of-way", "dedication", "recorded plat", "trail alignment"],
  },
  {
    match: /\bsubdivid(e|ed|ision|isions)\b/i,
    terms: ["parcel split", "lot line adjustment", "plat approval", "development application"],
  },
  {
    match: /\bzoning\b/i,
    terms: ["land use", "ordinance", "code requirement", "zone change"],
  },
  {
    match: /\bmih\b|\bmihp\b|\bmoderate income housing\b/i,
    terms: ["housing element", "state housing requirement", "affordable housing policy"],
  },
];

function dedupe(tokens: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const normalized = token.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(token.trim());
  }
  return out;
}

export function expandQuery(input: string) {
  const additions: string[] = [];
  for (const rule of RULES) {
    if (rule.match.test(input)) additions.push(...rule.terms);
  }

  const uniqueAdditions = dedupe(additions).slice(0, 16);
  if (uniqueAdditions.length === 0) {
    return {
      lexicalQuery: input,
      embeddingQuery: input,
      expansions: [] as string[],
    };
  }

  return {
    lexicalQuery: `${input} ${uniqueAdditions.join(" ")}`,
    embeddingQuery: `${input}\n\nRelated terms: ${uniqueAdditions.join(", ")}`,
    expansions: uniqueAdditions,
  };
}
