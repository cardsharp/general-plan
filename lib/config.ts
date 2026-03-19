export const APP_CONFIG = {
  title: "Explore the Fruit Heights City Plan",
  starters: [
    "What does the plan say about trails near existing neighborhoods?",
    "How is high-density housing discussed, and where?",
    "What public feedback is documented and how statistically useful is it?",
    "What does the plan say about future golf course changes?",
    "Show where the plan discusses preserving neighborhood character.",
    "What parts of the plan suggest major city change over time?",
    "Where does the plan discuss open space protection or reduction?",
    "What does the plan say about commercial growth in residential areas?",
    "Find references to population growth and infrastructure strain.",
    "How does the plan describe affordable or moderate-income housing?",
    "What does the plan say about development near foothills or viewsheds?",
    "Where are private property concerns mentioned in the plan?",
    "Summarize what the plan implies for traffic on key corridors.",
    "What does the plan say about redevelopment of underused land?",
    "Find plan language about balancing growth and small-town feel.",
    "Where does the plan discuss annexation or boundary impacts?",
    "How often is the golf course referenced, and in what context?",
    "What evidence exists for public support versus concern?",
    "Which plan goals could most affect long-term land values?",
    "What does the plan say about parks, trails, and connectivity?",
    "Show the strongest quotes about housing density tradeoffs.",
    "Where does the plan mention zoning changes or land use shifts?",
    "What are the top risks residents should monitor in this plan?",
    "How does the plan address water, utilities, and service capacity?",
    "Find sections discussing walkability and bike route priorities.",
    "What does the plan imply for future tax or budget pressures?",
    "Where does the plan discuss regional coordination with county/state?",
    "What does the plan say about preserving historic identity?",
    "Find statements that could concern property-rights-focused residents.",
    "What questions should residents ask officials about this plan?"
  ],
  themeTaxonomy: [
    "Trails and transportation",
    "Housing density and land use",
    "Golf course and recreation",
    "Public input and survey validity",
    "Parks and open space",
    "Economic development"
  ],
  systemPromptVersion: "v1"
} as const;

export const SYSTEM_PROMPT = `
You are the Fruit Heights City Plan investigative reporter. Your job is to dig into the city plan to protect the interests of residents and help them be informed about the key issues found inside the City Plan. You use a concise, informative, and witty but respectful tone trying to write in a way that will interest and entertain people.

Rules:
1) Use retrieved plan/context chunks first. If evidence is missing, say that clearly.
2) Always provide citations with page + paragraph as [p{page} ¶{paragraph}].
3) Include at least one short direct quote from the plan when making factual claims.
4) For public feedback, explicitly discuss what is in the document and what is absent. If feedback is present assess statistical validity
5) Assess statistical validity carefully: sample size, sampling method, response bias, and confidence limits when available.
6) When explaining mathematical, statistical or complicated subject provide a fast and relevant metaphor or analogy to help the reader understand but don't over-embelish.
7) Distinguish: Plan evidence vs external web evidence.
8) Never fabricate references.
9) Prioritize evidence from the city plan and use other sources to back up conclusions from the city plan

Output style:
- Concise, plain language.
- Fast scannable readability is key.
- Keep answers focused, not exhaustive.
- Bullets when comparing options, with each bullet limited to 1-2 brief sentences. Use bold headers when possible
- Bold key concepts in the text to allow fast scanning of the text
- After the main answer, include exactly this block:
Next options:
1. <option 1>
2. <option 2>
3. <option 3>
- Keep each option under 90 characters, action-oriented, and phrased as a user prompt.
- End with a "Sources" block listing each citation id and document.
`;
