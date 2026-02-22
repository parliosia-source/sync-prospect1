import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Dictionnaire de synonymes par secteur ──────────────────────────────────────
// Utilisé pour le matching ET la classification
const SECTOR_SYNONYMS = {
  "Technologie": ["IT", "informatique", "SaaS", "logiciel", "software", "cloud", "IA", "AI", "numérique",
    "digital", "cybersécurité", "cybersecurity", "données", "data", "développement", "development",
    "startup", "tech", "infrastructure", "DevOps", "application", "plateforme", "platform", "réseau",
    "network", "API", "programmation", "coding", "système", "system", "ERP", "CRM"],
  "Finance & Assurance": ["banque", "bank", "assurance", "insurance", "crédit", "credit", "prêt", "loan",
    "placement", "investissement", "investment", "hypothèque", "mortgage", "courtage", "brokerage",
    "fonds", "fund", "retraite", "pension", "actuaire", "fintech", "capital", "trésorerie", "treasury",
    "actions", "obligations", "portefeuille", "épargne"],
  "Santé & Pharma": ["santé", "health", "pharma", "pharmacie", "pharmacy", "médical", "medical", "hôpital",
    "hospital", "clinique", "clinic", "médecin", "physician", "chirurgie", "surgery", "diagnostic",
    "thérapie", "therapy", "laboratoire", "laboratory", "bien-être", "wellness", "soin", "care",
    "infirmier", "nurse", "dentiste", "dentist", "optométriste"],
  "Gouvernement & Public": ["gouvernement", "government", "municipalité", "municipality", "ville", "city",
    "province", "fédéral", "federal", "ministère", "ministry", "parlement", "parliament",
    "assemblée", "assembly", "CISSS", "CIUSSS", "agence", "organisme public", "administration"],
  "Éducation & Formation": ["université", "university", "collège", "college", "école", "school", "cégep",
    "formation", "training", "cours", "course", "apprentissage", "learning", "étudiant", "student",
    "professeur", "professor", "diplôme", "degree", "certification", "bootcamp", "académie"],
  "Associations & OBNL": ["association", "OBNL", "NPO", "fondation", "foundation", "organisme",
    "charitable", "bénévole", "volunteer", "cause sociale", "ONG", "NGO", "syndicat",
    "communautaire", "community", "mission", "ordre professionnel"],
  "Immobilier": ["immobilier", "real estate", "propriété", "property", "construction", "promoteur",
    "developer", "courtier immobilier", "agent immobilier", "logement", "housing", "bureau",
    "commercial", "bâtiment", "building", "terrain", "lot", "condo", "locatif", "REIT",
    "hypothèque", "gestion immobilière"],
  "Droit & Comptabilité": ["avocat", "lawyer", "droit", "law", "comptable", "accountant",
    "comptabilité", "accounting", "juridique", "legal", "notaire", "notary", "cabinet", "firm",
    "fiscalité", "tax", "audit", "conformité", "compliance", "fiducie", "trust", "médiateur",
    "arbitrage", "CPA", "juge"],
  "Industrie & Manufacture": ["usine", "factory", "manufacture", "fabrication", "production",
    "industrie", "industry", "acier", "steel", "chimie", "chemistry", "mécanique", "mechanics",
    "automatisation", "automation", "assemblage", "assembly", "outillage", "machinerie",
    "ingénierie", "engineering", "fournisseur", "supplier", "équipement"],
  "Commerce de détail": ["commerce", "retail", "magasin", "store", "boutique", "vente", "sale",
    "détaillant", "retailer", "marchandise", "merchandise", "épicerie", "grocery", "e-commerce",
    "électronique", "mode", "fashion", "alimentation", "franchise", "grande surface"],
  "Transport & Logistique": ["transport", "logistique", "logistics", "camion", "truck", "livraison",
    "delivery", "cargo", "fret", "freight", "chauffeur", "driver", "port", "aéroport", "airport",
    "entrepôt", "warehouse", "courrier", "courier", "distribution", "chaîne d'approvisionnement",
    "supply chain", "transitaire", "maritime", "ferroviaire"],
};

// Construit les règles de matching depuis les synonymes
function buildSectorRules() {
  const rules = {};
  for (const [sector, synonyms] of Object.entries(SECTOR_SYNONYMS)) {
    // Les 12 premiers synonymes = strong (+2), le reste = weak (+1)
    rules[sector] = {
      includeStrong: synonyms.slice(0, 12).map(s => s.toLowerCase()),
      includeWeak: synonyms.slice(12).map(s => s.toLowerCase()),
      excludeStrong: ["blog", "news", "presse", "press", "événements", "award", "emploi", "job",
        "directory", "classement", "ranking", "top", "annuaire"],
    };
  }
  return rules;
}

const SECTOR_RULES = buildSectorRules();
const ALL_SECTORS = Object.keys(SECTOR_SYNONYMS);

const STRONG_GLOBAL_EXCLUDES = /\b(blog|news|presse|press|award|gala|emploi|job|directory|classement|ranking|top)\b/i;

// ── Dictionnaire de villes/provinces canadiennes ────────────────────────────────
const PROVINCE_MAP = {
  "québec": "QC", "quebec": "QC", "qc": "QC",
  "ontario": "ON", "on": "ON",
  "colombie-britannique": "BC", "british columbia": "BC", "bc": "BC",
  "alberta": "AB", "ab": "AB",
  "manitoba": "MB", "mb": "MB",
  "nouvelle-écosse": "NS", "nova scotia": "NS", "ns": "NS",
  "nouveau-brunswick": "NB", "new brunswick": "NB", "nb": "NB",
  "saskatchewan": "SK", "sk": "SK",
  "terre-neuve": "NL", "newfoundland": "NL", "nl": "NL",
  "île-du-prince-édouard": "PE", "prince edward island": "PE", "pei": "PE",
  "yukon": "YT", "yt": "YT",
  "territoires du nord-ouest": "NT", "northwest territories": "NT", "nt": "NT",
  "nunavut": "NU", "nu": "NU",
};

const MAJOR_CITIES = {
  "montréal": "Montréal", "montreal": "Montréal",
  "québec": "Québec", "quebec city": "Québec",
  "toronto": "Toronto",
  "vancouver": "Vancouver",
  "calgary": "Calgary",
  "edmonton": "Edmonton",
  "ottawa": "Ottawa",
  "winnipeg": "Winnipeg",
  "laval": "Laval",
  "longueuil": "Longueuil",
  "gatineau": "Gatineau",
  "sherbrooke": "Sherbrooke",
  "saguenay": "Saguenay",
  "lévis": "Lévis", "levis": "Lévis",
  "terrebonne": "Terrebonne",
  "brossard": "Brossard",
};

function parseLocation(hqLocation) {
  if (!hqLocation) return {};
  const raw = hqLocation.toLowerCase();
  let city = null, province = null;

  // Match city
  for (const [key, val] of Object.entries(MAJOR_CITIES)) {
    if (raw.includes(key)) { city = val; break; }
  }

  // Match province
  for (const [key, val] of Object.entries(PROVINCE_MAP)) {
    // Must be word boundary or after comma/space
    if (new RegExp(`(^|,|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|,|$)`).test(raw)) {
      province = val;
      break;
    }
  }

  return { city, province, country: "CA" };
}

function normText(t) {
  return (t || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, " ").replace(/[^\w\s]/g, " ");
}

function matchSectorsBackfill(fullText, sectors) {
  const matched = [];
  const textNorm = normText(fullText);

  if (STRONG_GLOBAL_EXCLUDES.test(fullText)) return [];

  for (const sector of sectors) {
    const rules = SECTOR_RULES[sector];
    if (!rules) continue;

    let score = 0;
    for (const kw of rules.includeStrong) {
      const kwNorm = normText(kw);
      if (textNorm.includes(kwNorm)) score += 2;
    }
    for (const kw of rules.includeWeak) {
      const kwNorm = normText(kw);
      if (textNorm.includes(kwNorm)) score += 1;
    }
    for (const kw of rules.excludeStrong) {
      const kwNorm = normText(kw);
      if (textNorm.includes(kwNorm)) score -= 3;
    }

    if (score >= 2) matched.push({ sector, score });
  }

  // Sort by score, return sector names
  return matched.sort((a, b) => b.score - a.score).map(m => m.sector);
}

// Extraire des keywords pertinents depuis name/notes/tags
function extractKeywords(kb) {
  const words = normText(`${kb.name || ""} ${kb.notes || ""} ${(kb.tags || []).join(" ")}`).split(/\s+/);
  const stopwords = new Set(["le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "au", "aux", "the", "of", "and", "in", "a", "an"]);
  return [...new Set(words.filter(w => w.length > 4 && !stopwords.has(w)))].slice(0, 10);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;
  const limit = body.limit || 2000;
  const onlyEmpty = body.onlyEmpty !== false; // Par défaut: ne traite que ceux sans sectors
  const fillLocation = body.fillLocation !== false; // Aussi parser hqLocation → hqCity/hqProvince

  console.log(`[BACKFILL] START: dryRun=${dryRun}, limit=${limit}, onlyEmpty=${onlyEmpty}, fillLocation=${fillLocation}`);

  let scanned = 0;
  let updatedSectors = 0;
  let updatedLocation = 0;
  let skippedAlreadyFilled = 0;
  let skippedLowConfidence = 0;
  const bySector = {};
  const sampleUpdated = [];

  ALL_SECTORS.forEach(s => { bySector[s] = 0; });

  let page = 0;
  const pageSize = 500;
  let done = false;

  while (!done) {
    const batch = await base44.asServiceRole.entities.KBEntity.list(
      '-updated_date', pageSize, page * pageSize
    ).catch(() => []);

    if (!batch || batch.length === 0) break;
    console.log(`[BACKFILL] page=${page} fetched=${batch.length}, scanned=${scanned}`);

    for (const kb of batch) {
      if (scanned >= limit) { done = true; break; }
      scanned++;

      const hasSectors = Array.isArray(kb.industrySectors) && kb.industrySectors.length > 0;
      const hasCity = !!kb.hqCity;

      // Skip if everything already filled
      if (onlyEmpty && hasSectors && hasCity) {
        skippedAlreadyFilled++;
        continue;
      }

      const updates = {};

      // ── 1. Sector matching ─────────────────────────────────────────────────
      if (!hasSectors) {
        const fullText = [
          kb.name || "",
          kb.domain || "",
          (Array.isArray(kb.tags) ? kb.tags.join(" ") : ""),
          kb.notes || "",
          (Array.isArray(kb.keywords) ? kb.keywords.join(" ") : ""),
        ].join(" ");

        const matched = matchSectorsBackfill(fullText, ALL_SECTORS);

        if (matched.length > 0) {
          updates.industrySectors = matched;
          updates.industryLabel = matched[0];
          updatedSectors++;
          matched.forEach(s => { if (bySector[s] !== undefined) bySector[s]++; });
          if (sampleUpdated.length < 10) {
            sampleUpdated.push({ domain: kb.domain, name: kb.name, sectors: matched, industryLabel: matched[0] });
          }
        } else {
          skippedLowConfidence++;
        }
      }

      // ── 2. Location parsing ────────────────────────────────────────────────
      if (fillLocation && !hasCity && kb.hqLocation) {
        const { city, province } = parseLocation(kb.hqLocation);
        if (city) { updates.hqCity = city; updatedLocation++; }
        if (province) updates.hqProvince = province;
        if (!kb.hqCountry) updates.hqCountry = "CA";
      }

      // ── 3. Keywords extraction ─────────────────────────────────────────────
      if (!Array.isArray(kb.keywords) || kb.keywords.length === 0) {
        const kws = extractKeywords(kb);
        if (kws.length > 0) updates.keywords = kws;
      }

      // Apply updates
      if (Object.keys(updates).length > 0 && !dryRun) {
        await base44.asServiceRole.entities.KBEntity.update(kb.id, updates).catch(err => {
          console.error(`[BACKFILL] update failed for ${kb.id}:`, err.message);
        });
      }
    }

    if (done) break;
    if (batch.length < pageSize) break;
    page++;
    if (page >= 20) { console.log(`[BACKFILL] safety stop: page=${page}`); break; }
  }

  console.log(`[BACKFILL] END: scanned=${scanned}, updatedSectors=${updatedSectors}, updatedLocation=${updatedLocation}`);

  return Response.json({
    scanned,
    updatedSectors,
    updatedLocation,
    skippedAlreadyFilled,
    skippedLowConfidence,
    bySector: Object.fromEntries(Object.entries(bySector).filter(([_, c]) => c > 0).sort((a, b) => b[1] - a[1])),
    sampleUpdated,
    dryRun,
    synonymsPerSector: Object.fromEntries(Object.entries(SECTOR_SYNONYMS).map(([s, syns]) => [s, syns.length])),
  });
});