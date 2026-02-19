import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY  = Deno.env.get("OPENAI_API_KEY");
const HUNTER_KEY  = Deno.env.get("HUNTER_API_KEY");
const BRAVE_KEY   = Deno.env.get("BRAVE_API_KEY");
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

// ── Decision Maker Discovery ───────────────────────────────────────────────────
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

      candidates.push({ fullName, title: role, linkedinUrl: cleanUrl, sourceUrl: cleanUrl, confidence: fullName ? 0.85 : 0.5 });
    }
  }

  const PRIORITY = /directeur|directrice|vp |vice.pr[eé]|chef|head of|responsable|manager|gestionnaire|chargé/i;
  const EVENT    = /marketing|communication|événement|event|expérience|brand|relations|public/i;
  candidates.sort((a, b) => {
    const score = (x) => (PRIORITY.test(x.title || "") ? 3 : 0) + (EVENT.test(x.title || "") ? 2 : 0) + (x.fullName ? 1 : 0);
    return score(b) - score(a);
  });
  return candidates.slice(0, 3);
}

// ── Analyse one prospect ───────────────────────────────────────────────────────
async function analyzeOneProspect(prospect, base44, freshnessEnabled) {
  let snippetToUse = prospect.serpSnippet || "";
  let freshnessUsed = false;
  if (prospect.sourceOrigin === "KB_TOPUP" && prospect.domain && freshnessEnabled) {
    const live = await kbFreshnessSnippet(prospect.domain);
    if (live) { snippetToUse = live; freshnessUsed = true; }
  }

  const analysis = await callOpenAI([
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
  "relevanceScore": number (0-100),
  "segment": "HOT|STANDARD",
  "relevanceReasons": ["raison 1", "raison 2", "raison 3"],
  "opportunities": [{"label": string, "detail": string}],
  "painPoints": [{"label": string, "detail": string}],
  "eventTypes": ["types d'événements probables"],
  "recommendedApproach": "angle d'approche SYNC en 1-2 phrases concrètes, axé réduction de risque / qualité AV / hybridation",
  "decisionMakerTitles": ["titres précis des décideurs à cibler"]
}`
    }
  ]);

  const decisionMakers = await findDecisionMakers(prospect.companyName, prospect.domain);

  let hunterContacts = [];
  try {
    const hr = await hunterDomainSearch(prospect.domain, prospect.companyName);
    if (hr?.data?.emails) {
      hunterContacts = hr.data.emails.filter(e => e.type === "personal" && e.confidence >= 50).slice(0, 3);
    }
  } catch (_) {}

  // Save Hunter contacts
  for (const hc of hunterContacts) {
    try {
      const existing = await base44.entities.Contact.filter({ prospectId: prospect.id, email: hc.value });
      const linkedinDM = decisionMakers.find(dm =>
        dm.fullName && hc.first_name && hc.last_name &&
        dm.fullName.toLowerCase().includes(hc.first_name.toLowerCase()) &&
        dm.fullName.toLowerCase().includes(hc.last_name.toLowerCase())
      );
      if (existing.length === 0) {
        await base44.entities.Contact.create({
          prospectId:      prospect.id,
          ownerUserId:     prospect.ownerUserId,
          firstName:       hc.first_name || "",
          lastName:        hc.last_name  || "",
          fullName:        `${hc.first_name || ""} ${hc.last_name || ""}`.trim(),
          title:           hc.position   || "",
          email:           hc.value,
          emailConfidence: hc.confidence,
          linkedinUrl:     hc.linkedin || linkedinDM?.linkedinUrl || "",
          hasEmail:        true,
          source:          "HUNTER",
        });
      }
    } catch (_) {}
  }

  // Save LinkedIn-only DMs
  const hunterNames = hunterContacts.map(h => `${h.first_name || ""} ${h.last_name || ""}`.trim().toLowerCase());
  for (const dm of decisionMakers) {
    try {
      if (!dm.linkedinUrl) continue;
      const matched = dm.fullName && hunterNames.some(n => n && dm.fullName && n.includes(dm.fullName.split(" ")[0]?.toLowerCase()));
      if (matched) continue;
      const existing = await base44.entities.Contact.filter({ prospectId: prospect.id, linkedinUrl: dm.linkedinUrl }).catch(() => []);
      if (existing.length === 0) {
        await base44.entities.Contact.create({
          prospectId:     prospect.id,
          ownerUserId:    prospect.ownerUserId,
          fullName:       dm.fullName  || "",
          title:          dm.title     || "",
          linkedinUrl:    dm.linkedinUrl,
          hasEmail:       false,
          source:         "SERP",
          contactPageUrl: dm.sourceUrl || "",
        });
      }
    } catch (_) {}
  }

  // Stub contacts from AI titles (last resort)
  if (hunterContacts.length === 0 && decisionMakers.length === 0 && analysis.decisionMakerTitles?.length > 0) {
    for (const title of analysis.decisionMakerTitles.slice(0, 2)) {
      try {
        const existing = await base44.entities.Contact.filter({ prospectId: prospect.id, title });
        if (existing.length === 0) {
          await base44.entities.Contact.create({
            prospectId:     prospect.id,
            ownerUserId:    prospect.ownerUserId,
            title,
            hasEmail:       false,
            contactPageUrl: `https://${prospect.domain}/contact`,
            source:         "SERP",
          });
        }
      } catch (_) {}
    }
  }

  await base44.entities.Prospect.update(prospect.id, {
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

  return { analysis, freshnessUsed, decisionMakersFound: decisionMakers.length };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { campaignId, prospectIds } = body;
  if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

  const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
  if (campaign.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const KB_FRESHNESS_MAX = 30;
  let freshnessChecksDone = 0;
  const startedAt = Date.now();
  const mode = prospectIds && prospectIds.length > 0 ? "selection" : "all";
  const skipStatuses = ["ANALYSÉ", "QUALIFIÉ", "REJETÉ", "EXPORTÉ"];

  const allProspects = await base44.entities.Prospect.filter({ campaignId }, "-created_date", 500);
  let prospects;
  if (mode === "selection") {
    prospects = allProspects.filter(p => prospectIds.includes(p.id) && !skipStatuses.includes(p.status));
  } else {
    prospects = allProspects.filter(p => p.status === "NOUVEAU" || p.status === "FAILED_ANALYSIS");
  }

  const total = prospects.length;

  await base44.entities.Campaign.update(campaignId, {
    analysisStatus:           "RUNNING",
    analysisLastHeartbeatAt:  new Date().toISOString(),
    analysisProgressPct:      0,
    analysisTargetCount:      total,
    analysisDoneCount:        0,
  });

  if (total === 0) {
    await base44.entities.Campaign.update(campaignId, { analysisStatus: "COMPLETED", analysisProgressPct: 100 });
    return Response.json({ success: true, analyzed: 0, failed: 0, total: 0, mode });
  }

  let analyzed = 0;
  let failed = 0;
  const BATCH = 2;

  for (let i = 0; i < prospects.length; i += BATCH) {
    const batch = prospects.slice(i, i + BATCH);

    const doneCount = analyzed + failed;
    const pct = Math.min(Math.round((doneCount / total) * 100), 99);
    await base44.entities.Campaign.update(campaignId, {
      analysisLastHeartbeatAt: new Date().toISOString(),
      analysisProgressPct:     pct,
      analysisDoneCount:       doneCount,
    });

    const settled = await Promise.allSettled(batch.map(async (prospect) => {
      try {
        const canUseFreshness = prospect.sourceOrigin === "KB_TOPUP" && freshnessChecksDone < KB_FRESHNESS_MAX;
        const result = await analyzeOneProspect(prospect, base44, canUseFreshness);
        if (result.freshnessUsed) freshnessChecksDone++;
        return { success: true };
      } catch (e) {
        const errMsg = (e.message || "Erreur inconnue").slice(0, 500);
        console.error(`Failed prospect ${prospect.id}:`, errMsg);
        try {
          await base44.entities.Prospect.update(prospect.id, {
            status:          "FAILED_ANALYSIS",
            analysisError:   errMsg,
            analysisErrorAt: new Date().toISOString(),
          });
        } catch (_) {}
        return { success: false };
      }
    }));

    analyzed += settled.filter(r => r.value?.success === true).length;
    failed   += settled.filter(r => r.value?.success === false).length;

    const newPct = Math.min(Math.round(((analyzed + failed) / total) * 100), 99);
    await base44.entities.Campaign.update(campaignId, {
      analysisLastHeartbeatAt: new Date().toISOString(),
      analysisProgressPct:     newPct,
      analysisDoneCount:       analyzed + failed,
    });
  }

  const finalProspects = await base44.entities.Prospect.filter({ campaignId }, "-created_date", 500);
  const countAnalyzed  = finalProspects.filter(p => ["ANALYSÉ","QUALIFIÉ","REJETÉ","EXPORTÉ"].includes(p.status)).length;
  const countQualified = finalProspects.filter(p => p.status === "QUALIFIÉ").length;
  const countRejected  = finalProspects.filter(p => p.status === "REJETÉ").length;
  const durationMs     = Date.now() - startedAt;
  const existingUsage  = campaign.toolUsage || {};

  await base44.entities.Campaign.update(campaignId, {
    analysisStatus:          "COMPLETED",
    analysisProgressPct:     100,
    analysisDoneCount:       analyzed + failed,
    countAnalyzed,
    countQualified,
    countRejected,
    analysisLastHeartbeatAt: new Date().toISOString(),
    toolUsage: {
      ...existingUsage,
      freshnessChecksDone,
      freshnessChecksMax:        KB_FRESHNESS_MAX,
      braveRateLimitRemaining:   braveRLState.remaining,
      brave429Count:             (existingUsage.brave429Count || 0) + braveRLState.count429,
    },
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType:  "ANALYZE_CAMPAIGN_PROSPECTS",
    entityType:  "Campaign",
    entityId:    campaignId,
    payload:     { analyzed, failed, total, durationMs, mode, freshnessChecksDone },
    status:      analyzed > 0 ? "SUCCESS" : "ERROR",
    errorMessage: failed > 0 ? `${failed}/${total} prospects ont échoué l'analyse` : null,
  });

  return Response.json({ success: true, analyzed, failed, total, mode, freshnessChecksDone });
});