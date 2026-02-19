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

// Domains that never yield valid org prospects
const BLOCKED_DOMAINS = new Set([
  "wikipedia.org", "fr.wikipedia.org", "en.wikipedia.org",
  "youtube.com", "youtu.be",
  "facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "tiktok.com", "pinterest.com", "reddit.com",
  "eventbrite.com", "eventbrite.ca", "meetup.com", "ticketmaster.com", "ticketmaster.ca",
  "glassdoor.com", "indeed.com", "monster.com",
  "lapresse.ca", "ledevoir.com", "journaldequebec.com", "lesaffaires.com",
  "radio-canada.ca", "cbc.ca", "tvanouvelles.ca", "24heures.ca",
  "cision.com", "newswire.ca", "prnewswire.com", "businesswire.com", "globenewswire.com",
  "google.com", "bing.com", "yahoo.com", "yelp.com", "tripadvisor.com",
  "wordpress.com", "wix.com", "squarespace.com", "medium.com", "substack.com",
]);

// URL paths that indicate content pages, not org homepages
const BLOCKED_URL_PATHS = /\/blog\/|\/news\/|\/press\/|\/article\/|\/articles\/|\/actualite\/|\/actualites\/|\/magazine\/|\/careers\/|\/carrieres\/|\/jobs\/|\/emplois\/|\/offres-emploi\/|\/salle-de-presse\/|\/communique\/|\/communiques\/|\/medias\/|\/presse\//i;

function normalizeResult(r) {
   const url = r.url || r.link;
   if (!url) return null;
   const domain = extractDomain(url);
   if (!domain) return null;

   // Block generic/media/social domains
   const baseDomain = domain.split(".").slice(-2).join(".");
   if (BLOCKED_DOMAINS.has(domain) || BLOCKED_DOMAINS.has(baseDomain)) return null;

   // Block article/press/jobs URL paths
   if (BLOCKED_URL_PATHS.test(url)) return null;

   const title = (r.title || "").toLowerCase();
   const snippet = (r.snippet || "").toLowerCase();
   const combined = title + " " + snippet;

   // Exclude agencies, directories, tech products
   const excludePatterns = /agence événementielle|event planner|organisateur professionnel|planificateur événement|bureau de congrès|répertoire fournisseurs|annuaire|directory|listing|database|crm\b|logiciel événement|software|saas|plateforme de gestion|template|thème wordpress|plugin/i;
   if (excludePatterns.test(combined)) return null;

   // Require event-related keywords
   const eventPatterns = /conférence|aga\b|assemblée générale|gala|événement corporatif|événement d'entreprise|corporate event|meeting annuel|summit|forum|symposium|colloque|webinaire|formation interne|townhall|town.?hall|réunion annuelle|congrès/i;
   if (!eventPatterns.test(combined)) return null;

   // Skip article-style headlines
   const articleTitlePatterns = /^(comment |pourquoi |quand |les \d+|top \d+|\d+ façons|guide |conseils |astuces |what is |how to |best |why |when )/i;
   if (articleTitlePatterns.test(r.title || "")) return null;

   // Use root domain URL when the path is deep (likely an article page)
   let websiteUrl = url;
   try {
     const parsed = new URL(url.startsWith("http") ? url : "https://" + url);
     if (parsed.pathname.split("/").filter(Boolean).length > 2) {
       websiteUrl = `https://${parsed.hostname}`;
     }
   } catch (_) {}

   const companyName = (r.title || "").slice(0, 100) || domain;

   return {
     normalized: {
       companyName,
       website: websiteUrl,
       domain,
       industry: null,
       location: { city: "", region: "", country: "CA" },
       entityType: "COMPANY",
       isValid: true,
     },
     domain,
   };
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

  // Load ALL KB entities for dedup (web phase skips KB domains to avoid overlap)
  let allKbEntities = [];
  let kbDomains = new Set();
  try {
    allKbEntities = await base44.entities.KBEntity.filter({}, "-created_date", 500);
    allKbEntities.forEach(e => { if (e.domain) kbDomains.add(e.domain.toLowerCase().replace(/^www\./, "")); });
  } catch (_) {}

  let allQueries = buildQueryVariants(campaign, loc);
  let queryIndex = 0;
  let skippedDupe = 0;
  let filteredNonOrgCount = 0;
  let braveRequestsUsed = 0;
  let createdWeb = 0; // track web vs KB separately
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

      for (const r of results) {
          if (created >= target) break;
          const normalized = normalizeResult(r);
          if (!normalized) { filteredNonOrgCount++; continue; }
            const { domain } = normalized;
            if (existingDomains.has(domain) || kbDomains.has(domain)) { skippedDupe++; continue; }

            const sourceResult = r;
            await base44.entities.Prospect.create({
              campaignId,
              ownerUserId: campaign.ownerUserId,
              companyName: normalized.normalized.companyName,
              website: normalized.normalized.website,
              domain,
              industry: normalized.normalized.industry,
              location: normalized.normalized.location,
              entityType: normalized.normalized.entityType,
              status: "NOUVEAU",
              serpSnippet: sourceResult?.snippet || "",
              sourceUrl: sourceResult?.url || sourceResult?.link || "",
            });

            existingDomains.add(domain);
            created++;
            createdWeb++;
            pageCreated++;
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

  // ─── Phase KB_TOPUP ───────────────────────────────────────────────────────
  let kbTopupAdded = 0;
  let kbTopupSkipped = 0;
  const webStopReason = created >= target ? "TARGET_REACHED"
    : budgetGuardTriggered ? "BUDGET_GUARD"
    : rateLimitHit ? "RATE_LIMIT"
    : queryIndex >= allQueries.length ? "QUERIES_EXHAUSTED"
    : "ERROR";

  if (ENABLE_KB_TOPUP && created < target && ["QUERIES_EXHAUSTED", "RATE_LIMIT", "BUDGET_GUARD"].includes(webStopReason)) {
    await base44.entities.Campaign.update(campaignId, { progressPct: 90, countProspects: created });

    // Build KB candidate set — filter loosely by campaign criteria
    const locLower = loc.toLowerCase();
    const sectors = (campaign.industrySectors || []).map(s => s.toLowerCase());

    const kbCandidates = allKbEntities.filter(e => {
      const domNorm = (e.domain || "").toLowerCase().replace(/^www\./, "");
      // Skip already created prospects
      if (existingDomains.has(domNorm)) return false;
      if (!e.domain || !e.website) return false;
      // Loose location match: if campaign has a location, prefer matching
      if (locLower && e.hqLocation) {
        const loc_ = e.hqLocation.toLowerCase();
        if (!loc_.includes("canada") && !loc_.includes("ca") && !loc_.includes(locLower.split(",")[0].trim())) return false;
      }
      return true;
    });

    for (const kb of kbCandidates) {
      if (created >= target) break;
      const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) { kbTopupSkipped++; continue; }

      const website = kb.website || `https://${kb.domain}`;
      await base44.entities.Prospect.create({
        campaignId,
        ownerUserId: campaign.ownerUserId,
        companyName: kb.name,
        website,
        domain: domNorm,
        industry: kb.entityType || null,
        location: kb.hqLocation ? { city: kb.hqLocation, country: "CA" } : { country: "CA" },
        entityType: kb.entityType || "COMPANY",
        status: "NOUVEAU",
        sourceOrigin: "KB_TOPUP",
        kbEntityId: kb.id,
        serpSnippet: kb.notes || "",
        sourceUrl: kb.source || "",
      });

      existingDomains.add(domNorm);
      created++;
      kbTopupAdded++;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Determine stop reason
  let stopReason;
  if (created >= target) {
    stopReason = "TARGET_REACHED";
  } else if (ENABLE_KB_TOPUP && kbTopupAdded > 0 && created < target) {
    stopReason = "KB_EXHAUSTED";
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
      filteredNonOrgCount,
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