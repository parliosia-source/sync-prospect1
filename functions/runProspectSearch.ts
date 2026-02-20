import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY   = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

// ── Helpers ────────────────────────────────────────────────────────────────────
function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

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
  "inc.com","crunchbase.com","clutch.co","themanifest.com","goodfirms.co","sortlist.com","g2.com","capterra.com",
]);

const BLOCKED_URL_PATHS = /\/blog\/|\/news\/|\/press\/|\/article\/|\/articles\/|\/actualite\/|\/actualites\/|\/magazine\/|\/careers\/|\/carrieres\/|\/jobs\/|\/emplois\/|\/offres-emploi\/|\/salle-de-presse\/|\/communique\/|\/communiques\/|\/medias\/|\/presse\/|\/evenement\/|\/evenements\/|\/events\/|\/event\/|\/agenda\/|\/programme\/|\/inscription\/|\/register\/|\/actualite|\/nouvelles\/|\.pdf$/i;

// ── Anti-bruit strengthened ────────────────────────────────────────────────────
const ANTI_BRUIT = {
  article: /\b(article|blog|news|press release|communiqué|actualit[eé]|magazine|guide complet|comment |pourquoi |top \d+|liste de|idées de|trending|répertoire|annuaire|directory|listing|database)\b/i,
  calendar: /\b(calendar|agenda|événement|event|programme|program|inscription|register|archive|événements|show|salon|expo|exposition|summit|congr[eè]s|conference|forum|webinar)\b/i,
  venue: /\b(centre de congrès|palais des congrès|meeting room|salle|venue|location|espace|réception|banquet|hôtel|hotel|resort|airbnb|hospitality)\b/i,
  agency: /\b(agence événementielle|event planner|organisateur|event management|event agency|party planner|wedding|mariage|planificateur|event organizer)\b/i,
  directory: /\b(répertoire|annuaire|directory|listing|pages jaunes|yellow pages|fournisseur|supplier|catalog|catalogue)\b/i,
  media: /\b(journal|newspaper|gazette|radio|tv|television|chaîne|channel|presse|medias|honoree|award|awards|ranking|classement|palmar[eè]s)\b/i,
};

function shouldRejectByNoise(url, title, snippet) {
  const fullText = `${url} ${title} ${snippet}`.toLowerCase();
  return Object.values(ANTI_BRUIT).some(regex => regex.test(fullText));
}

// ── Sector keywords (expanded) ─────────────────────────────────────────────────
const SECTOR_KEYWORDS = {
  "Technologie": ["technologie","technology","tech","logiciel","software","saas","numérique","numerique","informatique","it","cloud","cybersecurity","cybersécurité","data","ai","intelligence artificielle","application","développement","developer","web"],
  "Finance & Assurance": ["assurance","finance","banque","loan","investment","wealth","insurance","fintech","crypto","immobilier"],
  "Santé & Pharma": ["santé","health","pharma","medical","pharmacy","clinic","hospital","thérapie","médecin"],
  "Gouvernement & Public": ["gouvernement","municipality","government","admin","public","state","fédéral"],
  "Éducation & Formation": ["école","université","formation","training","education","learning","académie","collège"],
  "Associations & OBNL": ["association","obnl","non-profit","charity","organisme","fondation"],
  "Immobilier": ["immobilier","réaltor","developer","property","real estate","construction"],
  "Droit & Comptabilité": ["cabinet","attorney","lawyer","comptable","accounting","law","notaire"],
  "Industrie & Manufacture": ["manufacture","factory","industrial","usine","production","équipement"],
  "Commerce de détail": ["retail","magasin","commerce","boutique","store","distribution"],
  "Transport & Logistique": ["transport","logistique","shipping","freight","courier","livraison"],
};

function inferSectorsFromKb(kb) {
  const text = normText(`${kb.name || ""} ${kb.notes || ""} ${(kb.tags || []).join(" ")}`);
  const matched = [];
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      matched.push(sector);
    }
  }
  return matched;
}

// ── Search APIs ────────────────────────────────────────────────────────────────
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

async function braveSearch(query, count = 20, offset = 0, retries = 3) {
  if (braveRLState.remaining === 0 && braveRLState.reset > 0) await waitForBraveReset();
  
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      parseBraveHeaders(res);
      
      if (res.status === 429) {
        braveRLState.count429++;
        if (attempt < retries - 1) { await waitForBraveReset(Math.pow(2, attempt) * 1000); continue; }
        return { results: [], rateLimited: true };
      }
      if (!res.ok) return { results: [], rateLimited: false };
      if (braveRLState.remaining === 0) await waitForBraveReset();
      
      const data = await res.json();
      return { results: data.web?.results || [], rateLimited: false };
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === "AbortError") return { results: [], rateLimited: true };
      return { results: [], rateLimited: false };
    }
  }
  clearTimeout(timeout);
  return { results: [], rateLimited: true };
}

// ── Normalization ──────────────────────────────────────────────────────────────
async function normalizeResult(r, requiredSectors) {
  try {
    const url = r.url || "";
    const title = r.title || "";
    const snippet = r.snippet || "";

    if (BLOCKED_URL_PATHS.test(url)) return { isValid: false };
    const domain = getRegistrableDomain(new URL(url).hostname);
    if (BLOCKED_DOMAINS.has(domain)) return { isValid: false };

    // Match sectors from fullText (title + snippet + url + domain)
    const fullText = `${title} ${snippet} ${url} ${domain}`.toLowerCase();
    let sectorMatch = false;
    let matchedSectors = [];

    if (requiredSectors.length > 0) {
      for (const sector of requiredSectors) {
        const keywords = SECTOR_KEYWORDS[sector] || [];
        if (keywords.some(kw => fullText.includes(kw))) {
          sectorMatch = true;
          matchedSectors.push(sector);
        }
      }
    } else {
      sectorMatch = true;
    }

    const nameMatch = title.match(/^([A-ZÀ-ÿ][a-zà-ÿ\s\-'\.&()]{2,60}?)(?:\s*[-–|]|$)/);
    const companyName = nameMatch ? nameMatch[1].trim() : (title.split("|")[0] || title).slice(0, 100).trim();

    return {
      isValid: true,
      sectorMatch,
      companyName,
      website: url,
      domain,
      industry: matchedSectors[0] || null,
      matchedSectors,
      locationText: null,
    };
  } catch (_) {
    return { isValid: false };
  }
}

// ── Query builders ────────────────────────────────────────────────────────────
const EXCL = '-site:linkedin.com -site:facebook.com -site:glassdoor.com -site:indeed.com -site:eventbrite.com -site:wikipedia.org -filetype:pdf';

function buildQueryVariants(campaign, loc) {
  const sectors = (campaign.industrySectors || []).slice(0, 3);
  const sectorsFR = sectors.map(s => `"${s}"`).join(" ");
  const kws = (campaign.keywords || []).join(" ");
  const locQ = loc.split(",")[0].trim();
  const locAll = [locQ, `"${locQ}"`, loc].filter(Boolean);

  const queries = [];

  // A — DIRECT COMPANIES/ORGS
  const companyTermsFR = ["entreprises", "sociétés", "compagnies", "organisations", "cabinet", "firmes", "manufacturier"];
  const companyTermsEN = ["companies", "firms", "manufacturers", "organizations"];

  for (const l of locAll) {
    for (const term of companyTermsFR) {
      queries.push(`${term} ${sectorsFR} ${l} ${kws} ${EXCL}`);
      if (sectors.length === 1) queries.push(`${term} ${sectors[0]} ${l} ${EXCL}`);
    }
    for (const term of companyTermsEN) {
      queries.push(`${term} ${sectorsFR} ${l} ${kws} ${EXCL}`);
      if (sectors.length === 1) queries.push(`${term} ${sectors[0]} ${l} ${EXCL}`);
    }
  }

  // B — INDUSTRY CLUSTERS
  for (const l of locAll) {
    queries.push(`grappe ${sectorsFR} ${l} ${EXCL}`);
    queries.push(`ecosystem ${sectorsFR} ${l} ${EXCL}`);
    queries.push(`cluster ${sectorsFR} ${l} ${EXCL}`);
    if (sectors.length === 1) queries.push(`${sectors[0]} entreprises ${l} ${EXCL}`);
  }

  // C — ASSOCIATIONS
  for (const l of locAll) {
    queries.push(`association ${sectorsFR} ${l} membres ${EXCL}`);
    queries.push(`${sectorsFR} association ${l} members ${EXCL}`);
    queries.push(`${sectorsFR} chamber ${l} members ${EXCL}`);
    if (sectors.length === 1) {
      queries.push(`association ${sectors[0]} ${l} membres ${EXCL}`);
      queries.push(`chamber ${sectors[0]} Quebec members ${EXCL}`);
    }
  }

  return [...new Set(queries)].filter(q => q.length > 5);
}

// ── Main Handler ───────────────────────────────────────────────────────────────
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
  const MAX_DURATION_MS = 90 * 1000;
  const APP_SETTINGS = (await base44.entities.AppSettings.filter({ settingsId: "global" }) || [{}])[0] || {};
  const KB_ENABLED = APP_SETTINGS.enableKbTopUp !== false;

  let progressPct = 0;
  let errorMessage = null;
  let suggestedNextStep = null;
  let stopReason = null;
  let webAccepted = 0;
  let kbAccepted = 0;
  let braveRequestsUsed = 0;

  const locQuery = campaign.locationQuery || "Montréal, QC";
  const requiredSectors = campaign.industrySectors || [];
  const targetCount = campaign.targetCount || 50;

  // ════════════════════════════════════════════════════════════════════════════
  // B1) Load existing prospects (dedup)
  // ════════════════════════════════════════════════════════════════════════════
  const existingProspects = await base44.entities.Prospect.filter({ campaignId }, "-created_date", 2000).catch(() => []);
  const existingDomains = new Set(existingProspects.map(p => (p.domain || "").replace(/^www\./, "").toLowerCase()));
  let prospectCount = existingProspects.length;

  console.log(`[START] campaignId=${campaignId}, target=${targetCount}, existing=${prospectCount}, requiredSectors=${requiredSectors.join(",")}`);

  // If already at target, finalize
  if (prospectCount >= targetCount) {
    const finalProspects = await base44.entities.Prospect.filter({ campaignId });
    await base44.entities.Campaign.update(campaignId, {
      status: "DONE",
      progressPct: 100,
      countProspects: finalProspects.length,
      countAnalyzed: finalProspects.filter(p => ["ANALYSÉ","QUALIFIÉ","REJETÉ","EXPORTÉ"].includes(p.status)).length,
      countQualified: finalProspects.filter(p => p.status === "QUALIFIÉ").length,
      countRejected: finalProspects.filter(p => p.status === "REJETÉ").length,
    });
    return Response.json({ success: true, campaignId, prospectCount, status: "DONE", skipReason: "ALREADY_AT_TARGET" });
  }

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 1: KB_FILL
    // ════════════════════════════════════════════════════════════════════════════
    console.log(`[KB_FILL] START`);

    // B2) Extended KB query (2000 instead of 500)
    const kbAll = await base44.entities.KBEntity.filter({}, "-updated_date", 2000).catch(async () => {
      // Fallback to list if filter fails
      return await base44.entities.KBEntity.list("-updated_date", 2000).catch(() => []);
    });
    console.log(`[KB_FILL] candidates_total=${kbAll.length}`);

    // B3) Location matching (Quebec/Montréal robust)
    const locNorm = normText(locQuery);
    const wantQC = /\b(qc|quebec)\b/.test(locNorm);
    const cityNorm = normText(locQuery.split(",")[0]);

    const kbCandidates = kbAll
      .filter(e => {
        if (existingDomains.has((e.domain || "").toLowerCase())) return false;
        if (!e.domain || !e.website || !e.name) return false;
        
        const eLoc = normText(e.hqLocation || "");
        if (wantQC) {
          if (!(eLoc.includes("qc") || eLoc.includes("quebec") || eLoc.includes(cityNorm))) return false;
        } else if (cityNorm && !eLoc.includes(cityNorm)) {
          return false;
        }
        return true;
      })
      .sort(() => Math.random() - 0.5);

    console.log(`[KB_FILL] candidates_filtered=${kbCandidates.length}`);

    for (const kb of kbCandidates) {
      if (Date.now() - START_TIME > MAX_DURATION_MS) { stopReason = "TIME_BUDGET"; break; }
      if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }

      const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) continue;

      // B4) KB sector strict: infer if empty
      const rawKbSectors = Array.isArray(kb.industrySectors) ? kb.industrySectors : [];
      const kbSectors = rawKbSectors.length > 0 ? rawKbSectors : inferSectorsFromKb(kb);

      let matchedSectors = [];
      if (requiredSectors.length > 0) {
        const match = kbSectors.some(s => requiredSectors.includes(s));
        if (!match) {
          console.log(`[KB_FILL] REJECT sector: ${kb.name}`);
          continue;
        }
        matchedSectors = kbSectors.filter(s => requiredSectors.includes(s));
      } else {
        matchedSectors = kbSectors;
      }

      // Create prospect
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
      kbAccepted++;
      prospectCount++;

      // B8) Progress updates every 5
      if (kbAccepted % 5 === 0) {
        progressPct = Math.min(45, Math.round((kbAccepted / Math.max(10, targetCount)) * 45));
        console.log(`[KB_FILL] ACCEPT #${kbAccepted}, total=${prospectCount}, progress=${progressPct}%`);
        await base44.entities.Campaign.update(campaignId, {
          progressPct,
          countProspects: prospectCount,
          toolUsage: { kbAccepted, webAccepted, braveRequestsUsed },
        });
      }
    }

    console.log(`[KB_FILL] END: accepted=${kbAccepted}, total=${prospectCount}, stopReason=${stopReason}`);

    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 2: WEB_FILL (fallback)
    // ════════════════════════════════════════════════════════════════════════════
    const kbCoveragePercent = prospectCount > 0 ? Math.round((kbAccepted / targetCount) * 100) : 0;
    
    // B5) Adaptive Brave budget
    const remaining = targetCount - prospectCount;
    const BRAVE_MAX_REQUESTS = kbCoveragePercent >= 70 ? 30 : Math.min(250, Math.max(120, remaining * 2));
    const needsWebFill = prospectCount < targetCount && !stopReason;

    if (needsWebFill) {
      console.log(`[WEB_FILL] START: kbCoverage=${kbCoveragePercent}%, maxBraveRequests=${BRAVE_MAX_REQUESTS}, remaining=${remaining}`);

      const queriesRaw = buildQueryVariants(campaign, locQuery);
      const BRAVE_MAX_PAGES_PER_QUERY = 6;

      for (const query of queriesRaw) {
        if (Date.now() - START_TIME > MAX_DURATION_MS) { stopReason = "TIME_BUDGET"; break; }
        if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
        if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) { stopReason = "BUDGET_GUARD"; break; }

        const elapsed = Date.now() - START_TIME;
        const maxPages = elapsed > 60000 ? 3 : BRAVE_MAX_PAGES_PER_QUERY;

        for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
          if (Date.now() - START_TIME > MAX_DURATION_MS) { stopReason = "TIME_BUDGET"; break; }
          if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
          if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) { stopReason = "BUDGET_GUARD"; break; }

          const offset = pageIdx * 20;
          const { results, rateLimited } = await braveSearch(query, 20, offset); // B5) count=20
          braveRequestsUsed++;

          if (rateLimited) { stopReason = "BRAVE_RATE_LIMITED"; break; }
          if (results.length === 0) break;

          for (const r of results) {
            if (prospectCount >= targetCount) break;
            const noise = shouldRejectByNoise(r.url, r.title, r.snippet);
            if (noise) continue;

            const normalized = await normalizeResult(r, requiredSectors);
            if (!normalized.isValid || !normalized.sectorMatch) continue;

            const domNorm = normalized.domain.toLowerCase();
            if (existingDomains.has(domNorm)) continue;
            if (/\b(events|blog|news|press)\../.test(domNorm)) continue;

            // Create prospect
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
            webAccepted++;
            prospectCount++;
          }

          // B8) Progress updates every 10 web accepted
          if (webAccepted % 10 === 0 || (prospectCount % 5 === 0 && webAccepted > 0)) {
            progressPct = Math.min(85, 45 + Math.round((webAccepted / Math.max(10, remaining)) * 40));
            await base44.entities.Campaign.update(campaignId, {
              progressPct,
              countProspects: prospectCount,
              toolUsage: { kbAccepted, webAccepted, braveRequestsUsed },
            });
          }
        }
        if (stopReason) break;
      }

      console.log(`[WEB_FILL] END: accepted=${webAccepted}, total=${prospectCount}, stopReason=${stopReason}`);
    } else {
      console.log(`[WEB_FILL] SKIPPED`);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // FINALIZE
    // ════════════════════════════════════════════════════════════════════════════
    const finalProspects = await base44.entities.Prospect.filter({ campaignId });
    let finalStatus;

    if (prospectCount >= targetCount) {
      finalStatus = "DONE";
      console.log(`[FINAL] SUCCESS`);
    } else if (prospectCount > 0) {
      finalStatus = "DONE_PARTIAL";
      if (requiredSectors.length > 0) suggestedNextStep = "RELAX_FILTERS";
      errorMessage = "Résultats insuffisants. Relâchez les filtres ou élargissez la géographie.";
      console.log(`[FINAL] PARTIAL: found=${prospectCount}, target=${targetCount}`);
    } else {
      finalStatus = "FAILED";
      errorMessage = "Aucun prospect trouvé. Vérifiez vos critères de recherche.";
      console.log(`[FINAL] FAILED`);
    }

    console.log(`[FINAL] kbAccepted=${kbAccepted}, webAccepted=${webAccepted}, total=${prospectCount}/${targetCount}, status=${finalStatus}`);

    await base44.entities.Campaign.update(campaignId, {
      status: finalStatus,
      progressPct: 100,
      countProspects: finalProspects.length,
      countAnalyzed: finalProspects.filter(p => ["ANALYSÉ","QUALIFIÉ","REJETÉ","EXPORTÉ"].includes(p.status)).length,
      countQualified: finalProspects.filter(p => p.status === "QUALIFIÉ").length,
      countRejected: finalProspects.filter(p => p.status === "REJETÉ").length,
      errorMessage,
      toolUsage: {
        kbAccepted,
        webAccepted,
        braveRequestsUsed,
        brave429Count: braveRLState.count429,
        stopReason,
        suggestedNextStep,
      },
    });

    await base44.entities.ActivityLog.create({
      ownerUserId: campaign.ownerUserId,
      actionType: "RUN_PROSPECT_SEARCH",
      entityType: "Campaign",
      entityId: campaignId,
      payload: {
        kbAccepted,
        webAccepted,
        total: prospectCount,
        target: targetCount,
        stopReason,
      },
      status: finalStatus === "FAILED" ? "ERROR" : "SUCCESS",
      errorMessage: finalStatus === "FAILED" ? errorMessage : null,
    });

    return Response.json({
      success: true,
      campaignId,
      prospectCount,
      kbAccepted,
      webAccepted,
      status: finalStatus,
      stopReason,
    });

  } catch (error) {
    console.error("[ERROR]", error.message);
    const errorMsg = error.message || "Erreur lors de la recherche";
    
    await base44.entities.Campaign.update(campaignId, {
      status: "FAILED",
      errorMessage: errorMsg,
      progressPct: 0,
    });

    return Response.json({ error: errorMsg, status: "FAILED" }, { status: 500 });
  }
});