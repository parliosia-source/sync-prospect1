import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

async function callOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Tu es un assistant de prospection B2B pour SYNC Productions (Montréal). Tu réponds UNIQUEMENT en JSON strict, sans texte autour. Tu n'inventes pas de faits. Si une info n'est pas disponible, tu mets null." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
    })
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// Brave search with rate-limit retry + backoff + header tracking
async function braveSearch(query, count = 10, offset = 0, retries = 3) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca&search_lang=fr`;
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
    
    // Capture rate limit headers
    const rateLimitRemaining = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1", 10);
    const rateLimitReset = parseInt(res.headers.get("X-RateLimit-Reset") || "-1", 10);
    const rateLimitLimit = parseInt(res.headers.get("X-RateLimit-Limit") || "-1", 10);
    
    if (res.status === 429) {
      const waitMs = rateLimitReset > 0 ? rateLimitReset * 1000 : Math.pow(2, attempt) * 1000;
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      return { results: [], rateLimited: true, rateLimitRemaining, rateLimitReset, rateLimitLimit };
    }
    const data = await res.json();
    return { results: data.web?.results || [], rateLimited: false, rateLimitRemaining, rateLimitReset, rateLimitLimit };
  }
  return { results: [], rateLimited: true };
}

async function serpSearch(query, start = 0) {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&location=Canada&hl=fr&gl=ca&num=10&start=${start}&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.organic_results || [];
}

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname.replace("www.", "");
  } catch { return null; }
}

function buildQueryVariants(campaign, loc) {
  const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
  const kws = campaign.keywords?.slice(0, 3).join(" ") || "";
  const exclude = '-"agence événementielle" -"event planner" -"planificateur d\'événements" -"organisation d\'événements"';

  const queries = [
    `"conférence annuelle" organisateur ${sector} ${loc} ${exclude}`.trim(),
    `"AGA" OR "assemblée générale annuelle" entreprise ${sector} ${loc} ${exclude}`.trim(),
    `"congrès annuel" association ${sector} ${loc} ${exclude}`.trim(),
    `"gala" OR "cérémonie" entreprise ${sector} ${loc} ${exclude}`.trim(),
    `"formation interne" OR "townhall" organisation ${sector} ${loc} ${exclude}`.trim(),
    `"colloque" OR "symposium" ${sector} ${loc} ${exclude}`.trim(),
    `"journée d'entreprise" OR "journée employés" ${loc} ${sector} ${exclude}`.trim(),
    `"webinaire" OR "webdiffusion" ${sector} ${loc} entreprise ${exclude}`.trim(),
    `association professionnelle congrès ${loc} ${sector}`.trim(),
    `ordre professionnel assemblée annuelle ${loc} ${sector}`.trim(),
    `chambre de commerce événement corporatif ${loc} membres`.trim(),
    `grande entreprise événement annuel employés ${loc} ${sector}`.trim(),
    ...(kws ? [
      `"${kws}" événement corporatif ${loc} ${sector} ${exclude}`.trim(),
      `${kws} conférence réunion annuelle ${loc} ${exclude}`.trim(),
    ] : []),
    `entreprise ${loc} événements corporatifs annuels ${sector}`.trim(),
    `organisations ${loc} congrès gala AGA ${sector}`.trim(),
    `site:.ca entreprise événement corporatif ${loc} ${sector}`.trim(),
    `filetype:pdf programme conférence annuelle ${loc} ${sector}`.trim(),
  ];

  return queries.filter(q => q.length > 10);
}

// Phase 3: broader fallbacks without exclude filter
function buildBroadFallbacks(campaign, loc) {
  const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
  return [
    `organisation ${loc} événement annuel réunion ${sector}`.trim(),
    `entreprise ${loc} ${sector} conférence annuelle`.trim(),
    `association ${loc} ${sector} membres assemblée`.trim(),
    `chambres de commerce ${loc} membres annuaire entreprises`.trim(),
    `"${loc}" organisateur événement corporatif B2B`.trim(),
    `grande entreprise ${loc} ${sector} site web`.trim(),
    `syndicat association ${loc} ${sector} annuel`.trim(),
  ];
}

async function normalizeResult(r) {
  const url = r.url || r.link;
  if (!url) return null;
  const domain = extractDomain(url);
  if (!domain) return null;
  const normalized = await callOpenAI(
    `Voici un résultat de recherche web. Extrais les infos de l'entreprise si c'est une entreprise/organisation qui ORGANISE ses propres événements corporatifs (pas une agence event planner).

URL: ${url}
Titre: ${r.title || ""}
Snippet: ${r.snippet || ""} ${(r.extra_snippets || []).slice(0, 2).join(" ")}

Réponds en JSON: { "companyName": string|null, "website": string|null, "domain": string|null, "industry": string|null, "location": {"city":string,"region":string,"country":string}, "entityType": "COMPANY|ASSOCIATION|PROFESSIONAL_ORG|GOV|OTHER", "isValid": boolean, "reason": string }

isValid = true seulement si: 1) c'est clairement une entreprise/org qui organise ses propres événements, 2) companyName ET website sont présents, 3) ce n'est PAS une agence event planner, organisateur professionnel, ou répertoire de fournisseurs.`
  );
  return { normalized, domain };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { campaignId } = await req.json();
  if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

  const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
  if (campaign.ownerUserId !== user.email && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  await base44.entities.Campaign.update(campaignId, { status: "RUNNING", progressPct: 5, lastRunAt: new Date().toISOString() });

  const loc = campaign.locationQuery || "Montréal";
  const target = campaign.targetCount || 50;

  // Fetch AppSettings for budget controls
  let appSettings = {};
  try {
    const settings = await base44.entities.AppSettings.filter({ settingsId: "global" });
    if (settings.length > 0) appSettings = settings[0];
  } catch (_) {}
  
  const BRAVE_MAX_REQUESTS = appSettings.braveMaxRequestsPerCampaign || 250;
  const BRAVE_MAX_PAGES = appSettings.braveMaxPagesPerQuery || 5;
  const BRAVE_MIN_REMAINING = appSettings.braveMinRemainingBeforePause || 2;
  const ENABLE_KB_TOPUP = appSettings.enableKbTopUp !== false;

  // Collect existing domains for dedup
  const existing = await base44.entities.Prospect.filter({ campaignId });
  const existingDomains = new Set(existing.map(p => p.domain).filter(Boolean));
  let created = existing.length;

  // Also dedup against KB
  let kbDomains = new Set();
  try {
    const kbEntities = await base44.entities.KBEntity.filter({}, "-created_date", 200);
    kbEntities.forEach(e => { if (e.domain) kbDomains.add(e.domain); });
  } catch (_) {}

  let allQueries = buildQueryVariants(campaign, loc);
  let queryIndex = 0;
  let skippedDupe = 0;
  let braveRequestsUsed = 0;
  let totalQueriesRun = 0;
  let rateLimitHit = false;
  let budgetGuardTriggered = false;
  let lastRateLimitRemaining = -1;
  let lastRateLimitReset = -1;
  const queryLog = [];

  const runQuery = async (query, maxPagesOverride) => {
    // Budget guard: stop if Brave requests exhausted
    if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) {
      budgetGuardTriggered = true;
      return;
    }

    // Dynamic maxPages: go deeper when far from target
    const remaining = target - created;
    const maxPages = maxPagesOverride ?? Math.min(BRAVE_MAX_PAGES, remaining > 50 ? 7 : 5);

    for (let page = 0; page < maxPages && created < target && !budgetGuardTriggered; page++) {
      let results = [];
      try {
        const braveResult = await braveSearch(query, 10, page * 10);
        braveRequestsUsed++;
        
        // Capture rate limit headers
        if (braveResult.rateLimitRemaining !== undefined) lastRateLimitRemaining = braveResult.rateLimitRemaining;
        if (braveResult.rateLimitReset !== undefined) lastRateLimitReset = braveResult.rateLimitReset;
        
        // Check if we should pause due to low remaining
        if (lastRateLimitRemaining >= 0 && lastRateLimitRemaining <= BRAVE_MIN_REMAINING) {
          rateLimitHit = true;
          break;
        }
        
        if (braveResult.rateLimited) {
          rateLimitHit = true;
          break;
        }
        results = braveResult.results;
      } catch (_) {}
      
      if (results.length === 0 && SERPAPI_KEY) {
        try { results = await serpSearch(query, page * 10); } catch (_) {}
      }
      if (results.length === 0) break;

      totalQueriesRun++;
      let pageCreated = 0;

      const batches = [];
      for (let i = 0; i < results.length; i += 5) batches.push(results.slice(i, i + 5));

      for (const batch of batches) {
        if (created >= target) break;
        const normalizations = await Promise.allSettled(batch.map(r => normalizeResult(r).catch(() => null)));
        for (let i = 0; i < normalizations.length; i++) {
            if (created >= target) break;
            const result = normalizations[i];
            if (result.status !== "fulfilled" || !result.value) continue;
            const { normalized, domain } = result.value;
            if (!normalized?.isValid || !normalized?.companyName || !normalized?.website) continue;
            const cleanDomain = extractDomain(normalized.website) || domain;
            if (!cleanDomain) continue;
            if (existingDomains.has(cleanDomain) || kbDomains.has(cleanDomain)) { skippedDupe++; continue; }

            const sourceResult = batch[i];
            await base44.entities.Prospect.create({
              campaignId,
              ownerUserId: campaign.ownerUserId,
              companyName: normalized.companyName,
              website: normalized.website,
              domain: cleanDomain,
              industry: normalized.industry,
              location: normalized.location,
              entityType: normalized.entityType,
              status: "NOUVEAU",
              serpSnippet: sourceResult?.snippet || "",
              sourceUrl: sourceResult?.url || sourceResult?.link || "",
            });

          existingDomains.add(cleanDomain);
          created++;
          pageCreated++;
        }
      }
      queryLog.push({ query: query.slice(0, 80), page, resultsRaw: results.length, added: pageCreated });
    }
  };

  // Phase 1: run all queries
  while (created < target && queryIndex < allQueries.length && !rateLimitHit && !budgetGuardTriggered) {
    const pct = 10 + Math.round((queryIndex / allQueries.length) * 55);
    await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created });
    await runQuery(allQueries[queryIndex]);
    queryIndex++;
  }

  // Phase 2: broadened fallbacks if < 60% of target
  if (created < target * 0.6 && !rateLimitHit && !budgetGuardTriggered) {
    const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
    const fallbacks = [
      `organisation ${loc} événement annuel réunion`,
      `entreprise ${loc} ${sector} conférence`,
      `association ${loc} ${sector} membres assemblée`,
      `"${loc}" événements corporatifs B2B prestataires`,
      `chambres de commerce ${loc} membres annuaire`,
    ];
    await base44.entities.Campaign.update(campaignId, { progressPct: 70 });
    for (const q of fallbacks) {
      if (created >= target || budgetGuardTriggered) break;
      await runQuery(q, 2);
    }
  }

  // Phase 3: broad fallbacks without exclude filter, if still short and no rate limit/budget guard
  if (created < target && (target - created) >= 10 && !rateLimitHit && !budgetGuardTriggered) {
    const broadFallbacks = buildBroadFallbacks(campaign, loc);
    await base44.entities.Campaign.update(campaignId, { progressPct: 85 });
    for (const q of broadFallbacks) {
      if (created >= target || budgetGuardTriggered) break;
      await runQuery(q, 2);
    }
  }

  // Determine stop reason
  let stopReason;
  if (created >= target) {
    stopReason = "TARGET_REACHED";
  } else if (budgetGuardTriggered) {
    stopReason = "BUDGET_GUARD";
  } else if (rateLimitHit) {
    stopReason = "RATE_LIMIT";
  } else if (queryIndex >= allQueries.length) {
    stopReason = "QUERIES_EXHAUSTED";
  } else {
    stopReason = "ERROR";
  }

  // Determine final status
  let finalStatus;
  let errorMsg;
  if (created === 0) {
    finalStatus = "FAILED";
    errorMsg = stopReason === "RATE_LIMIT"
      ? "Limite de l'API Brave atteinte. Réessayez dans quelques minutes."
      : stopReason === "BUDGET_GUARD"
      ? `Limite de requêtes Brave atteinte (${BRAVE_MAX_REQUESTS} req max). Relancez pour continuer la KB_TOPUP.`
      : "Aucun prospect valide trouvé — vérifiez les clés API Brave/SerpAPI";
  } else if (created < target) {
    finalStatus = "DONE_PARTIAL";
    if (stopReason === "BUDGET_GUARD") {
      errorMsg = `Limite de requêtes Brave atteinte: ${created}/${target} prospects trouvés. ${ENABLE_KB_TOPUP ? "KB_TOPUP en attente..." : "Augmentez la limite pour continuer."} (Requêtes: ${braveRequestsUsed}/${BRAVE_MAX_REQUESTS})`;
    } else if (stopReason === "RATE_LIMIT") {
      errorMsg = `Recherche interrompue par limite API: ${created}/${target} prospects trouvés. Relancez dans quelques minutes. (Requêtes: ${braveRequestsUsed})`;
    } else {
      errorMsg = `Recherche terminée: ${created}/${target} prospects uniques trouvés (requêtes épuisées ou déduplication). ${skippedDupe > 0 ? `${skippedDupe} doublons ignorés.` : ""} (Requêtes: ${braveRequestsUsed})`.trim();
    }
  } else {
    finalStatus = "COMPLETED";
  }

  await base44.entities.Campaign.update(campaignId, {
    status: finalStatus,
    progressPct: 100,
    countProspects: created,
    errorMessage: errorMsg,
    toolUsage: {
      queries: totalQueriesRun,
      openai: created,
      skippedDuplicates: skippedDupe,
      braveRequestsUsed,
      braveMaxRequests: BRAVE_MAX_REQUESTS,
      stopReason,
      lastQueryIndex: queryIndex,
      allQueriesCount: allQueries.length,
      maxPagesUsed: Math.min(BRAVE_MAX_PAGES, target - created > 50 ? 7 : 5),
      lastRateLimitRemaining,
      lastRateLimitReset,
      queryLog: queryLog.slice(0, 30),
    },
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "RUN_PROSPECT_SEARCH",
    entityType: "Campaign",
    entityId: campaignId,
    payload: {
      created,
      target,
      coverage: `${Math.round(created / target * 100)}%`,
      skippedDuplicates: skippedDupe,
      queriesRun: totalQueriesRun,
      braveRequestsUsed,
      braveMaxRequests: BRAVE_MAX_REQUESTS,
      stopReason,
      lastRateLimitRemaining,
    },
    status: created > 0 ? "SUCCESS" : "ERROR",
    errorMessage: errorMsg,
  });

  return Response.json({
    success: created > 0,
    created,
    target,
    coverage: Math.round(created / target * 100),
    skippedDuplicates: skippedDupe,
    stopReason,
  });
});