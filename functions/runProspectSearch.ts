import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_KEY  = Deno.env.get("OPENAI_API_KEY");
const BRAVE_KEY   = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

// ── Helpers ────────────────────────────────────────────────────────────────────

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

/**
 * Returns the registrable domain (eTLD+1) without www.
 * Handles .qc.ca and .co.uk style 2-part TLDs with a known set.
 */
const TWO_PART_TLDS = new Set(["qc.ca", "co.ca", "on.ca", "bc.ca", "ab.ca", "mb.ca", "nb.ca", "ns.ca", "nl.ca", "pe.ca", "sk.ca", "co.uk", "org.uk", "me.uk"]);

function getRegistrableDomain(hostname) {
  const host = hostname.replace(/^www\./, "");
  const labels = host.split(".");
  if (labels.length >= 3) {
    const twoPartTld = labels.slice(-2).join(".");
    if (TWO_PART_TLDS.has(twoPartTld)) {
      return labels.slice(-3).join(".");
    }
  }
  return labels.slice(-2).join(".");
}

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    return u.hostname.replace(/^www\./, "");
  } catch { return null; }
}

// Subdomains that signal an event microsite (not the org homepage)
const EVENT_SUBDOMAIN_RE = /^(congres|conference|conferences|event|events|evenement|evenements|agenda|calendrier|programme|program|summit|forum|gala|colloque|symposium|inscription|register)\b/i;

// Titles that look like an event page rather than an org page
const EVENT_TITLE_RE = /^(congrès|conférence|assemblée générale|assemblée|gala|colloque|symposium|forum|sommet|summit|journée|webinaire|séminaire|atelier)\b/i;

// Article / guide title starters — reject
const ARTICLE_TITLE_RE = /^(comment |pourquoi |quand |les \d+|top \d+|\d+ façons|guide |conseils |astuces |what is |how to |best |why |when |définition |c'est quoi |qu'est.ce |tout savoir)/i;

// ── Blocked lists ──────────────────────────────────────────────────────────────

const BLOCKED_DOMAINS = new Set([
  "wikipedia.org", "fr.wikipedia.org", "en.wikipedia.org",
  "youtube.com", "youtu.be",
  "facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "tiktok.com", "pinterest.com", "reddit.com",
  "eventbrite.com", "eventbrite.ca", "eventbrite.fr",
  "meetup.com", "ticketmaster.com", "ticketmaster.ca",
  "glassdoor.com", "indeed.com", "monster.com",
  "lapresse.ca", "ledevoir.com", "journaldequebec.com", "lesaffaires.com",
  "radio-canada.ca", "cbc.ca", "tvanouvelles.ca", "24heures.ca",
  "cision.com", "newswire.ca", "prnewswire.com", "businesswire.com", "globenewswire.com",
  "google.com", "bing.com", "yahoo.com", "yelp.com", "tripadvisor.com",
  "wordpress.com", "wix.com", "squarespace.com", "medium.com", "substack.com",
  "pagesjaunes.ca", "pagesjaunes.com", "yellowpages.ca", "411.ca",
  "10times.com", "10times.ca", "allevents.in", "eventful.com",
  "tourismexpress.com", "batimatech.com", "laguide.com",
  "conferencealerts.com", "allconferences.com", "confex.com",
  "eventsmontreal.ca", "eventzilla.net",
  // Publishers / cabinets / génériques
  "fasken.com", "lavery.ca", "blg.com", "nortonrosefulbright.com",
  "mccarthy.ca", "stikeman.com", "osler.com", "gowlingwlg.com",
  "uqam.ca", "hec.ca", "polymtl.ca", "ulaval.ca", "umontreal.ca",
  "conseiller.ca", "lesechos.fr", "lefigaro.fr", "lemonde.fr",
  "journaldemontreal.com", "journaldequebec.com",
  "dropbox.com", "notion.so", "airtable.com", "monday.com", "hubspot.com",
  "salesforce.com", "mailchimp.com", "eventmanager.com",
]);

const BLOCKED_URL_PATHS = /\/blog\/|\/news\/|\/press\/|\/article\/|\/articles\/|\/actualite\/|\/actualites\/|\/magazine\/|\/careers\/|\/carrieres\/|\/jobs\/|\/emplois\/|\/offres-emploi\/|\/salle-de-presse\/|\/communique\/|\/communiques\/|\/medias\/|\/presse\/|\/evenement\/|\/evenements\/|\/events\/|\/event\/|\/agenda\/|\/programme\/|\/inscription\/|\/register\/|\/actualite|\/nouvelles\//i;

// Combined content rejection for non-org pages
const EXCLUDE_CONTENT_RE = /agence événementielle|event planner|organisateur professionnel|planificateur événement|bureau de congrès|répertoire fournisseurs|annuaire|directory|listing|database|crm\b|logiciel événement|software|saas|plateforme de gestion|template|thème wordpress|plugin|définition|procuration|règlements généraux|politique de gouvernance|guide complet|tout savoir sur|qu'est-ce qu'une/i;

// Must find at least one of these signals
const EVENT_SIGNAL_RE = /assemblée générale|conférence|gala|événement corporatif|événement d'entreprise|corporate event|meeting annuel|summit|forum|symposium|colloque|webinaire|formation interne|townhall|town.?hall|réunion annuelle|congrès/i;

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
    // Try og:site_name first
    const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
    if (ogMatch) return cleanOrgName(ogMatch[1]);
    // Fallback: <title>
    const titleMatch = html.match(/<title>([^<]{3,80})<\/title>/i);
    if (titleMatch) return cleanOrgName(titleMatch[1]);
    return null;
  } catch (_) { return null; }
}

function cleanOrgName(raw) {
  // Remove "| something" or "- something" suffix (taglines, location)
  return raw.replace(/\s*[|\-–—]\s*.{0,80}$/, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function domainToTitleCase(registrableDomain) {
  const sld = registrableDomain.split(".")[0]; // e.g. "amvq", "cag-acg"
  return sld.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── normalizeResult ────────────────────────────────────────────────────────────

async function normalizeResult(r) {
  const url = r.url || r.link;
  if (!url) return null;

  let parsedUrl;
  try { parsedUrl = new URL(url.startsWith("http") ? url : "https://" + url); }
  catch (_) { return null; }

  const rawHost = parsedUrl.hostname.replace(/^www\./, "");
  const registrableDomain = getRegistrableDomain(rawHost);

  // Block check against registrable domain
  if (BLOCKED_DOMAINS.has(rawHost) || BLOCKED_DOMAINS.has(registrableDomain)) return null;

  // Block URL paths
  if (BLOCKED_URL_PATHS.test(url)) return null;

  const rawTitle   = r.title || "";
  const rawSnippet = r.snippet || r.description || "";
  const combined   = (rawTitle + " " + rawSnippet).toLowerCase();

  // Reject non-org / generic / article content
  if (EXCLUDE_CONTENT_RE.test(combined)) return null;
  if (ARTICLE_TITLE_RE.test(rawTitle))   return null;

  // Must have at least one event signal
  if (!EVENT_SIGNAL_RE.test(combined)) return null;

  // ── Detect event subdomains → redirect to org root ──
  const firstLabel = rawHost.split(".")[0];
  const isEventSubdomain = (rawHost !== registrableDomain) && EVENT_SUBDOMAIN_RE.test(firstLabel);

  const domain  = registrableDomain;   // always the registrable domain
  const website = `https://${domain}`; // always root
  // Keep original URL as sourceUrl so analyst can check the event page
  const sourceUrl = url;

  // ── Derive company name ──
  let companyName = null;

  // 1) If it's an event subdomain or event-style title → try to fetch real name from homepage
  const needsHomepageFetch = isEventSubdomain || EVENT_TITLE_RE.test(rawTitle) || rawTitle.length < 4;

  if (needsHomepageFetch) {
    companyName = await fetchOrgName(domain);
  }

  // 2) Fallback: clean page title (strip event suffix like "Congrès 2025 - Org Name")
  if (!companyName) {
    const cleanedTitle = rawTitle.replace(/\s*[-–—|]\s*(congrès|conférence|gala|assemblée|colloque|forum|événement|event|2024|2025|2026)\b.*/i, "").trim();
    if (cleanedTitle.length >= 3 && !EVENT_TITLE_RE.test(cleanedTitle)) {
      companyName = cleanedTitle.slice(0, 80);
    }
  }

  // 3) Last resort: domain-derived title case
  if (!companyName) {
    companyName = domainToTitleCase(domain);
  }

  return {
    normalized: {
      companyName,
      website,
      domain,
      industry: null,
      location: { city: "", region: "", country: "CA" },
      entityType: "COMPANY",
    },
    domain,
    sourceUrl,
  };
}

// ── Query builders ─────────────────────────────────────────────────────────────

const ORG_TERMS = `("association" OR "ordre" OR "fédération" OR "chambre" OR "fondation" OR "organisme" OR "entreprise" OR "syndicat")`;
const EVENT_TERMS = `("congrès" OR "conférence" OR "gala" OR "assemblée générale" OR "réunion annuelle" OR "sommet")`;
const EXCLUDE_AGG = `-Eventbrite -"10times" -"pagesjaunes" -"tourismexpress" -"liste d\'événements" -"calendrier d\'événements" -annuaire`;

function buildQueryVariants(campaign, loc) {
  const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
  const kws    = campaign.keywords?.slice(0, 3).join(" ") || "";
  const excl   = `-"agence événementielle" -"event planner" -"planificateur" ${EXCLUDE_AGG}`;

  const queries = [
    // Focused org+event combos
    `${loc} ${ORG_TERMS} ${EVENT_TERMS} ${sector} ${excl}`.trim(),
    `${loc} ${sector} ${ORG_TERMS} "congrès annuel" OR "conférence annuelle" ${excl}`.trim(),
    `${loc} ${sector} ${ORG_TERMS} "assemblée générale annuelle" ${excl}`.trim(),
    `${loc} ${ORG_TERMS} "gala annuel" OR "soirée annuelle" ${sector} ${excl}`.trim(),
    `${loc} ${ORG_TERMS} "townhall" OR "formation interne" OR "webdiffusion" ${sector} ${excl}`.trim(),
    `${loc} ${ORG_TERMS} "colloque" OR "symposium" ${sector} ${excl}`.trim(),
    // Specific org types
    `association professionnelle congrès ${loc} ${sector} ${excl}`.trim(),
    `ordre professionnel assemblée annuelle ${loc} ${sector} ${excl}`.trim(),
    `chambre de commerce événement corporatif ${loc} membres ${excl}`.trim(),
    `fédération congrès annuel ${loc} ${sector} ${excl}`.trim(),
    `syndicat assemblée générale ${loc} ${sector} ${excl}`.trim(),
    `grande entreprise événement annuel employés ${loc} ${sector} ${excl}`.trim(),
    ...(kws ? [
      `"${kws}" ${ORG_TERMS} ${EVENT_TERMS} ${loc} ${excl}`.trim(),
      `${kws} "conférence annuelle" OR "gala" ${loc} ${excl}`.trim(),
    ] : []),
    `(${loc}) (${sector}) ${ORG_TERMS} ${EVENT_TERMS}`.trim(),
    `site:.ca ${ORG_TERMS} événement corporatif ${loc} ${sector}`.trim(),
  ];

  return queries.filter(q => q.length > 10);
}

function buildBroadFallbacks(campaign, loc) {
  const sector = campaign.industrySectors?.slice(0, 2).join(" ") || "";
  return [
    `organisation ${loc} événement annuel réunion ${sector} ${EXCLUDE_AGG}`.trim(),
    `entreprise ${loc} ${sector} conférence annuelle ${EXCLUDE_AGG}`.trim(),
    `association ${loc} ${sector} membres assemblée générale ${EXCLUDE_AGG}`.trim(),
    `chambres de commerce ${loc} membres entreprises ${EXCLUDE_AGG}`.trim(),
    `"${loc}" événement corporatif B2B organisateur ${EXCLUDE_AGG}`.trim(),
    `grande entreprise ${loc} ${sector} site web ${EXCLUDE_AGG}`.trim(),
    `syndicat association ${loc} ${sector} assemblée annuelle ${EXCLUDE_AGG}`.trim(),
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
        // normalizeResult is now async (homepage fetch)
        const normalized = await normalizeResult(r);
        if (!normalized) { filteredNonOrgCount++; continue; }

        const { domain, sourceUrl } = normalized;
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
          serpSnippet: r?.snippet || r?.description || "",
          sourceUrl: sourceUrl || r?.url || r?.link || "",
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
    const pct = Math.min(95, Math.round((created / target) * 95));
    await base44.entities.Campaign.update(campaignId, { progressPct: pct, countProspects: created });
    await runQuery(allQueries[queryIndex]);
    queryIndex++;
  }

  // Phase 2: broadened fallbacks if < 60% of target
  if (created < target * 0.6 && !rateLimitHit && !budgetGuardTriggered) {
    await base44.entities.Campaign.update(campaignId, { progressPct: Math.min(95, Math.round((created / target) * 95)), countProspects: created });
    const fallbacks = [
      `organisation ${loc} événement annuel réunion`,
      `entreprise ${loc} conférence`,
      `association ${loc} membres assemblée`,
      `"${loc}" événements corporatifs B2B`,
      `chambres de commerce ${loc} membres`,
    ];
    for (const q of fallbacks) {
      if (created >= target || budgetGuardTriggered) break;
      await runQuery(q, 2);
    }
  }

  // Phase 3: broad fallbacks
  if (created < target && (target - created) >= 10 && !rateLimitHit && !budgetGuardTriggered) {
    await base44.entities.Campaign.update(campaignId, { progressPct: Math.min(95, Math.round((created / target) * 95)), countProspects: created });
    const broadFallbacks = buildBroadFallbacks(campaign, loc);
    for (const q of broadFallbacks) {
      if (created >= target || budgetGuardTriggered) break;
      await runQuery(q, 2);
    }
  }

  // ── Phase KB_TOPUP ──────────────────────────────────────────────────────────
  let kbTopupAdded = 0, kbTopupSkippedDuplicate = 0, kbTopupCandidates = 0, kbTopupStoppedReason = null;

  const webStopReason = created >= target          ? "TARGET_REACHED"
    : budgetGuardTriggered                         ? "BUDGET_GUARD"
    : rateLimitHit                                 ? "RATE_LIMIT"
    : queryIndex >= allQueries.length              ? "QUERIES_EXHAUSTED"
    : "ERROR";

  if (ENABLE_KB_TOPUP && created < target && ["QUERIES_EXHAUSTED", "RATE_LIMIT", "BUDGET_GUARD"].includes(webStopReason)) {
    await base44.entities.Campaign.update(campaignId, { progressPct: 90, countProspects: created });
    const locLower = loc.toLowerCase();

    const candidates = allKbEntities.filter(e => {
      const domNorm = (e.domain || "").toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) return false;
      if (!e.domain || !e.website) return false;
      if (locLower && e.hqLocation) {
        const locE = e.hqLocation.toLowerCase();
        if (!locE.includes("canada") && !locE.includes("ca") && !locE.includes(locLower.split(",")[0].trim())) return false;
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
        ownerUserId: campaign.ownerUserId,
        companyName: kb.name,
        website: kb.website || `https://${kb.domain}`,
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
    if (!kbTopupStoppedReason) kbTopupStoppedReason = created >= target ? "TARGET_REACHED" : "KB_EXHAUSTED";
  }

  // ── Final status ────────────────────────────────────────────────────────────
  let stopReason;
  if (created >= target)                                          stopReason = "TARGET_REACHED";
  else if (kbTopupAdded > 0 && kbTopupStoppedReason === "KB_EXHAUSTED") stopReason = "KB_EXHAUSTED";
  else if (budgetGuardTriggered)                                  stopReason = "BUDGET_GUARD";
  else if (rateLimitHit)                                          stopReason = "RATE_LIMIT";
  else if (queryIndex >= allQueries.length)                       stopReason = "QUERIES_EXHAUSTED";
  else                                                            stopReason = "ERROR";

  let finalStatus, errorMsg;
  if (created === 0) {
    finalStatus = "FAILED";
    errorMsg = stopReason === "RATE_LIMIT" ? "Limite de l'API Brave atteinte. Réessayez dans quelques minutes."
      : stopReason === "BUDGET_GUARD"      ? `Limite de requêtes Brave atteinte (${BRAVE_MAX_REQUESTS} req max).`
      : "Aucun prospect valide trouvé — vérifiez les clés API Brave/SerpAPI";
  } else if (created < target) {
    finalStatus = "DONE_PARTIAL";
    const kbNote = kbTopupAdded > 0 ? ` + ${kbTopupAdded} via KB` : "";
    if      (stopReason === "KB_EXHAUSTED")  errorMsg = `Web + KB épuisés: ${created}/${target} prospects (${createdWeb} web${kbNote}).`;
    else if (stopReason === "BUDGET_GUARD")  errorMsg = `Limite Brave: ${createdWeb} web${kbNote} / ${target}. (${braveRequestsUsed}/${BRAVE_MAX_REQUESTS} req)`;
    else if (stopReason === "RATE_LIMIT")    errorMsg = `Limite API: ${createdWeb} web${kbNote} / ${target}. Relancez dans quelques minutes.`;
    else                                     errorMsg = `Terminé: ${createdWeb} web${kbNote} / ${target} prospects.${skippedDupe > 0 ? ` ${skippedDupe} doublons ignorés.` : ""}`;
  } else {
    finalStatus = "COMPLETED";
  }

  const toolUsage = {
    queries: totalQueriesRun, skippedDuplicates: skippedDupe, filteredNonOrgCount,
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
      skippedDuplicates: skippedDupe, queriesRun: totalQueriesRun,
      braveRequestsUsed, braveMaxRequests: BRAVE_MAX_REQUESTS,
      brave429Count: braveRLState.count429, stopReason, webStopReason,
    },
    status: created > 0 ? "SUCCESS" : "ERROR",
    errorMessage: errorMsg,
  });

  return Response.json({ success: created > 0, created, target, coverage: Math.round(created / target * 100), skippedDuplicates: skippedDupe, stopReason });
});