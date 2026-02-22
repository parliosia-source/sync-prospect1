import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Dictionnaire de synonymes par secteur ──────────────────────────────────────
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

function buildSectorRules() {
  const rules = {};
  for (const [sector, synonyms] of Object.entries(SECTOR_SYNONYMS)) {
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

// ── Location parser ────────────────────────────────────────────────────────────
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
  "toronto": "Toronto", "vancouver": "Vancouver",
  "calgary": "Calgary", "edmonton": "Edmonton",
  "ottawa": "Ottawa", "winnipeg": "Winnipeg",
  "laval": "Laval", "longueuil": "Longueuil",
  "gatineau": "Gatineau", "sherbrooke": "Sherbrooke",
  "saguenay": "Saguenay", "lévis": "Lévis", "levis": "Lévis",
  "terrebonne": "Terrebonne", "brossard": "Brossard",
};

function parseLocation(hqLocation) {
  if (!hqLocation) return {};
  const raw = hqLocation.toLowerCase();
  let city = null, province = null;
  for (const [key, val] of Object.entries(MAJOR_CITIES)) {
    if (raw.includes(key)) { city = val; break; }
  }
  for (const [key, val] of Object.entries(PROVINCE_MAP)) {
    if (new RegExp(`(^|,|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|,|$)`).test(raw)) {
      province = val; break;
    }
  }
  return { city, province, country: "CA" };
}

function normText(t) {
  return (t || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, " ").replace(/[^\w\s]/g, " ");
}

function matchSectorsBackfill(fullText) {
  const matched = [];
  const textNorm = normText(fullText);
  if (STRONG_GLOBAL_EXCLUDES.test(fullText)) return [];
  for (const sector of ALL_SECTORS) {
    const rules = SECTOR_RULES[sector];
    if (!rules) continue;
    let score = 0;
    for (const kw of rules.includeStrong) { if (textNorm.includes(normText(kw))) score += 2; }
    for (const kw of rules.includeWeak)   { if (textNorm.includes(normText(kw))) score += 1; }
    for (const kw of rules.excludeStrong) { if (textNorm.includes(normText(kw))) score -= 3; }
    if (score >= 2) matched.push({ sector, score });
  }
  return matched.sort((a, b) => b.score - a.score).map(m => m.sector);
}

function extractKeywords(kb) {
  const words = normText(`${kb.name || ""} ${kb.notes || ""} ${(kb.tags || []).join(" ")}`).split(/\s+/);
  const stopwords = new Set(["le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "au", "aux", "the", "of", "and", "in", "a", "an"]);
  return [...new Set(words.filter(w => w.length > 4 && !stopwords.has(w)))].slice(0, 10);
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun        = body.dryRun !== false;
  const startOffset   = body.offset || 0;          // Cursor: start at this global offset
  const batchSize     = body.batchSize || 500;      // Entities per page (max 500)
  const maxEntities   = body.maxEntities || 5000;   // Hard cap per call
  const fillLocation  = body.fillLocation !== false;
  const forceAll      = body.forceAll === true;     // If true, re-process even already-filled entities

  console.log(`[BACKFILL] START offset=${startOffset} batchSize=${batchSize} maxEntities=${maxEntities} dryRun=${dryRun} forceAll=${forceAll}`);

  let scanned = 0;
  let updatedSectors = 0;
  let updatedLocation = 0;
  let updatedKeywords = 0;
  let skippedAlreadyFilled = 0;
  let skippedLowConfidence = 0;
  let lastProcessedOffset = startOffset;
  let hasMore = false;
  const bySector = {};
  const sampleUpdated = [];
  ALL_SECTORS.forEach(s => { bySector[s] = 0; });

  let globalOffset = startOffset;

  while (scanned < maxEntities) {
    const toFetch = Math.min(batchSize, maxEntities - scanned);
    const batch = await base44.asServiceRole.entities.KBEntity.list(
      '-created_date', toFetch, globalOffset
    ).catch(() => []);

    if (!batch || batch.length === 0) { hasMore = false; break; }
    console.log(`[BACKFILL] offset=${globalOffset} fetched=${batch.length} scanned_so_far=${scanned}`);

    for (const kb of batch) {
      scanned++;
      lastProcessedOffset = globalOffset + scanned;

      const hasSectors = Array.isArray(kb.industrySectors) && kb.industrySectors.length > 0;
      const hasCity    = !!kb.hqCity;
      const hasKeywords = Array.isArray(kb.keywords) && kb.keywords.length > 0;

      // Skip if fully enriched (unless forceAll)
      if (!forceAll && hasSectors && hasCity && hasKeywords) {
        skippedAlreadyFilled++;
        continue;
      }

      const updates = {};

      // 1. Sector matching
      if (!hasSectors || forceAll) {
        const fullText = [kb.name || "", kb.domain || "",
          (Array.isArray(kb.tags) ? kb.tags.join(" ") : ""),
          kb.notes || "",
          (Array.isArray(kb.keywords) ? kb.keywords.join(" ") : ""),
        ].join(" ");

        const matched = matchSectorsBackfill(fullText);
        if (matched.length > 0) {
          updates.industrySectors = matched;
          updates.industryLabel = matched[0];
          updatedSectors++;
          matched.forEach(s => { if (bySector[s] !== undefined) bySector[s]++; });
          if (sampleUpdated.length < 10) {
            sampleUpdated.push({ domain: kb.domain, name: kb.name, sectors: matched });
          }
        } else {
          skippedLowConfidence++;
        }
      }

      // 2. Location parsing
      if (fillLocation && (!hasCity || forceAll) && kb.hqLocation) {
        const { city, province } = parseLocation(kb.hqLocation);
        if (city)     { updates.hqCity = city; updatedLocation++; }
        if (province) { updates.hqProvince = province; }
        if (!kb.hqCountry) updates.hqCountry = "CA";
      }

      // 3. Keywords extraction
      if (!hasKeywords || forceAll) {
        const kws = extractKeywords(kb);
        if (kws.length > 0) { updates.keywords = kws; updatedKeywords++; }
      }

      if (Object.keys(updates).length > 0 && !dryRun) {
        await base44.asServiceRole.entities.KBEntity.update(kb.id, updates).catch(err => {
          console.error(`[BACKFILL] update failed ${kb.id}: ${err.message}`);
        });
      }
    }

    globalOffset += batch.length;

    // If we got fewer records than requested, we've reached the end
    if (batch.length < toFetch) { hasMore = false; break; }

    hasMore = true;
  }

  // If we hit maxEntities but got a full batch, there's likely more
  if (scanned >= maxEntities && hasMore) {
    hasMore = true;
  }

  console.log(`[BACKFILL] END scanned=${scanned} updatedSectors=${updatedSectors} updatedLocation=${updatedLocation} nextOffset=${lastProcessedOffset} hasMore=${hasMore}`);

  return Response.json({
    scanned,
    updatedSectors,
    updatedLocation,
    updatedKeywords,
    skippedAlreadyFilled,
    skippedLowConfidence,
    nextOffset: lastProcessedOffset,
    hasMore,
    bySector: Object.fromEntries(
      Object.entries(bySector).filter(([_, c]) => c > 0).sort((a, b) => b[1] - a[1])
    ),
    sampleUpdated,
    dryRun,
  });
});