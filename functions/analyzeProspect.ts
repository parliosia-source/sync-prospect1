import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const HUNTER_KEY = Deno.env.get("HUNTER_API_KEY");
const BRAVE_KEY  = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

// ── Brave helpers ──────────────────────────────────────────────────────────────
const braveRLState = { remaining: -1, reset: -1, count429: 0 };

function parseBraveHeaders(res) {
  const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1", 10);
  const reset     = parseInt(res.headers.get("X-RateLimit-Reset")     || "-1", 10);
  if (remaining !== -1) braveRLState.remaining = remaining;
  if (reset     !== -1) braveRLState.reset     = reset;
}

async function waitForBraveReset(minWaitMs = 1000) {
  const waitMs = braveRLState.reset > 0 ? Math.max(braveRLState.reset * 1000, minWaitMs) : minWaitMs;
  await new Promise(r => setTimeout(r, waitMs));
}

async function braveQuery(query, count = 5, retries = 2) {
  if (!BRAVE_KEY) return [];
  if (braveRLState.remaining === 0 && braveRLState.reset > 0) await waitForBraveReset();
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&extra_snippets=true&country=ca&search_lang=fr`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
      parseBraveHeaders(res);
      if (res.status === 429) { braveRLState.count429++; if (attempt < retries - 1) { await waitForBraveReset(Math.pow(2, attempt) * 1000); continue; } return []; }
      if (!res.ok) return [];
      if (braveRLState.remaining === 0) await waitForBraveReset(1000);
      const data = await res.json();
      return data.web?.results || [];
    } catch (_) { return []; }
  }
  return [];
}

async function serpQuery(query, count = 5) {
  if (!SERPAPI_KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${count}&api_key=${SERPAPI_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.organic_results || [];
  } catch (_) { return []; }
}

async function kbFreshnessSnippet(domain) {
  const query = `site:${domain} (événement OR conférence OR gala OR congrès OR assemblée)`;
  const results = await braveQuery(query, 3);
  return results.map(r => r.extra_snippets?.[0] || r.description || "").filter(Boolean).join(" ").slice(0, 500) || null;
}

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, response_format: { type: "json_object" } })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function hunterDomainSearch(domain, company) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&company=${encodeURIComponent(company || "")}&limit=5&api_key=${HUNTER_KEY}`;
  const res = await fetch(url);
  return res.json();
}

// ── Decision Maker Discovery via LinkedIn (SERP) ──────────────────────────────
async function findDecisionMakers(companyName, domain) {
  const candidates = [];
  const seen = new Set();

  const queries = [
    `site:linkedin.com/in "${companyName}" (Directeur OR Directrice OR VP OR "Vice-Président" OR "Head of" OR Responsable OR "Chef de") (marketing OR communications OR événements OR event OR "relations publiques")`,
    `site:linkedin.com/in "${domain}" (Directeur OR VP OR Responsable) (marketing OR communications OR événement)`,
    `"${companyName}" linkedin.com/in (Directeur marketing OR "VP Communications" OR "Responsable événements" OR "Chargé de communications" OR "Gestionnaire événements")`,
    `site:linkedin.com/in "${companyName}" (Director OR Manager OR "Head of") (Marketing OR Communications OR Events)`,
  ];

  for (const q of queries) {
    if (candidates.length >= 5) break;
    let results = await braveQuery(q, 8);
    if (results.length === 0) results = await serpQuery(q, 5);

    for (const r of results) {
      if (candidates.length >= 5) break;
      const url = r.url || r.link || "";
      if (!url.includes("linkedin.com/in/")) continue;

      const cleanUrl = url.split("?")[0].replace(/\/$/, "").replace(/\/[a-z]{2}_[A-Z]{2}$/, "");
      if (seen.has(cleanUrl)) continue;
      seen.add(cleanUrl);

      const title   = r.title   || "";
      const snippet = r.description || r.snippet || "";

      const nameMatch = title.match(/^([A-ZÀ-ÿ][a-zà-ÿ'-]+(?: [A-ZÀ-ÿ][a-zà-ÿ'-]+){1,3})\s*[-–|]/);
      const fullName  = nameMatch ? nameMatch[1].trim() : null;

      const roleMatch = title.match(/[-–|]\s*([^|–\-]{5,80})(?:\s*[-–|]|$)/);
      const role = roleMatch ? roleMatch[1].trim() : (snippet.slice(0, 100) || "");

      candidates.push({
        fullName,
        title: role,
        linkedinUrl: cleanUrl,
        sourceUrl: cleanUrl,
        confidence: fullName ? 0.85 : 0.5,
      });
    }
  }

  const PRIORITY = /directeur|directrice|vp |vice.pr[eé]|chef|head of|responsable|manager|gestionnaire|chargé/i;
  const EVENT    = /marketing|communication|événement|event|expérience|brand|relations|public/i;

  candidates.sort((a, b) => {
    const score = (x) =>
      (PRIORITY.test(x.title || "") ? 3 : 0) +
      (EVENT.test(x.title    || "") ? 2 : 0) +
      (x.fullName                   ? 1 : 0);
    return score(b) - score(a);
  });

  return candidates.slice(0, 3);
}

// ── Save contacts — always guarantee at least one ─────────────────────────────
async function saveContacts(base44, prospectId, prospect, hunterContacts, decisionMakers, aiTitles) {
  const savedContacts = [];

  // 1. Hunter contacts (have email — best quality)
  for (const hc of hunterContacts) {
    const existing = await base44.entities.Contact.filter({ prospectId, email: hc.value });
    const linkedinDM = decisionMakers.find(dm =>
      dm.fullName && hc.first_name && hc.last_name &&
      dm.fullName.toLowerCase().includes(hc.first_name.toLowerCase()) &&
      dm.fullName.toLowerCase().includes(hc.last_name.toLowerCase())
    );
    const linkedinUrl = hc.linkedin || linkedinDM?.linkedinUrl || "";
    if (existing.length === 0) {
      const c = await base44.entities.Contact.create({
        prospectId,
        ownerUserId:     prospect.ownerUserId,
        firstName:       hc.first_name || "",
        lastName:        hc.last_name  || "",
        fullName:        `${hc.first_name || ""} ${hc.last_name || ""}`.trim(),
        title:           hc.position   || "",
        email:           hc.value,
        emailConfidence: hc.confidence,
        linkedinUrl,
        hasEmail: true,
        source: "HUNTER",
      });
      savedContacts.push(c);
    }
  }

  // 2. LinkedIn-only DMs (not matched to Hunter)
  const hunterNames = hunterContacts.map(h => `${h.first_name || ""} ${h.last_name || ""}`.trim().toLowerCase());
  for (const dm of decisionMakers) {
    if (!dm.linkedinUrl) continue;
    const alreadySaved = dm.fullName && hunterNames.some(n => n && dm.fullName && n.includes(dm.fullName.split(" ")[0]?.toLowerCase()));
    if (alreadySaved) continue;
    const existing = await base44.entities.Contact.filter({ prospectId, linkedinUrl: dm.linkedinUrl }).catch(() => []);
    if (existing.length === 0) {
      const c = await base44.entities.Contact.create({
        prospectId,
        ownerUserId:    prospect.ownerUserId,
        fullName:       dm.fullName  || "",
        title:          dm.title     || "",
        linkedinUrl:    dm.linkedinUrl,
        hasEmail:       false,
        source:         "SERP",
        contactPageUrl: dm.sourceUrl || "",
      });
      savedContacts.push(c);
    }
  }

  // 3. Fallback: AI-generated title stubs — ALWAYS create at least 2 if no contacts found
  const existingCount = await base44.entities.Contact.filter({ prospectId }).then(r => r.length).catch(() => 0);
  if (existingCount === 0 && aiTitles?.length > 0) {
    for (const title of aiTitles.slice(0, 2)) {
      const existing = await base44.entities.Contact.filter({ prospectId, title });
      if (existing.length === 0) {
        await base44.entities.Contact.create({
          prospectId,
          ownerUserId:    prospect.ownerUserId,
          title,
          hasEmail:       false,
          contactPageUrl: `https://${prospect.domain}/contact`,
          source:         "SERP",
        });
      }
    }
  }

  return savedContacts;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { prospectId } = body;
  const freshnessEnabled = body.freshnessEnabled !== false;

  if (!prospectId) return Response.json({ error: "prospectId requis" }, { status: 400 });

  const prospects = await base44.entities.Prospect.filter({ id: prospectId });
  const prospect = prospects[0];
  if (!prospect) return Response.json({ error: "Prospect introuvable" }, { status: 404 });
  if (prospect.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // KB freshness snippet
  let snippetToUse = prospect.serpSnippet || "";
  let freshnessUsed = false;
  if (prospect.sourceOrigin === "KB_TOPUP" && prospect.domain && freshnessEnabled) {
    const liveSnippet = await kbFreshnessSnippet(prospect.domain);
    if (liveSnippet) { snippetToUse = liveSnippet; freshnessUsed = true; }
  }

  // Run AI analysis + decision maker search in parallel
  const [analysis, decisionMakers] = await Promise.all([
    callOpenAI([
      {
        role: "system",
        content: `Tu es un expert en prospection B2B pour SYNC Productions (Montréal).
SYNC = partenaire audiovisuel événementiel : son, éclairage, captation vidéo, webdiffusion/hybride pour conférences, congrès, assemblées générales, galas, formations internes, townhalls.
ICP : entreprises/organisations qui ORGANISENT leurs propres événements corporatifs.
Ton : professionnel, concis, FR-CA. Tu n'inventes aucun fait. JSON strict uniquement.`
      },
      {
        role: "user",
        content: `Analyse ce prospect pour SYNC Productions:

Entreprise: ${prospect.companyName}
Site: ${prospect.website}
Domaine: ${prospect.domain}
Industrie: ${prospect.industry || "inconnue"}
Localisation: ${JSON.stringify(prospect.location || {})}
Type: ${prospect.entityType || ""}
Snippet: ${snippetToUse}
Source: ${prospect.sourceOrigin || "WEB"}

Réponds en JSON:
{
  "relevanceScore": number (0-100, based on likelihood of organising own events needing AV),
  "segment": "HOT|STANDARD",
  "relevanceReasons": ["raison 1", "raison 2", "raison 3"],
  "opportunities": [{"label": string, "detail": string}],
  "painPoints": [{"label": string, "detail": string}],
  "eventTypes": ["types d'événements probables"],
  "recommendedApproach": "angle d'approche SYNC en 1-2 phrases concrètes, axé réduction de risque / qualité AV / hybridation",
  "decisionMakerTitles": ["titres précis des décideurs à cibler (ex: Directeur marketing, VP Communications, Responsable événements, Directrice communications)"]
}`
      }
    ]),
    findDecisionMakers(prospect.companyName, prospect.domain),
  ]);

  // Hunter contacts
  let hunterContacts = [];
  let hunterError = null;
  try {
    const hr = await hunterDomainSearch(prospect.domain, prospect.companyName);
    if (hr?.data?.emails) {
      hunterContacts = hr.data.emails.filter(e => e.type === "personal" && e.confidence >= 50).slice(0, 3);
    } else if (hr?.errors) {
      hunterError = hr.errors[0]?.details || "Hunter error";
    }
  } catch (e) { hunterError = e.message; }

  // Save contacts — always guarantees at least one stub
  await saveContacts(base44, prospectId, prospect, hunterContacts, decisionMakers, analysis.decisionMakerTitles);

  // Update prospect
  await base44.entities.Prospect.update(prospectId, {
    status:              "ANALYSÉ",
    relevanceScore:      analysis.relevanceScore,
    segment:             analysis.segment,
    relevanceReasons:    analysis.relevanceReasons,
    opportunities:       analysis.opportunities,
    painPoints:          analysis.painPoints,
    eventTypes:          analysis.eventTypes,
    recommendedApproach: analysis.recommendedApproach,
    analysisRaw:         analysis,
    analysisError:       null,
    analysisErrorAt:     null,
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType:  "ANALYZE_PROSPECT",
    entityType:  "Prospect",
    entityId:    prospectId,
    payload:     { relevanceScore: analysis.relevanceScore, segment: analysis.segment, freshnessUsed, hunterError, decisionMakersFound: decisionMakers.length },
    status:      "SUCCESS",
  });

  return Response.json({ success: true, analysis, hunterError, freshnessUsed, decisionMakersFound: decisionMakers.length });
});