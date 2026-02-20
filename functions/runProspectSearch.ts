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

const BLOCKED_URL_PATHS = /\/blog\/|\/news\/|\/press\/|\/article\/|\/articles\/|\/actualite\/|\/actualites\/|\/magazine\/|\/careers\/|\/carrieres\/|\/jobs\/|\/emplois\/|\/offres-emploi\/|\/salle-de-presse\/|\/communique\/|\/communiques\/|\/medias\/|\/presse\/|\/evenement\/|\/evenements\/|\/events\/|\/event\/|\/agenda\/|\/programme\/|\/inscription\/|\/register\/|\/actualite|\/nouvelles\/|\/directory\/|\/rankings\/|\.pdf$/i;

// ── Hard exclude domains (pre-LLM filtering) ────────────────────────────────────
const HARD_EXCLUDE_DOMAINS = /^(glassdoor|chambers|canada|gc|bankofcanada|medium|.*\.gov|.*\.gouv|chambers)/i;

// ── Hard exclude title patterns (pre-LLM filtering) ──────────────────────────────
const HARD_EXCLUDE_TITLE = /\b(top|best|directory|map|mapping|ranking|rank|list|how to|guide|guide complet|news|blog|press|press release|pdf|directory|listem|companies list|database|annuaire|repertoire)\b/i;

// ── Anti-bruit strengthened ────────────────────────────────────────────────────
const ANTI_BRUIT = {
  article: /\b(article|blog|news|press release|communiqué|actualit[eé]|magazine|guide complet|comment |pourquoi |top \d+|liste de|idées de|trending|répertoire|annuaire|directory|listing|database)\b/i,
  calendar: /\b(calendar|agenda|événement|event|programme|program|inscription|register|archive|événements|show|salon|expo|exposition|summit|congr[eè]s|conference|forum|webinar)\b/i,
  venue: /\b(centre de congrès|palais des congrès|meeting room|salle|venue|location|espace|réception|banquet|hôtel|hotel|resort|airbnb|hospitality)\b/i,
  agency: /\b(agence événementielle|event planner|organisateur|event management|event agency|party planner|wedding|mariage|planificateur|event organizer)\b/i,
  directory: /\b(répertoire|annuaire|directory|listing|pages jaunes|yellow pages|fournisseur|supplier|catalog|catalogue)\b/i,
  media: /\b(journal|newspaper|gazette|radio|tv|television|chaîne|channel|presse|medias|honoree|award|awards|ranking|classement|palmar[eè]s)\b/i,
  public: /\b(ville|city|municipalité|municipality|gouvernement|government|fondation|foundation|université|university|cegep|collège|chamber|chambre|ordre|order|cisss|chu|hospital)\b/i,
};

// ── Strict sector entity filters ────────────────────────────────────────────────
const ENTITY_TYPE_RESTRICTIONS = {
  "Technologie": {
    allow: ["COMPANY", "STARTUP"],
    allowIfMatches: { "ASSOCIATION": /\b(technologie|tech|software|informatique)\b/i },
  },
  "Finance & Assurance": {
    allow: ["COMPANY", "STARTUP", "ASSOCIATION"],
    rejectAlways: ["UNIVERSITY", "FOUNDATION", "PUBLIC_ORG", "CHAMBER"],
  },
  "Santé & Pharma": {
    allow: ["COMPANY", "STARTUP", "HOSPITAL", "CLINIC"],
    rejectAlways: ["UNIVERSITY", "FOUNDATION", "CHAMBER"],
  },
  "Gouvernement & Public": {
    allow: ["PUBLIC_ORG", "GOVERNMENT", "MUNICIPALITY", "AGENCY"],
  },
  "Éducation & Formation": {
    allow: ["UNIVERSITY", "EDUCATION", "TRAINING_CENTER", "CEGEP"],
  },
  "Associations & OBNL": {
    allow: ["ASSOCIATION", "FOUNDATION", "NONPROFIT"],
  },
};

function isEntityTypeAllowed(entityType, sector, name) {
  if (!sector) return true;
  const restriction = ENTITY_TYPE_RESTRICTIONS[sector];
  if (!restriction) return true;
  
  if (restriction.rejectAlways && restriction.rejectAlways.includes(entityType)) return false;
  if (restriction.allow && !restriction.allow.includes(entityType)) {
    if (restriction.allowIfMatches && restriction.allowIfMatches[entityType]) {
      return restriction.allowIfMatches[entityType].test(name || "");
    }
    return false;
  }
  return true;
}

function shouldRejectByNoise(url, title, snippet) {
  const fullText = `${url} ${title} ${snippet}`.toLowerCase();
  return Object.values(ANTI_BRUIT).some(regex => regex.test(fullText));
}

// ── SECTOR_RULES: Strict include/exclude for all sectors ──────────────────────
const SECTOR_RULES = {
  "Technologie": {
    include: ["software", "tech", "informatique", "données", "data", "ai", "ia", "cloud", "cybersecurity", "cybersécurité", "logiciel", "digital", "saas", "application", "développement", "development", "it", "startup tech", "plateforme", "platform", "système", "system", "infrastructure", "programmation", "coding", "javascript", "python", "java", "devops", "database"],
    exclude: ["agence", "agency", "cours en ligne", "online course", "formation", "training", "webinaire", "webinar", "annuaire", "directory", "listing", "université", "university", "collège", "college", "école", "school", "blog", "article", "news"]
  },
  "Finance & Assurance": {
    include: ["finance", "assurance", "banque", "bank", "investment", "crédit", "loan", "fintech", "insurance", "courtage", "brokerage", "capital", "investissement", "fonds", "fund", "obligataire", "bond", "portefeuille", "portfolio", "risque", "risk", "actuaire", "actuary", "trésorier", "treasurer", "épargne", "savings"],
    exclude: ["université", "university", "formation", "training", "blog", "article", "news", "agence événementielle", "event agency", "annuaire", "directory"]
  },
  "Santé & Pharma": {
    include: ["santé", "health", "pharma", "médical", "medical", "clinic", "hospital", "hôpital", "pharmacie", "pharmacy", "dentiste", "dentist", "médecin", "physician", "infirmier", "nurse", "thérapie", "therapy", "diagnostic", "traitement", "treatment", "patient", "soins", "care", "ambulatoire", "outpatient", "laboratoire", "laboratory", "biopharmaceutique", "biopharmaceutical", "clinique"],
    exclude: ["université", "university", "formation", "training", "blog", "article", "news", "agence", "agency"]
  },
  "Gouvernement & Public": {
    include: ["gouvernement", "government", "municipal", "municipalité", "ministère", "ministry", "public", "agence", "agency", "collectivité", "community", "politique", "policy"],
    exclude: ["commercial", "profit", "privé", "private", "entreprise", "business", "compagnie", "company"]
  },
  "Éducation & Formation": {
    include: ["université", "university", "collège", "college", "formation", "training", "education", "école", "school", "cours", "course", "apprentissage", "learning", "cegep", "professeur", "professor", "étudiant", "student", "campus", "diplôme", "degree"],
    exclude: ["blog", "article", "news", "commercial", "business"]
  },
  "Associations & OBNL": {
    include: ["association", "obnl", "nonprofit", "non-profit", "fondation", "foundation", "organisme", "ong", "ngo", "caritative", "charitable", "bénévole", "volunteer", "mission", "cause", "social", "communautaire", "community"],
    exclude: ["commercial", "profit", "entreprise", "business", "blog", "article", "news"]
  },
  "Immobilier": {
    include: ["immobilier", "real estate", "propriété", "property", "construction", "bâtiment", "building", "promotion", "developer", "développeur", "logement", "housing", "bureau", "office", "terrain", "land", "hypothèque", "mortgage"],
    exclude: ["université", "university", "école", "school", "blog", "article", "news"]
  },
  "Droit & Comptabilité": {
    include: ["droit", "legal", "law", "comptabilité", "accounting", "notaire", "avocat", "lawyer", "fiscal", "tax", "audit", "compliance", "fiducie", "trust", "contrat", "contract", "juriste", "cabinet", "law firm"],
    exclude: ["université", "university", "blog", "article", "news"]
  },
  "Industrie & Manufacture": {
    include: ["manufacture", "usine", "factory", "production", "industriel", "industrial", "supply chain", "chaîne", "fournisseur", "supplier", "équipement", "equipment", "machinerie", "machinery", "assemblage", "assembly", "prototypage", "prototyping"],
    exclude: ["agence", "agency", "blog", "article", "news"]
  },
  "Commerce de détail": {
    include: ["retail", "commerce", "magasin", "store", "vente", "e-commerce", "boutique", "shop", "vendeur", "seller", "client", "customer", "point de vente", "pos", "merchandising", "inventory", "inventaire"],
    exclude: ["blog", "article", "news", "agence", "agency"]
  },
  "Transport & Logistique": {
    include: ["transport", "logistique", "logistics", "livraison", "delivery", "fret", "freight", "distribution", "expédition", "shipping", "chauffeur", "driver", "camion", "truck", "entrepôt", "warehouse", "terminal", "tracking"],
    exclude: ["agence", "agency", "blog", "article", "news"]
  }
};

function matchSectorsStrict(fullText, requiredSectors) {
  if (requiredSectors.length === 0) return [];
  
  const matched = [];
  for (const sector of requiredSectors) {
    const rules = SECTOR_RULES[sector];
    if (!rules) continue;
    
    const hasInclude = rules.include.some(kw => fullText.includes(kw));
    const hasExclude = rules.exclude.some(kw => fullText.includes(kw));
    
    if (hasInclude && !hasExclude) {
      matched.push(sector);
    }
  }
  return matched;
}

function inferSectorsFromKb(kb) {
  const text = normText(`${kb.name || ""} ${kb.notes || ""} ${(kb.tags || []).join(" ")}`);
  const matched = [];
  
  for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
    const hasInclude = rules.include.some(kw => text.includes(normText(kw)));
    const hasExclude = rules.exclude.some(kw => text.includes(normText(kw)));
    
    if (hasInclude && !hasExclude) {
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

    // 1) Hard filters: domain patterns + title patterns (pre-LLM)
    if (BLOCKED_URL_PATHS.test(url)) return { isValid: false };
    if (HARD_EXCLUDE_TITLE.test(title)) return { isValid: false };
    
    const domain = getRegistrableDomain(new URL(url).hostname);
    if (BLOCKED_DOMAINS.has(domain)) return { isValid: false };
    if (HARD_EXCLUDE_DOMAINS.test(domain)) return { isValid: false };

    // B) STRICT: reject if domain matches public institution patterns
    const domainLower = domain.toLowerCase();
    if (requiredSectors.length > 0 && !requiredSectors.includes("Gouvernement & Public") && !requiredSectors.includes("Éducation & Formation")) {
      const publicPatterns = /\b(ville|city|cegep|collège|college|universite|université|university|fondation|foundation|chambre|chamber|ordre|order|cisss|chu|hospital|clinique|clinic|municipalité|municipality)\./i;
      if (publicPatterns.test(domain)) {
        console.log(`[WEB_FILL] REJECT public domain: ${domain}`);
        return { isValid: false };
      }
    }

    // B) Match sectors via STRICT rules
    const fullText = `${title} ${snippet} ${url} ${domain}`.toLowerCase();
    let matchedSectors = [];

    if (requiredSectors.length > 0) {
      matchedSectors = matchSectorsStrict(fullText, requiredSectors);
    }

    const nameMatch = title.match(/^([A-ZÀ-ÿ][a-zà-ÿ\s\-'\.&()]{2,60}?)(?:\s*[-–|]|$)/);
    const companyName = nameMatch ? nameMatch[1].trim() : (title.split("|")[0] || title).slice(0, 100).trim();

    return {
      isValid: true,
      sectorMatch: matchedSectors.length > 0,
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

      // B) STRICT sector: infer if empty
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
        
        // B) STRICT entityType filter (reject non-pertinent org types)
        const primarySector = matchedSectors[0];
        const entityTypeAllowed = primarySector && isEntityTypeAllowed(kb.entityType || "", primarySector, kb.name);
        if (!entityTypeAllowed) {
          console.log(`[KB_FILL] REJECT entityType: ${kb.name} (${kb.entityType}) for sector ${primarySector}`);
          continue;
        }
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
          const { results, rateLimited } = await braveSearch(query, 20, offset);
          braveRequestsUsed++;

          // A) Rate limit 429: stop Web loop, DON'T FAIL
          if (rateLimited) {
            console.log(`[WEB_FILL] RATE_LIMIT hit`);
            stopReason = "BRAVE_RATE_LIMITED";
            break;
          }
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
    // C) FINALIZE: FAILED uniquement si prospectCount == 0
    // A) NEVER expose rate limit in errorMessage
    // ════════════════════════════════════════════════════════════════════════════
    const finalProspects = await base44.entities.Prospect.filter({ campaignId });
    let finalStatus;

    if (prospectCount >= targetCount) {
      finalStatus = "DONE";
      errorMessage = null;
      console.log(`[FINAL] SUCCESS`);
    } else if (prospectCount > 0) {
      // DONE_PARTIAL even if rate limit / time budget / budget guard
      finalStatus = "DONE_PARTIAL";
      if (requiredSectors.length > 0) {
        suggestedNextStep = "RELAX_FILTERS";
        errorMessage = "Résultats insuffisants. Relâchez les filtres ou élargissez la géographie.";
      } else {
        // Don't expose rate limit; just generic message
        errorMessage = null;
      }
      console.log(`[FINAL] PARTIAL: found=${prospectCount}, target=${targetCount}, stopReason=${stopReason}`);
    } else {
      // FAILED only if 0 results total
      finalStatus = "FAILED";
      errorMessage = "Aucun prospect trouvé. Vérifiez vos critères de recherche.";
      console.log(`[FINAL] FAILED: 0 prospects`);
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