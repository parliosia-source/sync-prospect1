import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY   = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

// ── Brave rate-limit state ─────────────────────────────────────────────────────
const braveRLState = { limit: -1, remaining: -1, reset: -1, count429: 0 };

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

async function braveSearch(query, count = 10, offset = 0, retries = 3) {
  if (braveRLState.remaining === 0 && braveRLState.reset > 0) await waitForBraveReset();
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca&search_lang=fr`;
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, { headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY } });
    parseBraveHeaders(res);
    if (res.status === 429) {
      braveRLState.count429++;
      if (attempt < retries - 1) { await waitForBraveReset(Math.pow(2, attempt) * 1000); continue; }
      return { results: [], rateLimited: true };
    }
    if (braveRLState.remaining === 0) await waitForBraveReset();
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

// ── Domain helpers ─────────────────────────────────────────────────────────────
const TWO_PART_TLDS = new Set(["qc.ca","co.ca","on.ca","bc.ca","ab.ca","mb.ca","nb.ca","ns.ca","nl.ca","pe.ca","sk.ca","co.uk","org.uk","me.uk"]);

function getRegistrableDomain(hostname) {
  const host = hostname.replace(/^www\./, "");
  const labels = host.split(".");
  if (labels.length >= 3) {
    const twoPartTld = labels.slice(-2).join(".");
    if (TWO_PART_TLDS.has(twoPartTld)) return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

// ── Blocked lists ──────────────────────────────────────────────────────────────
const BLOCKED_DOMAINS = new Set([
  "wikipedia.org","fr.wikipedia.org","en.wikipedia.org",
  "youtube.com","youtu.be",
  "facebook.com","instagram.com","twitter.com","x.com",
  "linkedin.com","tiktok.com","pinterest.com","reddit.com",
  "eventbrite.com","eventbrite.ca","eventbrite.fr",
  "meetup.com","ticketmaster.com","ticketmaster.ca",
  "glassdoor.com","indeed.com","monster.com",
  "lapresse.ca","ledevoir.com","journaldequebec.com","lesaffaires.com",
  "radio-canada.ca","cbc.ca","tvanouvelles.ca","24heures.ca",
  "cision.com","newswire.ca","prnewswire.com","businesswire.com","globenewswire.com",
  "google.com","bing.com","yahoo.com","yelp.com","tripadvisor.com",
  "wordpress.com","wix.com","squarespace.com","medium.com","substack.com",
  "pagesjaunes.ca","pagesjaunes.com","yellowpages.ca","411.ca",
  "10times.com","10times.ca","allevents.in","eventful.com",
  "tourismexpress.com","batimatech.com","laguide.com",
  "conferencealerts.com","allconferences.com","confex.com",
  "eventsmontreal.ca","eventzilla.net",
  "fasken.com","lavery.ca","blg.com","nortonrosefulbright.com",
  "mccarthy.ca","stikeman.com","osler.com","gowlingwlg.com",
  "uqam.ca","hec.ca","polymtl.ca","ulaval.ca","umontreal.ca",
  "conseiller.ca","lesechos.fr","lefigaro.fr","lemonde.fr",
  "journaldemontreal.com",
  "dropbox.com","notion.so","airtable.com","monday.com","hubspot.com",
  "salesforce.com","mailchimp.com","eventmanager.com",
]);

const BLOCKED_URL_PATHS = /\/blog\/|\/news\/|\/press\/|\/article\/|\/articles\/|\/actualite\/|\/actualites\/|\/magazine\/|\/careers\/|\/carrieres\/|\/jobs\/|\/emplois\/|\/offres-emploi\/|\/salle-de-presse\/|\/communique\/|\/communiques\/|\/medias\/|\/presse\/|\/evenement\/|\/evenements\/|\/events\/|\/event\/|\/agenda\/|\/programme\/|\/inscription\/|\/register\/|\/actualite|\/nouvelles\/|\.pdf$/i;

// PHASE B — Anti-bruit pré-LLM: types à rejeter dès la réception
const ANTI_BRUIT = {
  article: /\b(article|blog|news|press release|communiqué|actualit[eé]|magazine|news|guide complet|comment |pourquoi |top \d+|liste de|idées de|trending|répertoire|annuaire|directory|listing|database)\b/i,
  calendar: /\b(calendar|agenda|événement|event|programme|program|inscription|register|archive|événements|archive)\b/i,
  venue: /\b(centre de congrès|palais des congrès|meeting room|salle|venue|location|espace|réception|banquet|hôtel|hotel|resort|resort|airbnb|hotel|hospitality)\b/i,
  agency: /\b(agence événementielle|event planner|organisateur|event management|event agency|party planner|wedding|mariage|planificateur|event organizer)\b/i,
  directory: /\b(répertoire|annuaire|directory|listing|pages jaunes|yellow pages|fournisseur|supplier|catalog|catalogue)\b/i,
  media: /\b(journal|newspaper|gazette|radio|tv|television|chaîne|channel|journal|presse|medias)\b/i,
};

function shouldRejectByNoise(url, title, snippet) {
  if (BLOCKED_DOMAINS.has(getRegistrableDomain(new URL(url, "https://example.com").hostname))) return "blocked";
  if (BLOCKED_URL_PATHS.test(url)) return "blocked_path";
  const combined = `${title} ${snippet}`.toLowerCase();
  for (const [key, regex] of Object.entries(ANTI_BRUIT)) {
    if (regex.test(combined)) return key;
  }
  return null;
}

// ── Sector list (SYNC Prospect industry sectors) ──────────────────────────────────
const ALL_SECTORS = new Set([
  "Finance & Assurance", "Santé & Pharma", "Technologie", "Gouvernement & Public",
  "Éducation & Formation", "Associations & OBNL", "Immobilier", "Droit & Comptabilité",
  "Industrie & Manufacture", "Commerce de détail", "Transport & Logistique",
]);

async function normalizeResult(r, requiredSectors = []) {
  const url = r.url || r.link || "";
  const hostname = new URL(url, "https://example.com").hostname || "";
  const domain = getRegistrableDomain(hostname).toLowerCase();
  const title = r.title || r.description || "";
  const snippet = r.snippet || r.description || "";
  const combined = `${title} ${snippet}`.toLowerCase();

  // Basic org name extraction
  const titleMatch = title.match(/^([A-ZÀ-ÿ][a-zà-ÿ\s&\-'éèêëïîôûüœæ]{2,100}?)\s*[-–|‹›«»]/);
  const companyName = titleMatch ? titleMatch[1].trim() : domain.split(".")[0].toUpperCase();
  const website = url;

  // Sector matching
  const matchedSectors = [];
  for (const sector of requiredSectors) {
    const sectorLower = sector.toLowerCase();
    if (combined.includes(sectorLower)) matchedSectors.push(sector);
  }

  const locationText = combined.match(/\b(montréal|quebec|ottawa|toronto|vancouver|calgary|winnipeg|halifax)\b/i)?.[0] || null;
  const industry = matchedSectors.length > 0 ? matchedSectors[0] : null;

  return {
    domain, companyName, website, industry, locationText,
    matchedSectors,
    isValid: !!domain && !!companyName,
    resultType: "ORG_WE_WANT",
    sectorMatch: matchedSectors.length > 0 || requiredSectors.length === 0,
  };
}

// ── Query builders ──────────────────────────────────────────────────────────────
const EXCL = '-site:linkedin.com -site:facebook.com -site:glassdoor.com -site:indeed.com -site:eventbrite.com -site:wikipedia.org -filetype:pdf';

function buildQueryVariants(campaign, loc) {
  const sector = (campaign.industrySectors || []).slice(0, 3).map(s => `"${s}"`).join(" ");
  const kws = (campaign.keywords || []).join(" ");
  const locQ = loc.split(",")[0].trim();
  const locAll = [locQ, `"${locQ}"`, loc].filter(Boolean);

  const queries = [];
  for (const l of locAll) {
    const base = `${sector} conférence OU congrès OU "assemblée générale" ${l} organisation entreprise ${kws} ${EXCL}`;
    queries.push(
      `${base}`,
      `gala OR "soirée corporative" ${l} ${sector} ${kws} ${EXCL}`,
      `"événement annuel" OR "réunion annuelle" ${l} ${sector} ${kws} ${EXCL}`,
      `${kws} ${l} gala OR congrès OR "assemblée générale" ${EXCL}`,
    );
  }

  return [...new Set(queries)].filter(q => q.length > 10);
}

function buildBroadFallbacks(campaign, loc) {
  const sector = (campaign.industrySectors || []).slice(0, 2).join(" ");
  return [
    `organisation ${loc} "congrès annuel" ${sector} ${EXCL}`,
    `association ${loc} congrès membres ${sector} ${EXCL}`,
    `entreprise ${loc} gala annuel conférence ${sector} ${EXCL}`,
    `fédération ${loc} assemblée annuelle ${sector} ${EXCL}`,
    `chambre de commerce ${loc} gala membres ${EXCL}`,
    `syndicat ${loc} assemblée générale ${sector} ${EXCL}`,
    `ordre ${loc} congrès annuel ${sector} ${EXCL}`,
  ];
}

// ── Main handler ───────────────────────────────────────────────────────────────
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

  const START_TIME = Date.now();
  const MAX_DURATION_MS = 70_000; // 70 seconds safety limit
  let timeoutTriggered = false;
  let finalStatus, errorMsg, stopReason;

  try {
    await base44.entities.Campaign.update(campaignId, { status: "RUNNING", progressPct: 5, lastRunAt: new Date().toISOString() });

    const loc    = campaign.locationQuery || "Montréal";
    const target = campaign.targetCount || 50;

    let appSettings = {};
    try {
      const settings = await base44.entities.AppSettings.filter({ settingsId: "global" });
      if (settings.length > 0) appSettings = settings[0];
    } catch (_) {}

    const BRAVE_MAX_REQUESTS  = appSettings.braveMaxRequestsPerCampaign || 250;
    const BRAVE_MAX_PAGES     = appSettings.braveMaxPagesPerQuery || 5;
    const BRAVE_MIN_REMAINING = appSettings.braveMinRemainingBeforePause || 2;
    const ENABLE_KB_TOPUP     = appSettings.enableKbTopUp !== false;

    const existing = await base44.entities.Prospect.filter({ campaignId });
    const existingDomains = new Set(existing.map(p => p.domain).filter(Boolean));
    let created = existing.length;

    let allKbEntities = [];
    let kbDomains = new Set();
    try {
      allKbEntities = await base44.entities.KBEntity.filter({}, "-created_date", 500);
      allKbEntities.forEach(e => { if (e.domain) kbDomains.add(e.domain.toLowerCase().replace(/^www\./, "")); });
    } catch (_) {}

    const allQueries = buildQueryVariants(campaign, loc);
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
      if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) { budgetGuardTriggered = true; return; }
      const maxPages = maxPagesOverride ?? Math.min(BRAVE_MAX_PAGES, (target - created) > 50 ? 7 : 5);

      for (let page = 0; page < maxPages && created < target && !budgetGuardTriggered; page++) {
        if (Date.now() - START_TIME > MAX_DURATION_MS) { timeoutTriggered = true; return; }
        let results = [];
        try {
          const braveResult = await braveSearch(query, 10, page * 10);
          braveRequestsUsed++;
          if (braveRLState.remaining >= 0 && braveRLState.remaining <= BRAVE_MIN_REMAINING) await waitForBraveReset(1000);
          if (braveResult.rateLimited) { rateLimitHit = true; break; }
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
          
          const noiseType = shouldRejectByNoise(r.url || r.link || "", r.title || "", r.snippet || r.description || "");
          if (noiseType) {
            filteredNonOrgCount++;
            continue;
          }
          
          const normalized = await normalizeResult(r, campaign.industrySectors);
          
          const hasRequiredSectors = campaign.industrySectors && campaign.industrySectors.length > 0;
          const isAccepted = normalized.isValid 
            && normalized.resultType === "ORG_WE_WANT"
            && (!hasRequiredSectors || normalized.sectorMatch);
            
          if (!isAccepted) { 
            filteredNonOrgCount++; 
            continue; 
          }

          const { domain, companyName, website } = normalized;
          if (existingDomains.has(domain) || kbDomains.has(domain)) { skippedDupe++; continue; }

          await base44.entities.Prospect.create({
            campaignId,
            ownerUserId: campaign.ownerUserId,
            companyName,
            website,
            domain,
            industry:    normalized.industry,
            industrySectors: Array.isArray(normalized.matchedSectors) && normalized.matchedSectors.length > 0
              ? normalized.matchedSectors
              : (campaign.industrySectors || []),
            industryLabel: Array.isArray(normalized.matchedSectors) && normalized.matchedSectors.length > 0
              ? normalized.matchedSectors[0]
              : ((campaign.industrySectors && campaign.industrySectors.length > 0) ? campaign.industrySectors[0] : null),
            location:    normalized.locationText ? { city: normalized.locationText, country: "CA" } : { country: "CA" },
            entityType:  "COMPANY",
            status:      "NOUVEAU",
            sourceOrigin: "WEB",
            serpSnippet: r?.snippet || r?.description || "",
            sourceUrl:   r?.url || r?.link || "",
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
    while (created < target && queryIndex < allQueries.length && !rateLimitHit && !budgetGuardTriggered && !timeoutTriggered) {
      const pct = Math.min(87, Math.round((created / target) * 87));
      await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created });
      await runQuery(allQueries[queryIndex]);
      queryIndex++;
    }

    // Phase 2: broad fallbacks if < 70% of target
    if (created < target * 0.7 && !rateLimitHit && !budgetGuardTriggered && !timeoutTriggered) {
      const broadFallbacks = buildBroadFallbacks(campaign, loc);
      for (const q of broadFallbacks) {
        if (created >= target || budgetGuardTriggered || timeoutTriggered) break;
        const pct = Math.min(87, Math.round((created / target) * 87));
        await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created });
        await runQuery(q, 3);
      }
    }

    // Phase KB_TOPUP
    let kbTopupAdded = 0, kbTopupSkippedDuplicate = 0, kbTopupCandidates = 0, kbTopupStoppedReason = null;
    let kbTopupRejectedSectorCount = 0, kbTopupRejectedMissingTagsCount = 0;

    const webStopReason = created >= target         ? "TARGET_REACHED"
      : budgetGuardTriggered                        ? "BUDGET_GUARD"
      : rateLimitHit                                ? "RATE_LIMIT"
      : timeoutTriggered                            ? "TIME_BUDGET"
      : queryIndex >= allQueries.length             ? "QUERIES_EXHAUSTED"
      : "ERROR";

    if (ENABLE_KB_TOPUP && created < target && ["QUERIES_EXHAUSTED","RATE_LIMIT","BUDGET_GUARD","TIME_BUDGET"].includes(webStopReason)) {
      await base44.entities.Campaign.update(campaignId, { progressPct: 90, countProspects: created });
      const locLower = loc.toLowerCase();
      const locCity  = locLower.split(",")[0].trim();
      const hasRequiredSectors = campaign.industrySectors && campaign.industrySectors.length > 0;

      const candidates = allKbEntities.filter(e => {
        const domNorm = (e.domain || "").toLowerCase().replace(/^www\./, "");
        if (existingDomains.has(domNorm)) return false;
        if (!e.domain || !e.website) return false;
        if (locCity && e.hqLocation) {
          const locE = e.hqLocation.toLowerCase();
          if (!locE.includes("canada") && !locE.includes(locCity)) return false;
        }
        return true;
      });
      kbTopupCandidates = candidates.length;

      for (const kb of candidates) {
        if (Date.now() - START_TIME > MAX_DURATION_MS) { timeoutTriggered = true; kbTopupStoppedReason = "TIME_BUDGET"; break; }
        if (created >= target) { kbTopupStoppedReason = "TARGET_REACHED"; break; }
        const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
        if (existingDomains.has(domNorm)) { kbTopupSkippedDuplicate++; continue; }

        // STRICT sector matching: if campaign has sectors, KB must match
        let matchedSectors = [];
        if (hasRequiredSectors) {
          const kbTags = Array.isArray(kb.tags) ? kb.tags : [];
          matchedSectors = kbTags.filter(t => campaign.industrySectors.includes(t));
          if (matchedSectors.length === 0) {
            if (kbTags.length === 0) kbTopupRejectedMissingTagsCount++;
            else kbTopupRejectedSectorCount++;
            continue;
          }
        } else {
          matchedSectors = (Array.isArray(kb.tags) && kb.tags.length > 0) ? kb.tags : [];
        }

        await base44.entities.Prospect.create({
          campaignId,
          ownerUserId:  campaign.ownerUserId,
          companyName:  kb.name,
          website:      kb.website || `https://${kb.domain}`,
          domain:       domNorm,
          industry:     kb.entityType || null,
          industrySectors: matchedSectors.length > 0 ? matchedSectors : (hasRequiredSectors && campaign.industrySectors ? campaign.industrySectors : []),
          industryLabel: matchedSectors.length > 0 ? matchedSectors[0] : (hasRequiredSectors && campaign.industrySectors ? campaign.industrySectors[0] : null),
          location:     kb.hqLocation ? { city: kb.hqLocation, country: "CA" } : { country: "CA" },
          entityType:   kb.entityType || "COMPANY",
          status:       "NOUVEAU",
          sourceOrigin: "KB_TOPUP",
          kbEntityId:   kb.id,
          serpSnippet:  kb.notes || "",
          sourceUrl:    kb.source || "",
        });

        existingDomains.add(domNorm);
        created++;
        kbTopupAdded++;
        
        // Regular progress update during KB_TOPUP
        if (kbTopupAdded % 5 === 0) {
          const pct = Math.min(98, 90 + Math.round((kbTopupAdded / Math.max(10, kbTopupCandidates)) * 8));
          await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created, toolUsage: { lastUpdateAt: new Date().toISOString() } });
        }
      }
      if (!kbTopupStoppedReason) kbTopupStoppedReason = created >= target ? "TARGET_REACHED" : "KB_EXHAUSTED";
    }

    // Final status
    if (timeoutTriggered && created > 0 && kbTopupStoppedReason !== "TIME_BUDGET") {
      stopReason = "TIME_BUDGET_WEB_PARTIAL";
    } else if (timeoutTriggered && created > 0) {
      stopReason = "TIME_BUDGET";
    } else if (created >= target) {
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

    if (created === 0) {
      finalStatus = "FAILED";
      errorMsg = stopReason === "RATE_LIMIT"   ? "Limite de l'API Brave atteinte. Réessayez dans quelques minutes."
        : stopReason === "BUDGET_GUARD"        ? `Limite de requêtes Brave atteinte (${BRAVE_MAX_REQUESTS} req max).`
        : "Aucun prospect valide trouvé — vérifiez les clés API Brave/SerpAPI";
    } else if (created < target) {
      finalStatus = "DONE_PARTIAL";
      const kbNote = kbTopupAdded > 0 ? ` + ${kbTopupAdded} via KB` : "";
      if      (stopReason === "KB_EXHAUSTED")  errorMsg = `Web + KB épuisés : ${created}/${target} (${createdWeb} web${kbNote}).`;
      else if (stopReason === "BUDGET_GUARD")  errorMsg = `Limite Brave : ${createdWeb} web${kbNote} / ${target}. (${braveRequestsUsed}/${BRAVE_MAX_REQUESTS} req)`;
      else if (stopReason === "RATE_LIMIT")    errorMsg = `Limite API : ${createdWeb} web${kbNote} / ${target}. Relancez dans quelques minutes.`;
      else if (stopReason === "TIME_BUDGET")   errorMsg = `Timeout API : ${createdWeb} web${kbNote} / ${target}. Relancez pour compléter.`;
      else                                     errorMsg = `Terminé : ${createdWeb} web${kbNote} / ${target}.${skippedDupe > 0 ? ` ${skippedDupe} doublons ignorés.` : ""}`;
    } else {
      finalStatus = "DONE";
    }

    // DONE_PARTIAL + suggestedNextStep
    let suggestedNextStep = null;
    if (finalStatus === "DONE_PARTIAL" && stopReason === "QUERIES_EXHAUSTED") {
      if (campaign.industrySectors && campaign.industrySectors.length > 0) {
        errorMsg = `Filtrage strict secteur : ${created}/${target}. Suggestions : enlever un secteur / élargir zone / retirer mots-clés.`;
        suggestedNextStep = "RELAX_FILTERS";
      }
    }
    if (finalStatus === "DONE_PARTIAL" && kbTopupRejectedSectorCount > 0) {
      const kbRejectedNote = `(${kbTopupRejectedSectorCount} KB rejetées : pas de secteur match)`;
      errorMsg += ` ${kbRejectedNote}`;
      if (!suggestedNextStep) suggestedNextStep = "RELAX_FILTERS";
    }

    const toolUsage = {
      queries: totalQueriesRun, skippedDuplicates: skippedDupe, filteredNonOrgCount,
      queriesUsed: queryLog.slice(0, 10).map(q => q.query),
      braveRequestsUsed, braveMaxRequests: BRAVE_MAX_REQUESTS,
      braveRateLimitLimit: braveRLState.limit, braveRateLimitRemaining: braveRLState.remaining,
      braveRateLimitReset: braveRLState.reset, brave429Count: braveRLState.count429,
      stopReason, webStopReason, createdWeb, kbTopupAdded, kbTopupCandidates,
      kbTopupSkippedDuplicate, kbTopupStoppedReason,
      kbTopupRejectedSectorCount, kbTopupRejectedMissingTagsCount,
      lastQueryIndex: queryIndex, allQueriesCount: allQueries.length,
      queryLog: queryLog.slice(0, 30),
    };

    await base44.entities.Campaign.update(campaignId, {
      status: finalStatus, progressPct: 100, countProspects: created, errorMessage: errorMsg, toolUsage,
    });

    await base44.entities.ActivityLog.create({
      ownerUserId: user.email,
      actionType: "RUN_PROSPECT_SEARCH",
      entityType: "Campaign",
      entityId: campaignId,
      payload: {
        created, createdWeb, kbTopupAdded, kbTopupCandidates, target,
        coverage: `${Math.round(created / target * 100)}%`,
        skippedDuplicates: skippedDupe, filteredNonOrgCount, queriesRun: totalQueriesRun,
        braveRequestsUsed, braveMaxRequests: BRAVE_MAX_REQUESTS,
        brave429Count: braveRLState.count429, stopReason, webStopReason,
        suggestedNextStep, kbTopupRejectedSectorCount, kbTopupRejectedMissingTagsCount,
      },
      status: created > 0 ? "SUCCESS" : "ERROR",
      errorMessage: errorMsg,
    });

    return Response.json({ 
      success: created > 0, created, target, coverage: Math.round(created / target * 100), 
      skippedDuplicates: skippedDupe, filteredNonOrgCount, stopReason, suggestedNextStep 
    });

  } catch (error) {
    // Emergency fallback: ensure campaign gets a final status
    console.error("Critical error in runProspectSearch:", error.message);
    
    const emergencyFetch = await base44.entities.Prospect.filter({ campaignId }).catch(() => []);
    const emergencyCreated = emergencyFetch.length;

    finalStatus = emergencyCreated > 0 ? "DONE_PARTIAL" : "FAILED";
    stopReason = "ERROR";
    errorMsg = `Erreur système : ${error.message?.slice(0, 100) || "Erreur inconnue"}. ${emergencyCreated > 0 ? `${emergencyCreated} prospects créés avant l'erreur.` : ""}`;

    try {
      await base44.entities.Campaign.update(campaignId, {
        status: finalStatus, progressPct: 100, countProspects: emergencyCreated, errorMessage: errorMsg, toolUsage: { stopReason, emergency: true },
      });
    } catch (_) {}

    return Response.json({ 
      success: false, error: errorMsg, status: finalStatus, created: emergencyCreated
    }, { status: 500 });
  }
});