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

// ── Brave rate-limit state (shared across calls in the same function invocation) ──
const braveRLState = {
  limit: -1,
  remaining: -1,
  reset: -1,
  count429: 0,
};

function parseBraveHeaders(res) {
  const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1", 10);
  const reset     = parseInt(res.headers.get("X-RateLimit-Reset")     || "-1", 10);
  const limit     = parseInt(res.headers.get("X-RateLimit-Limit")     || "-1", 10);
  if (remaining !== -1) braveRLState.remaining = remaining;
  if (reset     !== -1) braveRLState.reset     = reset;
  if (limit     !== -1) braveRLState.limit     = limit;
}

async function waitForBraveReset(minWaitMs = 1000) {
  const waitMs = braveRLState.reset > 0
    ? Math.max(braveRLState.reset * 1000, minWaitMs)
    : minWaitMs;
  await new Promise(r => setTimeout(r, waitMs));
}

// Brave search with rate-limit retry + backoff + header tracking
async function braveSearch(query, count = 10, offset = 0, retries = 3) {
  // If we know remaining=0, wait for reset before even trying
  if (braveRLState.remaining === 0 && braveRLState.reset > 0) {
    await waitForBraveReset();
  }

  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca&search_lang=fr`;

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
    parseBraveHeaders(res);

    if (res.status === 429) {
      braveRLState.count429++;
      if (attempt < retries - 1) {
        await waitForBraveReset(Math.pow(2, attempt) * 1000);
        continue;
      }
      return { results: [], rateLimited: true };
    }

    // Proactively pause if remaining just dropped to 0
    if (braveRLState.remaining === 0) {
      await waitForBraveReset();
    }

    const data = await res.json();
    return { results: data.web?.results || [], rateLimited: false };
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

const BLOCKED_URL_PATHS = /\/blog\/|\/news\/|\/press\/|\/article\/|\/articles\/|\/actualite\/|\/actualites\/|\/magazine\/|\/careers\/|\/carrieres\/|\/jobs\/|\/emplois\/|\/offres-emploi\/|\/salle-de-presse\/|\/communique\/|\/communiques\/|\/medias\/|\/presse\//i;

function normalizeResult(r) {
  const url = r.url || r.link;
  if (!url) return null;
  const domain = extractDomain(url);
  if (!domain) return null;

  const baseDomain = domain.split(".").slice(-2).join(".");
  if (BLOCKED_DOMAINS.has(domain) || BLOCKED_DOMAINS.has(baseDomain)) return null;
  if (BLOCKED_URL_PATHS.test(url)) return null;

  const title = (r.title || "").toLowerCase();
  const snippet = (r.snippet || "").toLowerCase();
  const combined = title + " " + snippet;

  const excludePatterns = /agence événementielle|event planner|organisateur professionnel|planificateur événement|bureau de congrès|répertoire fournisseurs|annuaire|directory|listing|database|crm\b|logiciel événement|software|saas|plateforme de gestion|template|thème wordpress|plugin/i;
  if (excludePatterns.test(combined)) return null;

  const eventPatterns = /conférence|aga\b|assemblée générale|gala|événement corporatif|événement d'entreprise|corporate event|meeting annuel|summit|forum|symposium|colloque|webinaire|formation interne|townhall|town.?hall|réunion annuelle|congrès/i;
  if (!eventPatterns.test(combined)) return null;

  const articleTitlePatterns = /^(comment |pourquoi |quand |les \d+|top \d+|\d+ façons|guide |conseils |astuces |what is |how to |best |why |when )/i;
  if (articleTitlePatterns.test(r.title || "")) return null;

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

  // Fetch AppSettings
  let appSettings = {};
  try {
    const settings = await base44.entities.AppSettings.filter({ settingsId: "global" });
    if (settings.length > 0) appSettings = settings[0];
  } catch (_) {}

  const BRAVE_MAX_REQUESTS  = appSettings.braveMaxRequestsPerCampaign || 250;
  const BRAVE_MAX_PAGES     = appSettings.braveMaxPagesPerQuery || 5;
  const BRAVE_MIN_REMAINING = appSettings.braveMinRemainingBeforePause || 2;
  const ENABLE_KB_TOPUP     = appSettings.enableKbTopUp !== false;

  // Collect existing domains for dedup
  const existing = await base44.entities.Prospect.filter({ campaignId });
  const existingDomains = new Set(existing.map(p => p.domain).filter(Boolean));
  let created = existing.length;

  // Load KB entities for dedup
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
  let createdWeb = 0;
  let totalQueriesRun = 0;
  let rateLimitHit = false;
  let budgetGuardTriggered = false;
  const queryLog = [];

  const runQuery = async (query, maxPagesOverride) => {
    if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) {
      budgetGuardTriggered = true;
      return;
    }

    const remaining = target - created;
    const maxPages = maxPagesOverride ?? Math.min(BRAVE_MAX_PAGES, remaining > 50 ? 7 : 5);

    for (let page = 0; page < maxPages && created < target && !budgetGuardTriggered; page++) {
      let results = [];
      try {
        const braveResult = await braveSearch(query, 10, page * 10);
        braveRequestsUsed++;

        // Pause threshold check
        if (braveRLState.remaining >= 0 && braveRLState.remaining <= BRAVE_MIN_REMAINING) {
          await waitForBraveReset(1000);
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
          sourceOrigin: "WEB",
          serpSnippet: r?.snippet || "",
          sourceUrl: r?.url || r?.link || "",
        });

        existingDomains.add(domain);
        created++;
        createdWeb++;
        pageCreated++;
      }
      queryLog.push({ query: query.slice(0, 80), page, resultsRaw: results.length, added: pageCreated });
    }
  };

  // Phase 1: main queries
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

  // Phase 3: broad fallbacks
  if (created < target && (target - created) >= 10 && !rateLimitHit && !budgetGuardTriggered) {
    const broadFallbacks = buildBroadFallbacks(campaign, loc);
    await base44.entities.Campaign.update(campaignId, { progressPct: 85 });
    for (const q of broadFallbacks) {
      if (created >= target || budgetGuardTriggered) break;
      await runQuery(q, 2);
    }
  }

  // ── Phase KB_TOPUP ──────────────────────────────────────────────────────────
  let kbTopupAdded = 0;
  let kbTopupSkippedDuplicate = 0;
  let kbTopupCandidates = 0;
  let kbTopupStoppedReason = null;

  const webStopReason = created >= target     ? "TARGET_REACHED"
    : budgetGuardTriggered                    ? "BUDGET_GUARD"
    : rateLimitHit                            ? "RATE_LIMIT"
    : queryIndex >= allQueries.length         ? "QUERIES_EXHAUSTED"
    : "ERROR";

  if (ENABLE_KB_TOPUP && created < target && ["QUERIES_EXHAUSTED", "RATE_LIMIT", "BUDGET_GUARD"].includes(webStopReason)) {
    await base44.entities.Campaign.update(campaignId, { progressPct: 90, countProspects: created });

    const locLower = loc.toLowerCase();

    const candidates = allKbEntities.filter(e => {
      const domNorm = (e.domain || "").toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) return false;
      if (!e.domain || !e.website) return false;
      if (locLower && e.hqLocation) {
        const loc_ = e.hqLocation.toLowerCase();
        if (!loc_.includes("canada") && !loc_.includes("ca") && !loc_.includes(locLower.split(",")[0].trim())) return false;
      }
      return true;
    });
    kbTopupCandidates = candidates.length;

    for (const kb of candidates) {
      if (created >= target) { kbTopupStoppedReason = "TARGET_REACHED"; break; }
      const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) { kbTopupSkippedDuplicate++; continue; }

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

    if (!kbTopupStoppedReason) {
      kbTopupStoppedReason = created >= target ? "TARGET_REACHED" : "KB_EXHAUSTED";
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Determine final stop reason
  let stopReason;
  if (created >= target) {
    stopReason = "TARGET_REACHED";
  } else if (kbTopupAdded > 0 && kbTopupStoppedReason === "KB_EXHAUSTED") {
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

  let finalStatus;
  let errorMsg;
  if (created === 0) {
    finalStatus = "FAILED";
    errorMsg = stopReason === "RATE_LIMIT"
      ? "Limite de l'API Brave atteinte. Réessayez dans quelques minutes."
      : stopReason === "BUDGET_GUARD"
      ? `Limite de requêtes Brave atteinte (${BRAVE_MAX_REQUESTS} req max).`
      : "Aucun prospect valide trouvé — vérifiez les clés API Brave/SerpAPI";
  } else if (created < target) {
    finalStatus = "DONE_PARTIAL";
    const kbNote = kbTopupAdded > 0 ? ` + ${kbTopupAdded} via KB` : "";
    if (stopReason === "KB_EXHAUSTED") {
      errorMsg = `Web + KB épuisés: ${created}/${target} prospects (${createdWeb} web${kbNote}). KB entièrement parcourue.`;
    } else if (stopReason === "BUDGET_GUARD") {
      errorMsg = `Limite Brave: ${createdWeb} web${kbNote} / ${target}. (${braveRequestsUsed}/${BRAVE_MAX_REQUESTS} req)`;
    } else if (stopReason === "RATE_LIMIT") {
      errorMsg = `Limite API: ${createdWeb} web${kbNote} / ${target}. Relancez dans quelques minutes.`;
    } else {
      errorMsg = `Terminé: ${createdWeb} web${kbNote} / ${target} prospects.${skippedDupe > 0 ? ` ${skippedDupe} doublons ignorés.` : ""}`;
    }
  } else {
    finalStatus = "COMPLETED";
  }

  const toolUsage = {
    queries: totalQueriesRun,
    skippedDuplicates: skippedDupe,
    filteredNonOrgCount,
    braveRequestsUsed,
    braveMaxRequests: BRAVE_MAX_REQUESTS,
    braveRateLimitLimit: braveRLState.limit,
    braveRateLimitRemaining: braveRLState.remaining,
    braveRateLimitReset: braveRLState.reset,
    brave429Count: braveRLState.count429,
    stopReason,
    webStopReason,
    createdWeb,
    kbTopupAdded,
    kbTopupCandidates,
    kbTopupSkippedDuplicate,
    kbTopupStoppedReason,
    lastQueryIndex: queryIndex,
    allQueriesCount: allQueries.length,
    queryLog: queryLog.slice(0, 30),
  };

  await base44.entities.Campaign.update(campaignId, {
    status: finalStatus,
    progressPct: 100,
    countProspects: created,
    errorMessage: errorMsg,
    toolUsage,
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "RUN_PROSPECT_SEARCH",
    entityType: "Campaign",
    entityId: campaignId,
    payload: {
      created,
      createdWeb,
      kbTopupAdded,
      kbTopupCandidates,
      target,
      coverage: `${Math.round(created / target * 100)}%`,
      skippedDuplicates: skippedDupe,
      queriesRun: totalQueriesRun,
      braveRequestsUsed,
      braveMaxRequests: BRAVE_MAX_REQUESTS,
      brave429Count: braveRLState.count429,
      stopReason,
      webStopReason,
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