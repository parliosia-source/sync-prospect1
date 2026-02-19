import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const HUNTER_KEY = Deno.env.get("HUNTER_API_KEY");
const BRAVE_KEY  = Deno.env.get("BRAVE_API_KEY");

// ── Brave rate-limit helpers ──────────────────────────────────────────────────
const braveRLState = { remaining: -1, reset: -1 };

function parseBraveHeaders(res) {
  const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1", 10);
  const reset     = parseInt(res.headers.get("X-RateLimit-Reset")     || "-1", 10);
  if (remaining !== -1) braveRLState.remaining = remaining;
  if (reset     !== -1) braveRLState.reset     = reset;
}

async function waitForBraveReset(minWaitMs = 1000) {
  const waitMs = braveRLState.reset > 0
    ? Math.max(braveRLState.reset * 1000, minWaitMs)
    : minWaitMs;
  await new Promise(r => setTimeout(r, waitMs));
}

// KB freshness: 1 lightweight Brave call, with rate-limit handling
// maxFreshnessChecks = 0 means disabled
async function kbFreshnessSnippet(domain, retries = 2) {
  if (!BRAVE_KEY) return null;

  if (braveRLState.remaining === 0 && braveRLState.reset > 0) {
    await waitForBraveReset();
  }

  const query = `site:${domain} (événement OR conférence OR gala OR congrès OR AGA OR assemblée)`;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3&extra_snippets=true&country=ca`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
      parseBraveHeaders(res);

      if (res.status === 429) {
        if (attempt < retries - 1) { await waitForBraveReset(Math.pow(2, attempt) * 1000); continue; }
        return null;
      }
      if (!res.ok) return null;

      if (braveRLState.remaining === 0) await waitForBraveReset(1000);

      const data = await res.json();
      const results = data.web?.results || [];
      const snippet = results.map(r => r.extra_snippets?.[0] || r.description || "").filter(Boolean).join(" ").slice(0, 500);
      return snippet || null;
    } catch (_) { return null; }
  }
  return null;
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

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { prospectId } = body;
  // freshnessEnabled: passed by batch caller to enforce per-campaign budget
  const freshnessEnabled = body.freshnessEnabled !== false;

  if (!prospectId) return Response.json({ error: "prospectId requis" }, { status: 400 });

  const prospects = await base44.entities.Prospect.filter({ id: prospectId });
  const prospect = prospects[0];
  if (!prospect) return Response.json({ error: "Prospect introuvable" }, { status: 404 });
  if (prospect.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // 0. KB_TOPUP freshness: only if KB prospect AND enabled
  let freshnessSnippet = prospect.serpSnippet || "";
  let freshnessUsed = false;
  if (prospect.sourceOrigin === "KB_TOPUP" && prospect.domain && freshnessEnabled) {
    const liveSnippet = await kbFreshnessSnippet(prospect.domain);
    if (liveSnippet) { freshnessSnippet = liveSnippet; freshnessUsed = true; }
  }

  // 1. AI analysis
  const analysis = await callOpenAI([
    {
      role: "system",
      content: `Tu es un expert en prospection B2B pour SYNC Productions (partenaire audiovisuel à Montréal).
SYNC offre: son, éclairage, captation, webdiffusion/hybride pour événements corporatifs.
ICP: entreprises/organisations qui organisent leurs propres événements corporatifs (conférences, congrès, AGA, galas, formations internes, townhalls).
Tu n'inventes pas de faits. Sortie JSON strict uniquement.`
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
Snippet: ${freshnessSnippet}
Source: ${prospect.sourceOrigin || "WEB"}

Réponds en JSON:
{
  "relevanceScore": number (0-100),
  "segment": "HOT|STANDARD",
  "relevanceReasons": ["raison 1", "raison 2", "raison 3"],
  "opportunities": [{"label": string, "detail": string}],
  "painPoints": [{"label": string, "detail": string}],
  "eventTypes": ["types d'événements probables"],
  "recommendedApproach": "angle d'approche recommandé en 1-2 phrases",
  "decisionMakerTitles": ["titres des décideurs à cibler"]
}`
    }
  ]);

  // 2. Hunter contacts
  let hunterContacts = [];
  let hunterError = null;
  try {
    const hunterResult = await hunterDomainSearch(prospect.domain, prospect.companyName);
    if (hunterResult?.data?.emails) {
      hunterContacts = hunterResult.data.emails
        .filter(e => e.type === "personal" && e.confidence >= 50)
        .slice(0, 3);
    } else if (hunterResult?.errors) {
      hunterError = hunterResult.errors[0]?.details || "Hunter error";
    }
  } catch (e) {
    hunterError = e.message;
  }

  // 3. Create/update contacts
  for (const hc of hunterContacts) {
    const existing = await base44.entities.Contact.filter({ prospectId, email: hc.value });
    if (existing.length === 0) {
      await base44.entities.Contact.create({
        prospectId,
        ownerUserId: prospect.ownerUserId,
        firstName: hc.first_name || "",
        lastName: hc.last_name || "",
        fullName: `${hc.first_name || ""} ${hc.last_name || ""}`.trim(),
        title: hc.position || "",
        email: hc.value,
        emailConfidence: hc.confidence,
        linkedinUrl: hc.linkedin || "",
        hasEmail: true,
        source: "HUNTER",
      });
    }
  }

  // 4. Stub contacts from AI titles
  if (hunterContacts.length === 0 && analysis.decisionMakerTitles?.length > 0) {
    const contactPageUrl = `https://www.${prospect.domain}/contact`;
    for (const title of analysis.decisionMakerTitles.slice(0, 2)) {
      const existing = await base44.entities.Contact.filter({ prospectId, title });
      if (existing.length === 0) {
        await base44.entities.Contact.create({
          prospectId,
          ownerUserId: prospect.ownerUserId,
          title,
          hasEmail: false,
          contactPageUrl,
          source: "SERP",
        });
      }
    }
  }

  // 5. Update prospect
  await base44.entities.Prospect.update(prospectId, {
    status: "ANALYSÉ",
    relevanceScore: analysis.relevanceScore,
    segment: analysis.segment,
    relevanceReasons: analysis.relevanceReasons,
    opportunities: analysis.opportunities,
    painPoints: analysis.painPoints,
    eventTypes: analysis.eventTypes,
    recommendedApproach: analysis.recommendedApproach,
    analysisRaw: analysis,
    analysisError: null,
    analysisErrorAt: null,
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "ANALYZE_PROSPECT",
    entityType: "Prospect",
    entityId: prospectId,
    payload: { relevanceScore: analysis.relevanceScore, segment: analysis.segment, freshnessUsed, hunterError },
    status: "SUCCESS",
  });

  return Response.json({ success: true, analysis, hunterError, freshnessUsed });
});