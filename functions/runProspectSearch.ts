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

// Filtre anti-bruit pour URLs/titres/snippets AVANT tout traitement
function shouldRejectByNoise(url, title, snippet) {
  const combined = (url + " " + title + " " + snippet).toLowerCase();
  
  // Vérifier chaque catégorie de bruit
  for (const [key, regex] of Object.entries(ANTI_BRUIT)) {
    if (regex.test(combined)) return key;
  }
  
  // PDFs et archives
  if (/\.pdf$/i.test(url)) return "pdf";
  if (/archive|archived|passé|old/i.test(combined)) return "archive";
  
  return null;
}

const EXCLUDE_CONTENT_RE = /agence événementielle|event planner|organisateur professionnel|planificateur événement|bureau de congrès|répertoire fournisseurs|annuaire|directory|listing|database|crm\b|logiciel événement|software|saas|plateforme de gestion|template|thème wordpress|plugin|définition|procuration|règlements généraux|politique de gouvernance|guide complet|tout savoir sur|qu'est-ce qu'une/i;

const ARTICLE_TITLE_RE = /^(comment |pourquoi |quand |les \d+|top \d+|\d+ façons|guide |conseils |astuces |what is |how to |best |why |when |définition |c'est quoi |qu'est.ce |tout savoir)/i;

const EVENT_SUBDOMAIN_RE = /^(congres|conference|conferences|event|events|evenement|evenements|agenda|calendrier|programme|program|summit|forum|gala|colloque|symposium|inscription|register)\b/i;
const EVENT_TITLE_RE = /^(congrès|conférence|assemblée générale|assemblée|gala|colloque|symposium|forum|sommet|summit|journée|webinaire|séminaire|atelier)\b/i;

const ORG_SIGNAL_RE = /\b(association|ordre|fédération|chambre|fondation|syndicat|corporation|entreprise|société|compagnie|inc\b|ltée|s\.a\.|organisme|réseau|conseil|institut|coalition)\b/i;
const EVENT_SIGNAL_RE = /assemblée générale|conférence|gala|événement corporatif|corporate event|meeting annuel|summit|forum|symposium|colloque|webinaire|formation interne|townhall|town.?hall|réunion annuelle|congrès/i;

// ── Homepage name fetcher ──────────────────────────────────────────────────────
async function fetchOrgName(registrableDomain) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`https://${registrableDomain}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SYNCBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
    if (ogMatch) return cleanOrgName(ogMatch[1]);
    const titleMatch = html.match(/<title>([^<]{3,80})<\/title>/i);
    if (titleMatch) return cleanOrgName(titleMatch[1]);
    return null;
  } catch (_) { return null; }
}

function cleanOrgName(raw) {
  return raw.replace(/\s*[|\-–—]\s*.{0,80}$/, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

// ── Sector matcher helper (basic keyword match for fast pre-screening)
function matchesSector(text, sectors) {
  if (!sectors || sectors.length === 0) return true;
  const lower = text.toLowerCase();
  const sectorKeywords = {
    "Finance & Assurance": /finance|assurance|banque|bank|crédit|insurance|hypothèque/i,
    "Santé & Pharma": /santé|pharma|medical|médical|hôpital|hospital|clinique|dentaire|doctor/i,
    "Technologie": /tech|software|informatique|it |digital|logiciel|app|cloud|saas|startup/i,
    "Gouvernement & Public": /gouvernement|government|municipal|municipal|public|administration|état|ministère/i,
    "Éducation & Formation": /éducation|école|school|université|university|collège|formation|training|cégep/i,
    "Associations & OBNL": /association|organisme|obnl|non-profit|ngô|charity|fondation|fédération/i,
    "Immobilier": /immobilier|real estate|property|développeur|developer|construction|rénovation/i,
    "Droit & Comptabilité": /droit|legal|comptable|accounting|cabinet|law firm|avocat/i,
    "Industrie & Manufacture": /industrie|manufacture|factory|usine|production|fabrication|mining|minier/i,
    "Commerce de détail": /retail|commerce|boutique|magasin|store|détail|retail|vente/i,
    "Transport & Logistique": /transport|logistique|logistics|delivery|livraison|cargo|shipping/i,
  };
  return sectors.some(s => {
    const regex = sectorKeywords[s];
    return regex ? regex.test(lower) : false;
  });
}

// ── normalizeResult ────────────────────────────────────────────────────────────
async function normalizeResult(r, campaignSectors) {
  const url = r.url || r.link;
  if (!url) return { isValid: false, resultType: "OTHER", reason: "No URL" };

  let parsedUrl;
  try { parsedUrl = new URL(url.startsWith("http") ? url : "https://" + url); }
  catch (_) { return { isValid: false, resultType: "OTHER", reason: "Invalid URL" }; }

  const rawHost = parsedUrl.hostname.replace(/^www\./, "");
  const registrableDomain = getRegistrableDomain(rawHost);

  if (BLOCKED_DOMAINS.has(rawHost) || BLOCKED_DOMAINS.has(registrableDomain)) {
    return { isValid: false, resultType: "OTHER", reason: "Domain blocked" };
  }
  if (BLOCKED_URL_PATHS.test(url)) {
    return { isValid: false, resultType: "OTHER", reason: "URL path blocked" };
  }

  const rawTitle   = r.title || "";
  const rawSnippet = r.snippet || r.description || "";
  const combined   = (rawTitle + " " + rawSnippet).toLowerCase();

  if (EXCLUDE_CONTENT_RE.test(combined)) {
    return { isValid: false, resultType: "ARTICLE", reason: "Excluded content keywords" };
  }
  if (ARTICLE_TITLE_RE.test(rawTitle)) {
    return { isValid: false, resultType: "ARTICLE", reason: "Article title pattern" };
  }

  const hasOrgSignal   = ORG_SIGNAL_RE.test(rawTitle + " " + rawSnippet + " " + registrableDomain);
  const hasEventSignal = EVENT_SIGNAL_RE.test(combined);
  if (!hasOrgSignal || !hasEventSignal) {
    const noOrg = !hasOrgSignal ? "no org signal" : "";
    const noEvent = !hasEventSignal ? "no event signal" : "";
    return { isValid: false, resultType: "OTHER", reason: `${noOrg} ${noEvent}`.trim() };
  }

  const firstLabel = rawHost.split(".")[0];
  const isEventSubdomain = (rawHost !== registrableDomain) && EVENT_SUBDOMAIN_RE.test(firstLabel);

  const domain    = registrableDomain;
  const website   = `https://${domain}`;
  const sourceUrl = url;

  // Always fetch homepage first — it's the most reliable source for the real org name
  let companyName = await fetchOrgName(domain);

  // Fallback: clean up the SERP title if homepage fetch failed
  if (!companyName) {
    const cleanedTitle = rawTitle
      .replace(/\s*[-–—|]\s*(congrès|conférence|gala|assemblée|colloque|forum|événement|event|2024|2025|2026|programme|inscription|ordre du jour)\b.*/i, "")
      .replace(/\s*[-–—|]\s*\d{4}\b.*/i, "")
      .trim();
    // Only accept if it doesn't look like an event title or an article
    if (cleanedTitle.length >= 3 && !EVENT_TITLE_RE.test(cleanedTitle) && !isEventSubdomain) {
      companyName = cleanedTitle.slice(0, 80);
    }
  }

  // Reject if we still can't determine a real org name
  if (!companyName) {
    return { isValid: false, resultType: "OTHER", reason: "No company name extracted" };
  }

  // PHASE B: Check sector match if required
  const sectorMatch = matchesSector(companyName + " " + rawSnippet + " " + rawTitle, campaignSectors);
  
  return {
    isValid: true,
    resultType: "ORG_WE_WANT",
    sectorMatch,
    matchedSectors: campaignSectors || [],
    companyName,
    website,
    domain,
    industry: null,
    locationText: null,
    reason: "Valid org with event signals"
  };
}

// ── Query builders ─────────────────────────────────────────────────────────────
const EXCL = `-Eventbrite -"10times" -"pagesjaunes" -"tourismexpress" -annuaire -répertoire -"liste d'événements" -"calendrier d'événements" -"agence événementielle" -"event planner" -"planificateur"`;

function buildQueryVariants(campaign, loc) {
  const sectors  = (campaign.industrySectors || []).slice(0, 2);
  const sectorStr = sectors.join(" ");
  const kws = (campaign.keywords || []).slice(0, 3).join(" ");
  const queries = [];

  if (sectorStr) {
    queries.push(
      `association ${sectorStr} ${loc} congrès annuel site web ${EXCL}`,
      `fédération ${sectorStr} ${loc} assemblée générale annuelle ${EXCL}`,
      `ordre professionnel ${sectorStr} ${loc} congrès ${EXCL}`,
      `syndicat ${sectorStr} ${loc} assemblée générale ${EXCL}`,
      `entreprise ${sectorStr} ${loc} conférence annuelle événement corporatif ${EXCL}`,
      `société ${sectorStr} ${loc} gala annuel OR réunion annuelle ${EXCL}`,
      `grande entreprise ${sectorStr} ${loc} formation interne townhall ${EXCL}`,
      `chambre de commerce ${sectorStr} ${loc} gala membres ${EXCL}`,
      `conseil ${sectorStr} ${loc} conférence assemblée ${EXCL}`,
    );
  }

  queries.push(
    `association professionnelle ${loc} congrès annuel site web ${EXCL}`,
    `fédération ${loc} assemblée générale congrès ${EXCL}`,
    `ordre professionnel ${loc} assemblée congrès ${EXCL}`,
    `entreprise ${loc} "événement corporatif" OR "conférence annuelle" OR "gala annuel" ${EXCL}`,
    `société ${loc} townhall OR "formation interne" OR "réunion annuelle" ${EXCL}`,
    `chambre de commerce ${loc} gala membres conférence ${EXCL}`,
    `conseil ${loc} "conférence annuelle" OR "assemblée annuelle" ${EXCL}`,
    `syndicat ${loc} assemblée générale annuelle ${EXCL}`,
    `institut ${loc} conférence colloque annuel ${EXCL}`,
    `site:.ca (association OR fédération OR ordre) ${loc} congrès "événement annuel" ${EXCL}`,
    `site:.ca entreprise ${loc} gala OR conférence OR "assemblée générale" ${EXCL}`,
    `organisation ${loc} "congrès annuel" OR "assemblée générale" secteur ${sectorStr} ${EXCL}`,
  );

  if (kws) {
    queries.push(
      `"${kws}" ${loc} association OR entreprise conférence annuelle ${EXCL}`,
      `${kws} ${loc} gala OR congrès OR "assemblée générale" ${EXCL}`,
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
        
        // PHASE B.1: Anti-bruit PRÉ-LLM — reject before any processing
        const noiseType = shouldRejectByNoise(r.url || r.link || "", r.title || "", r.snippet || r.description || "");
        if (noiseType) {
          filteredNonOrgCount++;
          continue;
        }
        
        // PHASE B.2: normalizeResult with sector checking
        const normalized = await normalizeResult(r, campaign.industrySectors);
        
        // PHASE B.3: Strict acceptance rule
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
  while (created < target && queryIndex < allQueries.length && !rateLimitHit && !budgetGuardTriggered) {
    const pct = Math.min(87, Math.round((created / target) * 87));
    await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created });
    await runQuery(allQueries[queryIndex]);
    queryIndex++;
  }

  // Phase 2: broad fallbacks if < 70% of target
  if (created < target * 0.7 && !rateLimitHit && !budgetGuardTriggered) {
    const broadFallbacks = buildBroadFallbacks(campaign, loc);
    for (const q of broadFallbacks) {
      if (created >= target || budgetGuardTriggered) break;
      const pct = Math.min(87, Math.round((created / target) * 87));
      await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created });
      await runQuery(q, 3);
    }
  }

  // Phase KB_TOPUP
  let kbTopupAdded = 0, kbTopupSkippedDuplicate = 0, kbTopupCandidates = 0, kbTopupStoppedReason = null;

  const webStopReason = created >= target         ? "TARGET_REACHED"
    : budgetGuardTriggered                        ? "BUDGET_GUARD"
    : rateLimitHit                                ? "RATE_LIMIT"
    : queryIndex >= allQueries.length             ? "QUERIES_EXHAUSTED"
    : "ERROR";

  if (ENABLE_KB_TOPUP && created < target && ["QUERIES_EXHAUSTED","RATE_LIMIT","BUDGET_GUARD"].includes(webStopReason)) {
    await base44.entities.Campaign.update(campaignId, { progressPct: 90, countProspects: created });
    const locLower = loc.toLowerCase();
    const locCity  = locLower.split(",")[0].trim();

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
      if (created >= target) { kbTopupStoppedReason = "TARGET_REACHED"; break; }
      const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) { kbTopupSkippedDuplicate++; continue; }

      await base44.entities.Prospect.create({
        campaignId,
        ownerUserId:  campaign.ownerUserId,
        companyName:  kb.name,
        website:      kb.website || `https://${kb.domain}`,
        domain:       domNorm,
        industry:     kb.entityType || null,
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
    }
    if (!kbTopupStoppedReason) kbTopupStoppedReason = created >= target ? "TARGET_REACHED" : "KB_EXHAUSTED";
  }

  // Final status
  let stopReason;
  if      (created >= target)                                           stopReason = "TARGET_REACHED";
  else if (kbTopupAdded > 0 && kbTopupStoppedReason === "KB_EXHAUSTED") stopReason = "KB_EXHAUSTED";
  else if (budgetGuardTriggered)                                         stopReason = "BUDGET_GUARD";
  else if (rateLimitHit)                                                 stopReason = "RATE_LIMIT";
  else if (queryIndex >= allQueries.length)                              stopReason = "QUERIES_EXHAUSTED";
  else                                                                   stopReason = "ERROR";

  let finalStatus, errorMsg;
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
    else                                     errorMsg = `Terminé : ${createdWeb} web${kbNote} / ${target}.${skippedDupe > 0 ? ` ${skippedDupe} doublons ignorés.` : ""}`;
  } else {
    finalStatus = "COMPLETED";
  }

  const toolUsage = {
    queries: totalQueriesRun, skippedDuplicates: skippedDupe, filteredNonOrgCount,
    queriesUsed: queryLog.slice(0, 10).map(q => q.query),
    braveRequestsUsed, braveMaxRequests: BRAVE_MAX_REQUESTS,
    braveRateLimitLimit: braveRLState.limit, braveRateLimitRemaining: braveRLState.remaining,
    braveRateLimitReset: braveRLState.reset, brave429Count: braveRLState.count429,
    stopReason, webStopReason, createdWeb, kbTopupAdded, kbTopupCandidates,
    kbTopupSkippedDuplicate, kbTopupStoppedReason,
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
    },
    status: created > 0 ? "SUCCESS" : "ERROR",
    errorMessage: errorMsg,
  });

  return Response.json({ success: created > 0, created, target, coverage: Math.round(created / target * 100), skippedDuplicates: skippedDupe, filteredNonOrgCount, stopReason });
});