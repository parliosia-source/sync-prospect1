import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const HUNTER_KEY = Deno.env.get("HUNTER_API_KEY");
const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

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

async function braveSearch(query, count = 5) {
  if (!BRAVE_KEY) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
  const data = await res.json();
  return data?.web?.results || [];
}

async function serpSearch(query, count = 5) {
  if (!SERPAPI_KEY) return [];
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=${count}&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data?.organic_results || [];
}

async function findLinkedInUrl(firstName, lastName, company) {
  if (!firstName || !lastName) return null;
  const query = `site:linkedin.com/in "${firstName} ${lastName}" "${company}"`;
  let results = await braveSearch(query, 5);
  if (results.length === 0) results = await serpSearch(query, 5);
  if (results.length === 0) return null;

  const candidates = results
    .filter(r => (r.url || r.link || "").includes("linkedin.com/in/"))
    .slice(0, 3)
    .map(r => ({ url: r.url || r.link, title: r.title || "", snippet: r.description || r.snippet || "" }));

  if (candidates.length === 0) return null;

  try {
    const pick = await callOpenAI([
      { role: "system", content: "Tu sélectionnes le profil LinkedIn le plus probable pour une personne. Réponds en JSON strict." },
      {
        role: "user",
        content: `Personne recherchée: ${firstName} ${lastName}, travaille chez ${company}.
Candidats:
${candidates.map((c, i) => `${i}: url=${c.url} title="${c.title}" snippet="${c.snippet}"`).join("\n")}

Réponds: {"index": number_or_-1, "confidence": 0.0_to_1.0}`
      }
    ]);
    if (pick.confidence >= 0.6 && pick.index >= 0 && candidates[pick.index]) {
      return candidates[pick.index].url;
    }
  } catch (_) {}
  return null;
}

async function analyzeProspect(prospect, base44) {
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
Snippet: ${prospect.serpSnippet || ""}

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

  // 2. Hunter contacts (isolated — never crashes the prospect)
  let hunterContacts = [];
  try {
    const hr = await hunterDomainSearch(prospect.domain, prospect.companyName);
    if (hr?.data?.emails) {
      hunterContacts = hr.data.emails.filter(e => e.type === "personal" && e.confidence >= 50).slice(0, 3);
    }
  } catch (_) {}

  // 3. Create contacts + enrich LinkedIn
  for (const hc of hunterContacts) {
    try {
      const existing = await base44.entities.Contact.filter({ prospectId: prospect.id, email: hc.value });
      let contactId = existing[0]?.id;
      const linkedinUrl = hc.linkedin || await findLinkedInUrl(hc.first_name, hc.last_name, prospect.companyName);

      if (!contactId) {
        await base44.entities.Contact.create({
          prospectId: prospect.id,
          ownerUserId: prospect.ownerUserId,
          firstName: hc.first_name || "",
          lastName: hc.last_name || "",
          fullName: `${hc.first_name || ""} ${hc.last_name || ""}`.trim(),
          title: hc.position || "",
          email: hc.value,
          emailConfidence: hc.confidence,
          linkedinUrl: linkedinUrl || "",
          hasEmail: true,
          source: "HUNTER",
        });
      } else if (linkedinUrl && !existing[0]?.linkedinUrl) {
        await base44.entities.Contact.update(contactId, { linkedinUrl });
      }
    } catch (_) {}
  }

  // 4. Stub contacts from AI titles when Hunter finds nothing
  if (hunterContacts.length === 0 && analysis.decisionMakerTitles?.length > 0) {
    const contactPageUrl = `https://www.${prospect.domain}/contact`;
    for (const title of analysis.decisionMakerTitles.slice(0, 2)) {
      try {
        const existing = await base44.entities.Contact.filter({ prospectId: prospect.id, title });
        if (existing.length === 0) {
          await base44.entities.Contact.create({
            prospectId: prospect.id,
            ownerUserId: prospect.ownerUserId,
            title,
            hasEmail: false,
            contactPageUrl,
            source: "SERP",
          });
        }
      } catch (_) {}
    }
  }

  // 5. Update prospect with analysis results
  await base44.entities.Prospect.update(prospect.id, {
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

  return analysis;
}

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

  const startedAt = Date.now();
  const mode = prospectIds && prospectIds.length > 0 ? "selection" : "all";
  const skipStatuses = ["ANALYSÉ", "QUALIFIÉ", "REJETÉ", "EXPORTÉ"];

  // Immediately mark as RUNNING
  await base44.entities.Campaign.update(campaignId, {
    analysisStatus: "RUNNING",
    analysisLastHeartbeatAt: new Date().toISOString(),
    analysisProgressPct: 0,
  });

  // Fetch and filter prospects to analyze
  const allProspects = await base44.entities.Prospect.filter({ campaignId }, "-created_date", 500);
  let prospects;
  if (mode === "selection") {
    // Only the explicitly requested IDs, skip already-done ones
    prospects = allProspects.filter(p => prospectIds.includes(p.id) && !skipStatuses.includes(p.status));
  } else {
    // All pending: NOUVEAU + previously failed
    prospects = allProspects.filter(p => p.status === "NOUVEAU" || p.status === "FAILED_ANALYSIS");
  }

  const total = prospects.length;

  if (total === 0) {
    await base44.entities.Campaign.update(campaignId, { analysisStatus: "COMPLETED", analysisProgressPct: 100 });
    return Response.json({ success: true, analyzed: 0, failed: 0, total: 0, mode });
  }

  let analyzed = 0;
  let failed = 0;
  const BATCH = 5;

  for (let i = 0; i < prospects.length; i += BATCH) {
    const batch = prospects.slice(i, i + BATCH);

    // Process batch in parallel — each promise RETURNS a result, no shared mutable state
    const settled = await Promise.allSettled(batch.map(async (prospect) => {
      try {
        await analyzeProspect(prospect, base44);
        return { success: true };
      } catch (e) {
        const errMsg = (e.message || "Erreur inconnue").slice(0, 500);
        console.error(`Failed prospect ${prospect.id}:`, errMsg);
        try {
          await base44.entities.Prospect.update(prospect.id, {
            status: "FAILED_ANALYSIS",
            analysisError: errMsg,
            analysisErrorAt: new Date().toISOString(),
          });
        } catch (_) {}
        return { success: false };
      }
    }));

    // Count from settled results — no race condition
    const batchAnalyzed = settled.filter(r => r.value?.success === true).length;
    const batchFailed = settled.filter(r => r.value?.success === false).length;
    analyzed += batchAnalyzed;
    failed += batchFailed;

    // Heartbeat after each batch (never write 100 until done)
    const pct = Math.min(Math.round(((i + batch.length) / total) * 100), 99);
    await base44.entities.Campaign.update(campaignId, {
      analysisLastHeartbeatAt: new Date().toISOString(),
      analysisProgressPct: pct,
    });
  }

  // Recalculate counts from DB (source of truth)
  const finalProspects = await base44.entities.Prospect.filter({ campaignId }, "-created_date", 500);
  const countAnalyzed = finalProspects.filter(p => ["ANALYSÉ", "QUALIFIÉ", "REJETÉ", "EXPORTÉ"].includes(p.status)).length;
  const countQualified = finalProspects.filter(p => p.status === "QUALIFIÉ").length;
  const countRejected = finalProspects.filter(p => p.status === "REJETÉ").length;
  const durationMs = Date.now() - startedAt;

  await base44.entities.Campaign.update(campaignId, {
    analysisStatus: "COMPLETED",
    analysisProgressPct: 100,
    countAnalyzed,
    countQualified,
    countRejected,
    analysisLastHeartbeatAt: new Date().toISOString(),
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "ANALYZE_CAMPAIGN_PROSPECTS",
    entityType: "Campaign",
    entityId: campaignId,
    payload: { analyzed, failed, total, durationMs, mode },
    status: analyzed > 0 ? "SUCCESS" : "ERROR",
    errorMessage: failed > 0 ? `${failed}/${total} prospects ont échoué l'analyse` : null,
  });

  return Response.json({ success: true, analyzed, failed, total, mode });
});