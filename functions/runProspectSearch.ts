import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY   = Deno.env.get("BRAVE_API_KEY");
const SERPAPI_KEY = Deno.env.get("SERPAPI_API_KEY");

// ── Dictionnaire de synonymes par secteur (partagé avec backfill) ──────────────
const SECTOR_SYNONYMS = {
  "Technologie": ["IT", "informatique", "SaaS", "logiciel", "software", "cloud", "IA", "AI",
    "numérique", "digital", "cybersécurité", "cybersecurity", "données", "data", "développement",
    "development", "startup", "tech", "infrastructure", "DevOps", "application", "plateforme",
    "platform", "réseau", "network", "API", "programmation", "système", "ERP", "CRM"],
  "Finance & Assurance": ["banque", "bank", "assurance", "insurance", "crédit", "credit", "prêt",
    "loan", "placement", "investissement", "investment", "hypothèque", "mortgage", "courtage",
    "brokerage", "fonds", "fund", "retraite", "pension", "actuaire", "fintech", "capital",
    "trésorerie", "treasury", "actions", "obligations", "portefeuille", "épargne"],
  "Santé & Pharma": ["santé", "health", "pharma", "pharmacie", "pharmacy", "médical", "medical",
    "hôpital", "hospital", "clinique", "clinic", "médecin", "physician", "chirurgie", "surgery",
    "diagnostic", "thérapie", "therapy", "laboratoire", "laboratory", "bien-être", "wellness",
    "soin", "care", "infirmier", "nurse", "dentiste", "dentist"],
  "Gouvernement & Public": ["gouvernement", "government", "municipalité", "municipality", "ville",
    "city", "province", "fédéral", "federal", "ministère", "ministry", "parlement", "parliament",
    "assemblée", "assembly", "CISSS", "CIUSSS", "agence gouvernementale", "administration"],
  "Éducation & Formation": ["université", "university", "collège", "college", "école", "school",
    "cégep", "formation", "training", "cours", "course", "apprentissage", "learning", "étudiant",
    "student", "professeur", "professor", "diplôme", "degree", "certification", "académie"],
  "Associations & OBNL": ["association", "OBNL", "NPO", "fondation", "foundation", "organisme",
    "charitable", "bénévole", "volunteer", "cause sociale", "ONG", "NGO", "syndicat",
    "communautaire", "community", "mission", "ordre professionnel"],
  "Immobilier": ["immobilier", "real estate", "propriété", "property", "construction", "promoteur",
    "developer", "courtier immobilier", "agent immobilier", "logement", "housing", "bureau",
    "bâtiment", "building", "terrain", "condo", "locatif", "REIT", "gestion immobilière"],
  "Droit & Comptabilité": ["avocat", "lawyer", "droit", "law", "comptable", "accountant",
    "comptabilité", "accounting", "juridique", "legal", "notaire", "notary", "cabinet", "firm",
    "fiscalité", "tax", "audit", "conformité", "compliance", "fiducie", "trust", "CPA"],
  "Industrie & Manufacture": ["usine", "factory", "manufacture", "fabrication", "production",
    "industrie", "industry", "acier", "steel", "chimie", "chemistry", "mécanique", "mechanics",
    "automatisation", "automation", "assemblage", "assembly", "machinerie", "ingénierie",
    "engineering", "fournisseur", "supplier", "équipement"],
  "Commerce de détail": ["commerce", "retail", "magasin", "store", "boutique", "vente", "sale",
    "détaillant", "retailer", "marchandise", "merchandise", "épicerie", "grocery", "e-commerce",
    "mode", "fashion", "alimentation", "franchise"],
  "Transport & Logistique": ["transport", "logistique", "logistics", "camion", "truck", "livraison",
    "delivery", "cargo", "fret", "freight", "chauffeur", "driver", "port", "aéroport", "airport",
    "entrepôt", "warehouse", "courrier", "courier", "distribution", "supply chain", "transitaire"],
};

// Mapping province pour filtrage KB
const PROVINCE_ALIASES = {
  "QC": ["québec", "quebec", "qc", "montréal", "montreal", "laval", "longueuil", "gatineau", "sherbrooke", "lévis", "levis", "saguenay", "brossard"],
  "ON": ["ontario", "on", "toronto", "ottawa", "hamilton", "london"],
  "BC": ["british columbia", "colombie-britannique", "bc", "vancouver", "victoria"],
  "AB": ["alberta", "ab", "calgary", "edmonton"],
};

// Synonymes → requêtes de recherche enrichies
function getSectorSearchTerms(sector) {
  const syns = SECTOR_SYNONYMS[sector] || [];
  return syns.slice(0, 8); // Top 8 pour les queries
}

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

// ── SECTOR_RULES: Generic scoring for all 11 sectors ────────────────────────────
// Strong keywords +2, weak keywords +1, excludes -3
const SECTOR_RULES = {
  "Technologie": {
    includeStrong: ["software", "tech", "informatique", "données", "data", "ai", "ia", "cloud", "cybersecurity", "cybersécurité", "logiciel", "digital", "saas", "application", "développement", "it", "plateforme", "system", "infrastructure", "javascript", "python", "devops", "database"],
    includeWeak: ["startup", "agile", "api", "web", "coding", "programmation"],
    excludeStrong: ["agence", "formation", "training", "webinaire", "université", "université", "école", "blog", "article", "news", "annuaire", "directory"]
  },
  "Finance & Assurance": {
    includeStrong: ["finance", "assurance", "banque", "bank", "investment", "crédit", "loan", "fintech", "insurance", "capital", "investissement", "fonds", "fund", "actuaire", "trésorier", "courtier", "risk"],
    includeWeak: ["credit", "économie", "fiscal", "épargne", "portefeuille"],
    excludeStrong: ["université", "formation", "blog", "article", "news", "agence événementielle", "annuaire"]
  },
  "Santé & Pharma": {
    includeStrong: ["santé", "health", "pharma", "médical", "medical", "clinic", "hospital", "hôpital", "pharmacie", "pharmacy", "dentiste", "dentist", "médecin", "physician", "infirmier", "nurse", "thérapie", "thérapeutique", "diagnostic", "patient"],
    includeWeak: ["wellness", "soins", "care", "laboratoire", "clinique"],
    excludeStrong: ["université", "formation", "blog", "article", "news", "agence"]
  },
  "Gouvernement & Public": {
    includeStrong: ["gouvernement", "government", "municipal", "municipalité", "ministère", "ministry", "public", "collectivité", "agence gouvernementale", "policy", "politique"],
    includeWeak: ["ville", "county", "région", "provincial"],
    excludeStrong: ["commercial", "profit", "privé", "private", "entreprise", "business"]
  },
  "Éducation & Formation": {
    includeStrong: ["université", "university", "collège", "college", "formation", "training", "éducation", "education", "école", "school", "cegep", "campus", "diplôme", "degree"],
    includeWeak: ["cours", "cours", "apprentissage", "learning", "professeur", "étudiant"],
    excludeStrong: ["commercial", "profit", "entreprise", "business", "blog", "article", "news"]
  },
  "Associations & OBNL": {
    includeStrong: ["association", "obnl", "nonprofit", "non-profit", "fondation", "foundation", "organisme", "ong", "ngo", "charitable", "bénévole"],
    includeWeak: ["mission", "cause", "social", "communautaire", "community"],
    excludeStrong: ["commercial", "profit", "entreprise", "business", "blog", "article", "news"]
  },
  "Immobilier": {
    includeStrong: ["immobilier", "real estate", "propriété", "property", "construction", "bâtiment", "building", "promotion", "promoteur", "logement", "housing", "bureau", "office", "terrain"],
    includeWeak: ["développement", "hypothèque", "agent immobilier"],
    excludeStrong: ["université", "école", "blog", "article", "news", "agence événementielle"]
  },
  "Droit & Comptabilité": {
    includeStrong: ["droit", "legal", "law", "comptabilité", "accounting", "notaire", "avocat", "lawyer", "fiscal", "tax", "audit", "compliance", "fiducie", "trust", "cabinet jur"],
    includeWeak: ["contrat", "contract", "juriste", "corporate"],
    excludeStrong: ["université", "blog", "article", "news", "formation", "agence"]
  },
  "Industrie & Manufacture": {
    includeStrong: ["manufacture", "usine", "factory", "production", "industriel", "industrial", "supply chain", "fournisseur", "supplier", "équipement", "equipment", "machinerie", "machinery", "assemblage", "assembly"],
    includeWeak: ["prototypage", "usinage", "atelier"],
    excludeStrong: ["agence", "blog", "article", "news", "université", "formation"]
  },
  "Commerce de détail": {
    includeStrong: ["retail", "commerce", "magasin", "store", "vente", "e-commerce", "boutique", "shop", "point de vente", "merchandising", "inventory", "inventaire"],
    includeWeak: ["vendeur", "seller", "client", "customer", "shopping"],
    excludeStrong: ["blog", "article", "news", "agence", "formation", "université"]
  },
  "Transport & Logistique": {
    includeStrong: ["transport", "logistique", "logistics", "livraison", "delivery", "fret", "freight", "distribution", "expédition", "shipping", "chauffeur", "driver", "camion", "truck", "entrepôt", "warehouse"],
    includeWeak: ["terminal", "tracking", "transitaire"],
    excludeStrong: ["agence", "blog", "article", "news", "université", "formation"]
  }
};

// ── Scoring: strong +2, weak +1, exclude -3 ────────────────────────────────────
function matchSectorsStrict(text, requiredSectors, strictMode = true) {
  const norm = normText(text);
  if (requiredSectors.length === 0) return { matched: [], scores: {} };
  
  const matched = [];
  const scores = {};
  const STRICT_THRESHOLD = 3;  // Required in strict mode
  const RELAX_THRESHOLD = 1;   // Fallback if relax suggested
  const threshold = strictMode ? STRICT_THRESHOLD : RELAX_THRESHOLD;
  
  for (const sector of requiredSectors) {
    const rules = SECTOR_RULES[sector];
    if (!rules) continue;
    
    const strongMatches = (rules.includeStrong || []).filter(kw => norm.includes(normText(kw))).length * 2;
    const weakMatches = (rules.includeWeak || []).filter(kw => norm.includes(normText(kw))).length;
    const score = strongMatches + weakMatches;
    
    const hasExclude = (rules.excludeStrong || []).some(kw => norm.includes(normText(kw)));
    const finalScore = hasExclude ? 0 : Math.min(score, 6);
    
    scores[sector] = finalScore;
    if (finalScore >= threshold) {
      matched.push(sector);
    }
  }
  
  return { matched, scores };
}

function inferSectorsFromKb(kb) {
  const text = normText(`${kb.name || ""} ${kb.notes || ""} ${(kb.tags || []).join(" ")}`);
  const matched = [];
  
  for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
    const strongMatches = (rules.includeStrong || []).filter(kw => text.includes(normText(kw))).length * 2;
    const weakMatches = (rules.includeWeak || []).filter(kw => text.includes(normText(kw))).length;
    const score = strongMatches + weakMatches;
    const hasExclude = (rules.excludeStrong || []).some(kw => text.includes(normText(kw)));
    
    if (score > 0 && !hasExclude) {
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

async function braveSearch(query, count = 20, offset = 0) {
  if (braveRLState.remaining === 0 && braveRLState.reset > 0) await waitForBraveReset();
  
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&extra_snippets=true&country=ca`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    parseBraveHeaders(res);
    
    // 2) Brave 429: stop immediately, no retry
    if (res.status === 429) {
      braveRLState.count429++;
      console.log(`[BRAVE] 429 RATE_LIMIT - stopping web fill`);
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

    // B) Match sectors via STRICT rules with scoring
    const fullText = `${title} ${snippet} ${url} ${domain}`.toLowerCase();
    let matchedSectors = [];
    let sectorScores = {};

    if (requiredSectors.length > 0) {
      const result = matchSectorsStrict(fullText, requiredSectors);
      matchedSectors = result.matched;
      sectorScores = result.scores;
    }

    const nameMatch = title.match(/^([A-ZÀ-ÿ][a-zà-ÿ\s\-'\.&()]{2,60}?)(?:\s*[-–|]|$)/);
    const companyName = nameMatch ? nameMatch[1].trim() : (title.split("|")[0] || title).slice(0, 100).trim();

    return {
      isValid: true,
      sectorMatch: matchedSectors.length > 0,
      sectorScores,
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
  const companyTermsFR = ["entreprises", "sociétés", "compagnies", "organisations", "cabinet", "firmes"];
  const companyTermsEN = ["companies", "firms", "organizations"];

  for (const l of locAll) {
    for (const term of companyTermsFR.slice(0, 3)) {
      queries.push(`${term} ${sectorsFR} ${l} ${kws} ${EXCL}`);
    }
    for (const term of companyTermsEN.slice(0, 2)) {
      queries.push(`${term} ${sectorsFR} ${l} ${kws} ${EXCL}`);
    }
  }

  // B — SYNONYM-ENRICHED QUERIES: use top synonyms per sector
  for (const sector of sectors) {
    const sectorTerms = getSectorSearchTerms(sector);
    // Pick 3 representative synonyms and build queries with them
    const synGroups = [sectorTerms.slice(0, 3), sectorTerms.slice(3, 6)].filter(g => g.length > 0);
    for (const group of synGroups) {
      const synStr = group.map(s => `"${s}"`).join(" OR ");
      const locQ2 = locAll[0];
      queries.push(`entreprises (${synStr}) ${locQ2} ${EXCL}`);
      queries.push(`companies (${synStr}) ${locQ2} ${EXCL}`);
    }
    // Also query with just sector name + city
    queries.push(`${sector} entreprises ${locAll[0]} ${EXCL}`);
    queries.push(`${sector} companies ${locAll[0]} ${EXCL}`);
  }

  // C — INDUSTRY CLUSTERS
  for (const l of locAll.slice(0, 2)) {
    queries.push(`grappe industrielle ${sectorsFR} ${l} ${EXCL}`);
    queries.push(`ecosystem ${sectorsFR} ${l} ${EXCL}`);
  }

  // D — ASSOCIATIONS
  for (const l of locAll.slice(0, 2)) {
    queries.push(`association ${sectorsFR} ${l} membres ${EXCL}`);
    if (sectors.length === 1) {
      queries.push(`association ${sectors[0]} ${l} membres ${EXCL}`);
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

    // B2) Paginated KB query (robustly fetch all available)
    let kbAll = [];
    let kbPage = 0;
    const kbPageSize = 500;
    while (true) {
      const batch = await base44.asServiceRole.entities.KBEntity.list(
        '-updated_date',
        kbPageSize,
        kbPage * kbPageSize
      ).catch(() => []);
      
      if (!batch || batch.length === 0) break;
      kbAll = kbAll.concat(batch);
      console.log(`[KB_FILL] page=${kbPage} loaded=${batch.length} total_so_far=${kbAll.length}`);
      
      if (batch.length < kbPageSize) break;
      kbPage++;
      
      // Safety: stop after 20 pages (10k entities) or if time budget exceeded
      if (kbPage >= 20 || Date.now() - START_TIME > MAX_DURATION_MS * 0.3) {
        console.log(`[KB_FILL] pagination halted: page=${kbPage}, time_budget_check`);
        break;
      }
    }
    console.log(`[KB_FILL] candidates_total=${kbAll.length} from ${kbPage + 1} pages`);

    // B3) Location matching — utilise hqCity/hqProvince si disponible, sinon hqLocation
    const locNorm = normText(locQuery);
    const wantQC = /\b(qc|qu[eé]bec)\b/.test(locNorm);
    const cityNorm = normText(locQuery.split(",")[0]);

    // Determine target province from location query
    let targetProvince = null;
    if (wantQC) targetProvince = "QC";
    else {
      for (const [prov, aliases] of Object.entries(PROVINCE_ALIASES)) {
        if (aliases.some(a => locNorm.includes(a))) { targetProvince = prov; break; }
      }
    }

    function kbMatchesLocation(e) {
      // 1. Structured fields first (most reliable)
      if (e.hqProvince) {
        if (targetProvince) return e.hqProvince === targetProvince;
        return true; // No province filter
      }
      if (e.hqCity) {
        const cityKb = normText(e.hqCity);
        if (cityNorm && cityKb.includes(cityNorm)) return true;
        // Province aliases
        if (targetProvince && PROVINCE_ALIASES[targetProvince]) {
          return PROVINCE_ALIASES[targetProvince].some(a => cityKb.includes(a));
        }
        return !targetProvince; // No geo filter → accept
      }
      // 2. Fallback: hqLocation free text
      const eLoc = normText(e.hqLocation || "");
      if (!eLoc) return !targetProvince; // No location info → accept if no geo filter
      if (targetProvince === "QC") {
        const qcAliases = PROVINCE_ALIASES["QC"] || [];
        return qcAliases.some(a => eLoc.includes(a));
      }
      if (cityNorm) return eLoc.includes(cityNorm);
      return true;
    }

    // B3b) Sector matching via industrySectors + lazy backfill si manquant
    async function kbMatchesSectors(e) {
      if (requiredSectors.length === 0) return { match: true, matchedSectors: [] };

      let kbSectors = Array.isArray(e.industrySectors) && e.industrySectors.length > 0
        ? e.industrySectors
        : null;

      // Lazy backfill: infer and persist if missing
      if (!kbSectors) {
        const inferred = inferSectorsFromKb(e);
        if (inferred.length > 0) {
          kbSectors = inferred;
          // Fire-and-forget: update KB entity in background
          base44.asServiceRole.entities.KBEntity.update(e.id, {
            industrySectors: inferred,
            industryLabel: inferred[0],
          }).catch(() => {});
        } else {
          // Last resort: synonym scan across requiredSectors
          const text = normText(`${e.name || ""} ${(e.tags || []).join(" ")} ${e.notes || ""}`);
          const synonymHits = [];
          for (const sector of requiredSectors) {
            const syns = SECTOR_SYNONYMS[sector] || [];
            if (syns.some(syn => text.includes(normText(syn)))) synonymHits.push(sector);
          }
          kbSectors = synonymHits;
        }
      }

      const matchedSectors = kbSectors.filter(s => requiredSectors.includes(s));
      return { match: matchedSectors.length > 0, matchedSectors };
    }

    const kbCandidates = kbAll
      .filter(e => {
        if (existingDomains.has((e.domain || "").toLowerCase())) return false;
        if (!e.domain || !e.website || !e.name) return false;
        return kbMatchesLocation(e);
      })
      .sort(() => Math.random() - 0.5);

    console.log(`[KB_FILL] candidates_filtered=${kbCandidates.length}`);

    for (const kb of kbCandidates) {
      if (Date.now() - START_TIME > MAX_DURATION_MS) { stopReason = "TIME_BUDGET"; break; }
      if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }

      const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) continue;

      // Sector matching avec synonymes + lazy backfill
      const { match: sectorMatch, matchedSectors: foundSectors } = await kbMatchesSectors(kb);
      let matchedSectors = foundSectors;

      if (requiredSectors.length > 0 && !sectorMatch) {
        console.log(`[KB_FILL] REJECT sector: ${kb.name}`);
        continue;
      }
      
      if (requiredSectors.length > 0 && matchedSectors.length > 0) {
        // Soft entityType filter — ne rejette que les cas vraiment hors scope
        const primarySector = matchedSectors[0];
        const entityTypeAllowed = isEntityTypeAllowed(kb.entityType || "", primarySector, kb.name);
        if (!entityTypeAllowed) {
          console.log(`[KB_FILL] REJECT entityType: ${kb.name} (${kb.entityType}) for sector ${primarySector}`);
          continue;
        }
      }

      // Create prospect — use matched sectors, never entityType as industry
      const industryLabel = matchedSectors[0] || kb.industryLabel || null;
      await base44.entities.Prospect.create({
        campaignId,
        ownerUserId: campaign.ownerUserId,
        companyName: kb.name,
        website: kb.website || `https://${kb.domain}`,
        domain: domNorm,
        industry: industryLabel,
        industrySectors: matchedSectors.length > 0 ? matchedSectors : (Array.isArray(kb.industrySectors) ? kb.industrySectors : []),
        industryLabel,
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

        let consecutiveRejects = 0;
        for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
          if (Date.now() - START_TIME > MAX_DURATION_MS) { stopReason = "TIME_BUDGET"; break; }
          if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
          if (braveRequestsUsed >= BRAVE_MAX_REQUESTS) { stopReason = "BUDGET_GUARD"; break; }

          const offset = pageIdx * 20;
          const { results, rateLimited } = await braveSearch(query, 20, offset);
          braveRequestsUsed++;

          if (rateLimited) {
            console.log(`[WEB_FILL] RATE_LIMIT hit`);
            stopReason = "BRAVE_RATE_LIMITED";
            break;
          }
          if (results.length === 0) break;

          for (const r of results) {
            if (prospectCount >= targetCount) break;
            if (consecutiveRejects > 30) { stopReason = "QUALITY_THRESHOLD"; break; }
            
            // Hard pre-LLM filters
            if (HARD_EXCLUDE_DOMAINS.test(r.url) || HARD_EXCLUDE_TITLE.test(r.title)) {
              consecutiveRejects++;
              continue;
            }
            
            // Normalize & check sector match
            const normalized = await normalizeResult(r, requiredSectors);
            if (!normalized.isValid) {
              consecutiveRejects++;
              continue;
            }
            if (!normalized.sectorMatch) {
              consecutiveRejects++;
              continue;
            }
            
            // Noise check
            const noise = shouldRejectByNoise(r.url, r.title, r.snippet);
            if (noise) {
              consecutiveRejects++;
              continue;
            }
            
            // Accepted: reset counter
            consecutiveRejects = 0;

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
    // FINALIZE: DONE_PARTIAL if strict scoring blocked prospects
    // Never expose rate limit/429 in errorMessage
    // ════════════════════════════════════════════════════════════════════════════
    const finalProspects = await base44.entities.Prospect.filter({ campaignId });
    let finalStatus;

    if (prospectCount >= targetCount) {
      finalStatus = "DONE";
      errorMessage = null;
      console.log(`[FINAL] SUCCESS`);
    } else if (prospectCount > 0) {
      // DONE_PARTIAL: not enough due to strict scoring or resource limits
      finalStatus = "DONE_PARTIAL";
      suggestedNextStep = "RELAX_FILTERS";
      errorMessage = "Résultats insuffisants. Essayez de relâcher les filtres secteur, élargir la géographie ou ajouter des mots-clés.";
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