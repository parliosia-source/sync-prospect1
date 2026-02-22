import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const BRAVE_KEY = Deno.env.get("BRAVE_API_KEY");

// ── Dictionnaire de synonymes par secteur ──────────────────────────────────────
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

// All cities in the Greater Montreal area → hqRegion=MTL
const MTL_CITIES = new Set([
  "montreal","laval","longueuil","brossard","terrebonne","repentigny","boucherville",
  "dorval","pointe-claire","kirkland","beaconsfield","saint-lambert","westmount",
  "mont-royal","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","saint-jerome","blainville","boisbriand","mascouche","mirabel",
  "la-prairie","chateauguay","candiac","laprairie","saint-jean-sur-richelieu",
  "vaudreuil-dorion","les-coteaux","sainte-catherine","sainte-julie","varennes",
  "montreal-est","montreal-nord","montreal-ouest","lachine","rosemont","villeray",
  "hochelaga","riviere-des-prairies","saint-leonard","ahuntsic","mtl",
]);

// MTL city mention in text (for snippet-based geo check)
const MTL_CITY_MENTIONS = /\b(montr[eé]al|laval|longueuil|brossard|terrebonne|repentigny|boucherville|dorval|pointe-claire|westmount|verdun|anjou|outremont|lasalle|saint-laurent|blainville|boisbriand|mirabel|ch[aâ]teauguay|vaudreuil|lachine|ahuntsic|mtl)\b/i;

function isMtlQuery(locationQuery) {
  const norm = normText(locationQuery);
  if (MTL_CITIES.has(norm)) return true;
  for (const token of norm.split(/[,\s]+/)) {
    if (MTL_CITIES.has(token)) return true;
  }
  return false;
}

function isMtlSnippet(text) {
  return MTL_CITY_MENTIONS.test(text || "");
}

// Mapping province
const PROVINCE_ALIASES = {
  "QC": ["québec", "quebec", "qc", "montréal", "montreal", "laval", "longueuil", "gatineau", "sherbrooke", "lévis", "levis", "saguenay", "brossard"],
  "ON": ["ontario", "on", "toronto", "ottawa", "hamilton", "london"],
  "BC": ["british columbia", "colombie-britannique", "bc", "vancouver", "victoria"],
  "AB": ["alberta", "ab", "calgary", "edmonton"],
};

function getSectorSearchTerms(sector) {
  return (SECTOR_SYNONYMS[sector] || []).slice(0, 8);
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

const HARD_EXCLUDE_DOMAINS = /^(glassdoor|chambers|canada|gc|bankofcanada|medium|.*\.gov|.*\.gouv|chambers)/i;
const HARD_EXCLUDE_TITLE = /\b(top|best|directory|map|mapping|ranking|rank|list|how to|guide|guide complet|news|blog|press|press release|pdf|directory|listem|companies list|database|annuaire|repertoire)\b/i;

const ANTI_BRUIT = {
  article: /\b(article|blog|news|press release|communiqué|actualit[eé]|magazine|guide complet|comment |pourquoi |top \d+|liste de|idées de|trending|répertoire|annuaire|directory|listing|database)\b/i,
  calendar: /\b(calendar|agenda|événement|event|programme|program|inscription|register|archive|événements|show|salon|expo|exposition|summit|congr[eè]s|conference|forum|webinar)\b/i,
  venue: /\b(centre de congrès|palais des congrès|meeting room|salle|venue|location|espace|réception|banquet|hôtel|hotel|resort|airbnb|hospitality)\b/i,
  agency: /\b(agence événementielle|event planner|organisateur|event management|event agency|party planner|wedding|mariage|planificateur|event organizer)\b/i,
  directory: /\b(répertoire|annuaire|directory|listing|pages jaunes|yellow pages|fournisseur|supplier|catalog|catalogue)\b/i,
  media: /\b(journal|newspaper|gazette|radio|tv|television|chaîne|channel|presse|medias|honoree|award|awards|ranking|classement|palmar[eè]s)\b/i,
  public: /\b(ville|city|municipalité|municipality|gouvernement|government|fondation|foundation|université|university|cegep|collège|chamber|chambre|ordre|order|cisss|chu|hospital)\b/i,
};

// ── SECTOR_RULES ───────────────────────────────────────────────────────────────
const SECTOR_RULES = {
  "Technologie": {
    includeStrong: ["software", "tech", "informatique", "données", "data", "ai", "ia", "cloud", "cybersecurity", "cybersécurité", "logiciel", "digital", "saas", "application", "développement", "it", "plateforme", "system", "infrastructure", "javascript", "python", "devops", "database"],
    includeWeak: ["startup", "agile", "api", "web", "coding", "programmation"],
    excludeStrong: ["agence", "formation", "training", "webinaire", "université", "école", "blog", "article", "news", "annuaire", "directory"]
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
    includeWeak: ["cours", "apprentissage", "learning", "professeur", "étudiant"],
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

// ── Scoring ────────────────────────────────────────────────────────────────────
function matchSectorsStrict(text, requiredSectors, strictMode = true) {
  const norm = normText(text);
  if (requiredSectors.length === 0) return { matched: [], scores: {} };

  const matched = [];
  const scores = {};
  const threshold = strictMode ? 3 : 1;

  for (const sector of requiredSectors) {
    const rules = SECTOR_RULES[sector];
    if (!rules) continue;
    const strongMatches = (rules.includeStrong || []).filter(kw => norm.includes(normText(kw))).length * 2;
    const weakMatches = (rules.includeWeak || []).filter(kw => norm.includes(normText(kw))).length;
    const score = strongMatches + weakMatches;
    const hasExclude = (rules.excludeStrong || []).some(kw => norm.includes(normText(kw)));
    const finalScore = hasExclude ? 0 : Math.min(score, 6);
    scores[sector] = finalScore;
    if (finalScore >= threshold) matched.push(sector);
  }
  return { matched, scores };
}

// ── WEB_TOPUP confidence score (0–100) ────────────────────────────────────────
function computeWebTopUpScore(text, snippet, domain, requiredSectors, isMTL) {
  let score = 0;

  // +40 strong sector match
  const { matched, scores } = matchSectorsStrict(text, requiredSectors, false);
  const maxSectorScore = Math.max(0, ...Object.values(scores));
  if (maxSectorScore >= 4) score += 40;
  else if (maxSectorScore >= 2) score += 25;
  else if (maxSectorScore >= 1) score += 15;

  // +30 MTL presence
  if (isMTL || isMtlSnippet(text)) score += 30;

  // +20 clean domain (no annuaire/social/blog markers)
  const dirtyDomain = /\b(directory|pages|jaunes|annuaire|list|rank|top|blog|news|review|compare)\b/i.test(domain);
  if (!dirtyDomain && domain.length < 40) score += 20;

  // +10 informative snippet
  if ((snippet || "").length > 80) score += 10;

  return Math.min(100, score);
}

// Classify sector from text using SECTOR_SYNONYMS
function classifySectorFromText(text, candidates) {
  const norm = normText(text);
  const matched = [];
  for (const sector of candidates) {
    const syns = SECTOR_SYNONYMS[sector] || [];
    const hits = syns.filter(s => norm.includes(normText(s))).length;
    if (hits >= 2) matched.push({ sector, hits });
  }
  return matched.sort((a, b) => b.hits - a.hits).map(m => m.sector);
}

// Extract keywords from title+snippet
function extractKeywordsFromSnippet(title, snippet, sector) {
  const text = normText(`${title} ${snippet}`);
  const syns = SECTOR_SYNONYMS[sector] || [];
  return syns.filter(s => text.includes(normText(s))).slice(0, 8);
}

function inferSectorsFromKb(kb) {
  const text = normText(`${kb.name || ""} ${kb.notes || ""} ${(kb.tags || []).join(" ")}`);
  const matched = [];
  for (const [sector, rules] of Object.entries(SECTOR_RULES)) {
    const strongMatches = (rules.includeStrong || []).filter(kw => text.includes(normText(kw))).length * 2;
    const weakMatches = (rules.includeWeak || []).filter(kw => text.includes(normText(kw))).length;
    const score = strongMatches + weakMatches;
    const hasExclude = (rules.excludeStrong || []).some(kw => text.includes(normText(kw)));
    if (score > 0 && !hasExclude) matched.push(sector);
  }
  return matched;
}

// ── Brave Search ───────────────────────────────────────────────────────────────
const braveRLState = { remaining: -1, reset: -1, count429: 0 };

function parseBraveHeaders(res) {
  const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") || "-1", 10);
  const reset = parseInt(res.headers.get("X-RateLimit-Reset") || "-1", 10);
  if (remaining !== -1) braveRLState.remaining = remaining;
  if (reset !== -1) braveRLState.reset = reset;
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

    if (res.status === 429) {
      braveRLState.count429++;
      console.log(`[BRAVE] 429 RATE_LIMIT`);
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

// ── Normalization ──────────────────────────────────────────────────────────────
function normalizeResult(r, requiredSectors) {
  try {
    const url = r.url || "";
    const title = r.title || "";
    const snippet = r.snippet || "";

    if (BLOCKED_URL_PATHS.test(url)) return { isValid: false };
    if (HARD_EXCLUDE_TITLE.test(title)) return { isValid: false };

    const domain = getRegistrableDomain(new URL(url).hostname);
    if (BLOCKED_DOMAINS.has(domain)) return { isValid: false };
    if (HARD_EXCLUDE_DOMAINS.test(domain)) return { isValid: false };

    if (requiredSectors.length > 0 && !requiredSectors.includes("Gouvernement & Public") && !requiredSectors.includes("Éducation & Formation")) {
      const publicPatterns = /\b(ville|city|cegep|collège|college|universite|université|university|fondation|foundation|chambre|chamber|ordre|order|cisss|chu|hospital|clinique|clinic|municipalité|municipality)\./i;
      if (publicPatterns.test(domain)) return { isValid: false };
    }

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
      snippet,
      title,
      industry: matchedSectors[0] || null,
      matchedSectors,
    };
  } catch (_) {
    return { isValid: false };
  }
}

function shouldRejectByNoise(url, title, snippet) {
  const fullText = `${url} ${title} ${snippet}`.toLowerCase();
  return Object.values(ANTI_BRUIT).some(regex => regex.test(fullText));
}

// ── Query builders ─────────────────────────────────────────────────────────────
const EXCL = '-site:linkedin.com -site:facebook.com -site:glassdoor.com -site:indeed.com -site:eventbrite.com -site:wikipedia.org -filetype:pdf';

function buildQueryVariants(campaign, loc) {
  const sectors = (campaign.industrySectors || []).slice(0, 3);
  const sectorsFR = sectors.map(s => `"${s}"`).join(" ");
  const kws = (campaign.keywords || []).join(" ");
  const locQ = loc.split(",")[0].trim();
  const locAll = [locQ, `"${locQ}"`, loc].filter(Boolean);
  const queries = [];

  const companyTermsFR = ["entreprises", "sociétés", "compagnies", "organisations", "cabinet", "firmes"];
  const companyTermsEN = ["companies", "firms", "organizations"];

  for (const l of locAll) {
    for (const term of companyTermsFR.slice(0, 3)) queries.push(`${term} ${sectorsFR} ${l} ${kws} ${EXCL}`);
    for (const term of companyTermsEN.slice(0, 2)) queries.push(`${term} ${sectorsFR} ${l} ${kws} ${EXCL}`);
  }

  for (const sector of sectors) {
    const sectorTerms = getSectorSearchTerms(sector);
    const synGroups = [sectorTerms.slice(0, 3), sectorTerms.slice(3, 6)].filter(g => g.length > 0);
    for (const group of synGroups) {
      const synStr = group.map(s => `"${s}"`).join(" OR ");
      queries.push(`entreprises (${synStr}) ${locAll[0]} ${EXCL}`);
      queries.push(`companies (${synStr}) ${locAll[0]} ${EXCL}`);
    }
    queries.push(`${sector} entreprises ${locAll[0]} ${EXCL}`);
    queries.push(`${sector} companies ${locAll[0]} ${EXCL}`);
  }

  for (const l of locAll.slice(0, 2)) {
    queries.push(`grappe industrielle ${sectorsFR} ${l} ${EXCL}`);
    queries.push(`ecosystem ${sectorsFR} ${l} ${EXCL}`);
    queries.push(`association ${sectorsFR} ${l} membres ${EXCL}`);
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

  let errorMessage = null;
  let stopReason = null;
  let kbAccepted = 0;
  let webAccepted = 0;
  let webTopUpFetched = 0;
  let webTopUpInsertedToKbV2 = 0;
  let webTopUpRejected = 0;
  let braveRequestsUsed = 0;

  const locQuery = campaign.locationQuery || "Montréal, QC";
  const requiredSectors = campaign.industrySectors || [];
  const targetCount = campaign.targetCount || 50;

  const existingProspects = await base44.entities.Prospect.filter({ campaignId }, "-created_date", 2000).catch(() => []);
  const existingDomains = new Set(existingProspects.map(p => (p.domain || "").replace(/^www\./, "").toLowerCase()));
  let prospectCount = existingProspects.length;

  console.log(`[START] campaignId=${campaignId}, target=${targetCount}, existing=${prospectCount}, sectors=${requiredSectors.join(",")}`);

  if (prospectCount >= targetCount) {
    await base44.entities.Campaign.update(campaignId, {
      status: "DONE", progressPct: 100, countProspects: prospectCount,
      toolUsage: { skipReason: "ALREADY_AT_TARGET", finalProspectCount: prospectCount },
    });
    return Response.json({ success: true, campaignId, prospectCount, status: "DONE", skipReason: "ALREADY_AT_TARGET" });
  }

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 1: KBEntityV2 FILL
    // ════════════════════════════════════════════════════════════════════════════
    const locNorm = normText(locQuery);
    const isMTL = isMtlQuery(locQuery);
    const wantQC = /\b(qc|qu[eé]bec)\b/.test(locNorm) || isMTL;
    const cityNorm = normText(locQuery.split(",")[0]);

    let targetProvince = null;
    if (wantQC) targetProvince = "QC";
    else {
      for (const [prov, aliases] of Object.entries(PROVINCE_ALIASES)) {
        if (aliases.some(a => locNorm.includes(a))) { targetProvince = prov; break; }
      }
    }

    console.log(`[KBV2_FILL] START isMTL=${isMTL} targetProvince=${targetProvince}`);

    let kbV2All = [];
    let kbV2Page = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.KBEntityV2.list('-confidenceScore', 500, kbV2Page * 500).catch(() => []);
      if (!batch || batch.length === 0) break;
      kbV2All = kbV2All.concat(batch);
      if (batch.length < 500) break;
      kbV2Page++;
      if (kbV2Page >= 20 || Date.now() - START_TIME > MAX_DURATION_MS * 0.25) break;
    }

    // Build set of existing KB domains for dedup during WEB_TOPUP
    const kbV2DomainSet = new Set(kbV2All.map(e => (e.domain || "").toLowerCase().replace(/^www\./, "")));
    const kbV2InitialCount = kbV2All.length;

    console.log(`[KBV2_FILL] loaded=${kbV2InitialCount}`);

    const kbV2Candidates = kbV2All.filter(e => {
      if (!e.domain || !e.website || !e.name) return false;
      const domNorm = e.domain.toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) return false;
      if (isMTL) return e.hqRegion === "MTL";
      if (targetProvince === "QC") return ["MTL", "QC_OTHER"].includes(e.hqRegion) || e.hqProvince === "QC";
      if (targetProvince) return e.hqProvince === targetProvince;
      return true;
    });

    const kbV2CandidatesAfterLocation = kbV2Candidates.length;

    function kbV2MatchesSectors(e) {
      if (requiredSectors.length === 0) return { match: true, matchedSectors: Array.isArray(e.industrySectors) ? e.industrySectors : [] };
      const kbSectors = Array.isArray(e.industrySectors) ? e.industrySectors : [];
      const matchedSectors = kbSectors.filter(s => requiredSectors.includes(s));
      return { match: matchedSectors.length > 0, matchedSectors };
    }

    // Count after sector filter for logging
    const kbV2CandidatesAfterSector = kbV2Candidates.filter(e => kbV2MatchesSectors(e).match || requiredSectors.length === 0).length;

    const kbV2Filtered = kbV2Candidates
      .map(e => ({ e, score: (e.confidenceScore || 70) + Math.random() * 5 }))
      .sort((a, b) => b.score - a.score)
      .map(({ e }) => e);

    for (const kb of kbV2Filtered) {
      if (Date.now() - START_TIME > MAX_DURATION_MS * 0.4) { stopReason = "TIME_BUDGET"; break; }
      if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }

      const domNorm = kb.domain.toLowerCase().replace(/^www\./, "");
      if (existingDomains.has(domNorm)) continue;

      const { match: sectorMatch, matchedSectors } = kbV2MatchesSectors(kb);
      if (requiredSectors.length > 0 && !sectorMatch) continue;

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
        location: { city: kb.hqCity || "", country: kb.hqCountry || "CA" },
        entityType: kb.entityType || "COMPANY",
        status: "NOUVEAU",
        sourceOrigin: "KB_V2",
        kbEntityId: kb.id,
        serpSnippet: kb.notes || "",
        sourceUrl: kb.sourceUrl || "",
      });

      existingDomains.add(domNorm);
      kbAccepted++;
      prospectCount++;

      if (kbAccepted % 10 === 0) {
        await base44.entities.Campaign.update(campaignId, {
          progressPct: Math.min(35, Math.round((kbAccepted / Math.max(10, targetCount)) * 35)),
          countProspects: prospectCount,
        });
      }
    }
    console.log(`[KBV2_FILL] END: accepted=${kbAccepted}, total=${prospectCount}`);

    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 1b: Legacy KBEntity fallback (if KBV2 insufficient)
    // ════════════════════════════════════════════════════════════════════════════
    if (prospectCount < targetCount && !stopReason) {
      let kbAll = [];
      let kbPage = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities.KBEntity.list('-updated_date', 500, kbPage * 500).catch(() => []);
        if (!batch || batch.length === 0) break;
        kbAll = kbAll.concat(batch);
        if (batch.length < 500) break;
        kbPage++;
        if (kbPage >= 10 || Date.now() - START_TIME > MAX_DURATION_MS * 0.55) break;
      }
      console.log(`[KB_FILL] legacy loaded=${kbAll.length}`);

      function kbMatchesLocation(e) {
        if (e.hqProvince) { return targetProvince ? e.hqProvince === targetProvince : true; }
        if (e.hqCity) {
          const cityKb = normText(e.hqCity);
          if (cityNorm && cityKb.includes(cityNorm)) return true;
          if (targetProvince && PROVINCE_ALIASES[targetProvince]) return PROVINCE_ALIASES[targetProvince].some(a => cityKb.includes(a));
          return !targetProvince;
        }
        const eLoc = normText(e.hqLocation || "");
        if (!eLoc) return !targetProvince;
        if (targetProvince === "QC") return (PROVINCE_ALIASES["QC"] || []).some(a => eLoc.includes(a));
        if (cityNorm) return eLoc.includes(cityNorm);
        return true;
      }

      function kbMatchesSectors(e) {
        if (requiredSectors.length === 0) return { match: true, matchedSectors: [] };
        const kbSectors = Array.isArray(e.industrySectors) && e.industrySectors.length > 0 ? e.industrySectors : inferSectorsFromKb(e);
        const matchedSectors = kbSectors.filter(s => requiredSectors.includes(s));
        if (matchedSectors.length === 0) {
          const text = normText(`${e.name || ""} ${(e.tags || []).join(" ")} ${e.notes || ""}`);
          for (const sector of requiredSectors) {
            const syns = SECTOR_SYNONYMS[sector] || [];
            if (syns.some(syn => text.includes(normText(syn)))) matchedSectors.push(sector);
          }
        }
        return { match: matchedSectors.length > 0, matchedSectors };
      }

      const kbCandidates = kbAll
        .filter(e => {
          if (existingDomains.has((e.domain || "").toLowerCase())) return false;
          if (!e.domain || !e.website || !e.name) return false;
          return kbMatchesLocation(e);
        })
        .sort(() => Math.random() - 0.5);

      let legacyKbAccepted = 0;
      for (const kb of kbCandidates) {
        if (Date.now() - START_TIME > MAX_DURATION_MS * 0.6) { stopReason = "TIME_BUDGET"; break; }
        if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }

        const domNorm = (kb.domain || "").toLowerCase().replace(/^www\./, "");
        if (existingDomains.has(domNorm)) continue;

        const { match: sectorMatch, matchedSectors } = kbMatchesSectors(kb);
        if (requiredSectors.length > 0 && !sectorMatch) continue;

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
        legacyKbAccepted++;
        prospectCount++;
      }
      console.log(`[KB_FILL] END: legacy_accepted=${legacyKbAccepted}, total=${prospectCount}`);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 2: WEB_TOPUP (Brave → prospects + auto-save KBEntityV2)
    // ════════════════════════════════════════════════════════════════════════════
    const WEB_TOPUP_MAX_BRAVE = 200;
    const WEB_TOPUP_MAX_KB_INSERT = 200;
    const KB_TOPUP_CONFIDENCE_THRESHOLD = 70;
    const needsWebTopUp = prospectCount < targetCount && !stopReason;

    if (needsWebTopUp) {
      console.log(`[WEB_TOPUP] START: need=${targetCount - prospectCount} more, brave_budget=${WEB_TOPUP_MAX_BRAVE}`);

      const queriesRaw = buildQueryVariants(campaign, locQuery);
      const BRAVE_MAX_PAGES_PER_QUERY = 5;
      let consecutiveRejects = 0;

      for (const query of queriesRaw) {
        if (Date.now() - START_TIME > MAX_DURATION_MS * 0.95) { stopReason = "TIME_BUDGET"; break; }
        if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
        if (braveRequestsUsed >= WEB_TOPUP_MAX_BRAVE) { stopReason = "BUDGET_GUARD"; break; }

        const maxPages = Date.now() - START_TIME > 70000 ? 2 : BRAVE_MAX_PAGES_PER_QUERY;

        for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
          if (Date.now() - START_TIME > MAX_DURATION_MS * 0.95) { stopReason = "TIME_BUDGET"; break; }
          if (prospectCount >= targetCount) { stopReason = "TARGET_REACHED"; break; }
          if (braveRequestsUsed >= WEB_TOPUP_MAX_BRAVE) { stopReason = "BUDGET_GUARD"; break; }

          const { results, rateLimited } = await braveSearch(query, 20, pageIdx * 20);
          braveRequestsUsed++;
          webTopUpFetched += results.length;

          if (rateLimited) { stopReason = "BRAVE_RATE_LIMITED"; break; }
          if (results.length === 0) break;

          for (const r of results) {
            if (prospectCount >= targetCount) break;
            if (consecutiveRejects > 40) { break; }

            if (HARD_EXCLUDE_DOMAINS.test(r.url) || HARD_EXCLUDE_TITLE.test(r.title)) {
              consecutiveRejects++;
              webTopUpRejected++;
              continue;
            }

            const normalized = normalizeResult(r, requiredSectors);
            if (!normalized.isValid) { consecutiveRejects++; webTopUpRejected++; continue; }
            if (!normalized.sectorMatch) { consecutiveRejects++; webTopUpRejected++; continue; }
            if (shouldRejectByNoise(r.url, r.title, r.snippet)) { consecutiveRejects++; webTopUpRejected++; continue; }

            consecutiveRejects = 0;
            const domNorm = normalized.domain.toLowerCase();
            if (existingDomains.has(domNorm)) continue;
            if (/\b(events|blog|news|press)\./.test(domNorm)) continue;

            // ── Auto-save to KBEntityV2 ────────────────────────────────────────
            const fullText = `${normalized.title} ${normalized.snippet} ${normalized.domain}`;
            const topUpScore = computeWebTopUpScore(fullText, normalized.snippet, normalized.domain, requiredSectors, isMTL);
            const isInKbV2 = kbV2DomainSet.has(domNorm);

            let kbEntityId = null;

            if (!isInKbV2 && topUpScore >= KB_TOPUP_CONFIDENCE_THRESHOLD && webTopUpInsertedToKbV2 < WEB_TOPUP_MAX_KB_INSERT) {
              const sectorSynsUsed = extractKeywordsFromSnippet(normalized.title, normalized.snippet, normalized.matchedSectors[0] || requiredSectors[0] || "");
              const allClassified = classifySectorFromText(fullText, requiredSectors);
              const todayStr = new Date().toISOString().split("T")[0];

              try {
                const created = await base44.asServiceRole.entities.KBEntityV2.create({
                  name: normalized.companyName,
                  normalizedName: normText(normalized.companyName),
                  domain: domNorm,
                  website: normalized.website,
                  hqCity: isMTL ? "Montréal" : "",
                  hqProvince: "QC",
                  hqCountry: "CA",
                  hqRegion: isMTL ? "MTL" : "QC_OTHER",
                  industryLabel: normalized.matchedSectors[0] || requiredSectors[0] || "",
                  industrySectors: allClassified.length > 0 ? allClassified : normalized.matchedSectors,
                  entityType: "COMPANY",
                  tags: [],
                  notes: (normalized.snippet || "").slice(0, 300),
                  keywords: sectorSynsUsed,
                  synonyms: [],
                  sectorSynonymsUsed: sectorSynsUsed,
                  confidenceScore: topUpScore,
                  qualityFlags: ["WEB_TOPUP"],
                  sourceOrigin: "WEB",
                  sourceUrl: normalized.website,
                  lastVerifiedAt: todayStr,
                });
                kbV2DomainSet.add(domNorm);
                kbEntityId = created.id;
                webTopUpInsertedToKbV2++;
                console.log(`[WEB_TOPUP] KB_SAVE: ${domNorm} score=${topUpScore}`);
              } catch (kbErr) {
                console.log(`[WEB_TOPUP] KB_SAVE_ERR: ${domNorm} - ${kbErr.message}`);
              }
            }

            // ── Create Prospect ────────────────────────────────────────────────
            await base44.entities.Prospect.create({
              campaignId,
              ownerUserId: campaign.ownerUserId,
              companyName: normalized.companyName,
              website: normalized.website,
              domain: domNorm,
              industry: normalized.industry,
              industrySectors: normalized.matchedSectors,
              industryLabel: normalized.matchedSectors[0] || null,
              location: isMTL ? { city: "Montréal", country: "CA" } : { country: "CA" },
              entityType: "COMPANY",
              status: "NOUVEAU",
              sourceOrigin: "WEB",
              kbEntityId: kbEntityId || undefined,
              serpSnippet: r.snippet || "",
              sourceUrl: r.url,
            });

            existingDomains.add(domNorm);
            webAccepted++;
            prospectCount++;

            if (webAccepted % 10 === 0) {
              const prog = Math.min(90, 40 + Math.round((webAccepted / Math.max(10, targetCount - kbAccepted)) * 50));
              await base44.entities.Campaign.update(campaignId, {
                progressPct: prog,
                countProspects: prospectCount,
                toolUsage: {
                  kbV2InitialCount,
                  kbV2CandidatesAfterFilters: kbV2CandidatesAfterSector,
                  kbAccepted,
                  webTopUpFetched,
                  webTopUpInsertedToKbV2,
                  webTopUpRejected,
                  webAccepted,
                  finalProspectCount: prospectCount,
                  stopReason: stopReason || "RUNNING",
                  braveRequestsUsed,
                },
              });
            }
          }
          if (stopReason) break;
        }
        if (stopReason) break;
      }

      console.log(`[WEB_TOPUP] END: fetched=${webTopUpFetched}, kbSaved=${webTopUpInsertedToKbV2}, rejected=${webTopUpRejected}, accepted=${webAccepted}, total=${prospectCount}`);
    } else {
      console.log(`[WEB_TOPUP] SKIPPED (target reached or time budget)`);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // FINALIZE
    // ════════════════════════════════════════════════════════════════════════════
    const finalProspects = await base44.entities.Prospect.filter({ campaignId });
    let finalStatus;

    if (prospectCount >= targetCount) {
      finalStatus = "DONE"; errorMessage = null;
    } else if (prospectCount > 0) {
      finalStatus = "DONE_PARTIAL";
      errorMessage = `${prospectCount}/${targetCount} prospects trouvés. Raison: ${stopReason || "filtres trop stricts"}. Relancez pour enrichir via WEB_TOPUP.`;
    } else {
      finalStatus = "FAILED";
      errorMessage = "Aucun prospect trouvé. Vérifiez vos critères.";
    }

    const finalToolUsage = {
      kbV2InitialCount,
      kbV2CandidatesAfterFilters: kbV2CandidatesAfterSector,
      kbAccepted,
      webTopUpFetched,
      webTopUpInsertedToKbV2,
      webTopUpRejected,
      webAccepted,
      finalProspectCount: prospectCount,
      stopReason: stopReason || (finalStatus === "DONE" ? "TARGET_REACHED" : "PARTIAL"),
      braveRequestsUsed,
      brave429Count: braveRLState.count429,
      errorMessage: errorMessage || null,
    };

    console.log(`[FINAL] status=${finalStatus} kb=${kbAccepted} web=${webAccepted} kbV2Saved=${webTopUpInsertedToKbV2} total=${prospectCount}/${targetCount}`);

    await base44.entities.Campaign.update(campaignId, {
      status: finalStatus,
      progressPct: 100,
      countProspects: finalProspects.length,
      countAnalyzed: finalProspects.filter(p => ["ANALYSÉ","QUALIFIÉ","REJETÉ","EXPORTÉ"].includes(p.status)).length,
      countQualified: finalProspects.filter(p => p.status === "QUALIFIÉ").length,
      countRejected: finalProspects.filter(p => p.status === "REJETÉ").length,
      errorMessage: errorMessage || null,
      toolUsage: finalToolUsage,
    });

    await base44.entities.ActivityLog.create({
      ownerUserId: campaign.ownerUserId,
      actionType: "RUN_PROSPECT_SEARCH",
      entityType: "Campaign",
      entityId: campaignId,
      payload: finalToolUsage,
      status: finalStatus === "FAILED" ? "ERROR" : "SUCCESS",
      errorMessage: finalStatus === "FAILED" ? errorMessage : null,
    });

    return Response.json({
      success: true,
      campaignId,
      prospectCount,
      kbAccepted,
      webAccepted,
      webTopUpInsertedToKbV2,
      status: finalStatus,
      stopReason,
      toolUsage: finalToolUsage,
    });

  } catch (error) {
    console.error("[ERROR]", error.message);
    const errMsg = error.message || "Erreur lors de la recherche";
    await base44.entities.Campaign.update(campaignId, {
      status: "FAILED",
      errorMessage: errMsg,
      progressPct: 0,
      toolUsage: { kbAccepted, webAccepted, webTopUpInsertedToKbV2, errorMessage: errMsg, stopReason: "EXCEPTION" },
    });
    return Response.json({ error: errMsg, status: "FAILED" }, { status: 500 });
  }
});