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

  return [...new Set(queries)].filter(q => q.length > 5);
}

// ── Main Handler ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { campaignId } = body;
  if (!campaignId) return Response.json({ error: "campaignId required" }, { status: 400 });

  const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const START_TIME = Date.now();
  const MAX_DURATION_MS = 25 * 60 * 1000; // 25 min
  const APP_SETTINGS = (await base44.entities.AppSettings.filter({ settingsId: "global" }) || [{}])[0] || {};
  const BRAVE_MAX_REQUESTS = APP_SETTINGS.braveMaxRequestsPerCampaign || 250;
  const KB_TOPUP_ENABLED = APP_SETTINGS.enableKbTopUp !== false;

  let prospectCount = 0;
  let progressPct = 0;
  let errorMessage = null;
  let stopped = false;
  let stopReason = null;
  let webQueryCount = 0;
  let braveRequestsUsed = 0;
  let kbTopupAdded = 0;
  let freshnessChecksDone = 0;

  try {
    // Phase A: Web Search
    const existingDomains = new Set();
    const locQuery = campaign.locationQuery || "Montréal, QC";
    const requiredSectors = campaign.industrySectors || [];
    const queriesRaw = buildQueryVariants(campaign, locQuery);
    const targetCount = campaign.targetCount || 50;
    let offsets = [0, 10];

    await base44.entities.Campaign.update(campaignId, {
      status: "RUNNING",
      progressPct: 5,
      errorMessage: null,
      lastRunAt: new Date().toISOString(),
      toolUsage: {
        braveRequestsUsed: 0,
        braveMaxRequests: BRAVE_MAX_REQUESTS,
        brave429Count: 0,
        freshnessChecksDone: 0,
        webSearchQueryCount: 0,
        kbTopupAdded: 0,
      },
    });

    // Execute web queries
    for (const query of queriesRaw) {
      if (Date.now() - START_TIME > MAX_DURATION_MS) { stopped = true; stopReason = "TIME_BUDGET"; break; }
      if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
      if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) { stopReason = "BUDGET_GUARD"; break; }

      for (const offset of offsets) {
        if (Date.now() - START_TIME > MAX_DURATION_MS) { stopped = true; stopReason = "TIME_BUDGET"; break; }
        if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
        if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) { stopReason = "BUDGET_GUARD"; break; }

        const { results, rateLimited } = await braveSearch(query, 10, offset);
        braveRequestsUsed++;

        if (rateLimited) { stopReason = "BRAVE_RATE_LIMITED"; break; }

        for (const r of results) {
          if (prospectCount >= targetCount) break;
          const noise = shouldRejectByNoise(r.url, r.title, r.snippet);
          if (noise) continue;

          const normalized = await normalizeResult(r, requiredSectors);
          if (!normalized.isValid || !normalized.sectorMatch) continue;

          const domNorm = normalized.domain.toLowerCase();
          if (existingDomains.has(domNorm)) continue;

          // Save prospect
          await base44.entities.Prospect.create({
            campaignId,
            ownerUserId: campaign.ownerUserId,
            companyName: normalized.companyName,
            website: normalized.website,
            domain: domNorm,
            industry: normalized.industry,
            industrySectors: normalized.matchedSectors,
            industryLabel: normalized.matchedSectors[0] || null,
            location: normalized.locationText ? { city: normalized.locationText, country: "CA" } : { country: "CA" },
            entityType: "COMPANY",
            status: "NOUVEAU",
            sourceOrigin: "WEB",
            serpSnippet: r.snippet || "",
            sourceUrl: r.url,
          });

          existingDomains.add(domNorm);
          prospectCount++;
          webQueryCount++;
        }

        progressPct = Math.min(87, Math.round((prospectCount / targetCount) * 85) + 2);
        await base44.entities.Campaign.update(campaignId, {
          progressPct,
          countProspects: prospectCount,
          toolUsage: {
            braveRequestsUsed,
            braveMaxRequests: BRAVE_MAX_REQUESTS,
            brave429Count: braveRLState.count429,
            freshnessChecksDone,
            webSearchQueryCount: webQueryCount,
            kbTopupAdded,
          },
        });
      }

      if (stopped || stopReason) break;
    }

    // Phase B: KB Top-up
    if (KB_TOPUP_ENABLED && prospectCount < targetCount && !stopped) {
      progressPct = 90;
      await base44.entities.Campaign.update(campaignId, { progressPct });

      const kbAll = await base44.entities.KBEntity.list("-updated_date", 500);
      const locCity = locQuery.split(",")[0].toLowerCase();
      const hasRequiredSectors = requiredSectors.length > 0;

      const candidates = kbAll.filter(e => {
        if (existingDomains.has((e.domain || "").toLowerCase())) return false;
        if (!e.domain || !e.website) return false;
        if (locCity && e.hqLocation) {
          const locE = e.hqLocation.toLowerCase();
          if (!locE.includes("canada") && !locE.includes(locCity)) return false;
        }
        return true;
      });

      for (const kb of candidates) {
        if (Date.now() - START_TIME > MAX_DURATION_MS) { stopped = true; stopReason = "TIME_BUDGET"; break; }
        if (kbTopupAdded >= (targetCount - prospectCount)) { stopReason = "TARGET_REACHED"; break; }

        const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
        if (existingDomains.has(domNorm)) continue;

        // ============================================
        // STRICT SECTOR MATCHING using industrySectors
        // ============================================
        let matchedSectors = [];
        const kbSectors = Array.isArray(kb.industrySectors) ? kb.industrySectors : [];
        const required = campaign.industrySectors || [];

        if (required.length > 0) {
          const match = kbSectors.some(s => required.includes(s));
          if (!match) {
            continue; // REJECT: no match
          }
          matchedSectors = kbSectors.filter(s => required.includes(s));
        } else {
          matchedSectors = kbSectors.length > 0 ? kbSectors : [];
        }
        // ============================================

        await base44.entities.Prospect.create({
          campaignId,
          ownerUserId: campaign.ownerUserId,
          companyName: kb.name,
          website: kb.website || `https://${kb.domain}`,
          domain: domNorm,
          industry: kb.entityType || null,
          industrySectors: matchedSectors,
          industryLabel: matchedSectors[0] || null,
          location: kb.hqLocation ? { city: kb.hqLocation, country: "CA" } : { country: "CA" },
          entityType: kb.entityType || "COMPANY",
          status: "NOUVEAU",
          sourceOrigin: "KB_TOPUP",
          kbEntityId: kb.id,
          serpSnippet: kb.notes || "",
          sourceUrl: kb.source || "",
        });

        existingDomains.add(domNorm);
        kbTopupAdded++;
        prospectCount++;

        if (kbTopupAdded % 5 === 0) {
          progressPct = Math.min(98, 90 + Math.round((kbTopupAdded / Math.max(10, candidates.length)) * 8));
          await base44.entities.Campaign.update(campaignId, {
            progressPct,
            countProspects: prospectCount,
            toolUsage: {
              braveRequestsUsed,
              braveMaxRequests: BRAVE_MAX_REQUESTS,
              brave429Count: braveRLState.count429,
              freshnessChecksDone,
              webSearchQueryCount: webQueryCount,
              kbTopupAdded,
            },
          });
        }
      }
    }

    // Final status
    const finalProspects = await base44.entities.Prospect.filter({ campaignId });
    const finalStatus = (prospectCount >= targetCount) ? "COMPLETED" : "DONE_PARTIAL";

    errorMessage = stopReason === "BUDGET_GUARD"
      ? `Budget Brave atteint (${braveRequestsUsed}/${BRAVE_MAX_REQUESTS}). ${prospectCount} prospects trouvés.`
      : stopReason === "QUERIES_EXHAUSTED"
      ? `Requêtes épuisées. ${prospectCount} prospects trouvés.`
      : null;

    await base44.entities.Campaign.update(campaignId, {
      status: finalStatus,
      progressPct: 100,
      countProspects: finalProspects.length,
      countAnalyzed: finalProspects.filter(p => ["ANALYSÉ","QUALIFIÉ","REJETÉ","EXPORTÉ"].includes(p.status)).length,
      countQualified: finalProspects.filter(p => p.status === "QUALIFIÉ").length,
      countRejected: finalProspects.filter(p => p.status === "REJETÉ").length,
      errorMessage,
      toolUsage: {
        braveRequestsUsed,
        braveMaxRequests: BRAVE_MAX_REQUESTS,
        brave429Count: braveRLState.count429,
        freshnessChecksDone,
        webSearchQueryCount: webQueryCount,
        kbTopupAdded,
        stopReason: stopReason || "COMPLETED",
      },
    });

    await base44.entities.ActivityLog.create({
      ownerUserId: user.email,
      actionType: "RUN_PROSPECT_SEARCH",
      entityType: "Campaign",
      entityId: campaignId,
      payload: {
        prospectCount,
        webQueryCount,
        braveRequestsUsed,
        kbTopupAdded,
        durationMs: Date.now() - START_TIME,
        stopReason: stopReason || "COMPLETED",
      },
      status: "SUCCESS",
    });

    return Response.json({
      success: true,
      prospectCount,
      webQueryCount,
      braveRequestsUsed,
      kbTopupAdded,
      status: finalStatus,
      stopReason: stopReason || "COMPLETED",
    });
  } catch (error) {
    const msg = error?.message || "Unknown error";
    console.error("Search error:", msg);
    await base44.entities.Campaign.update(campaignId, {
      status: "FAILED",
      errorMessage: msg.slice(0, 500),
      progressPct,
    });
    return Response.json({ error: msg }, { status: 500 });
  }
});