import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Sector Rules (simplified from runProspectSearch) ──────────────────────────
const SECTOR_RULES = {
  "Technologie": {
    includeStrong: ["logiciel", "software", "saas", "cloud", "ia", "ai", "digital", "tech", "cybersecurity", "sécurité", "développement", "development", "startup", "innovation", "données", "data"],
    includeWeak: ["solution", "plateforme", "platform", "réseau", "network", "applicat"],
    excludeStrong: ["blog", "news", "presse", "press", "événement", "event", "emploi", "job", "formation"],
  },
  "Finance & Assurance": {
    includeStrong: ["banque", "bank", "assurance", "insurance", "crédit", "credit", "prêt", "loan", "placement", "investissement", "investment", "hypothèque", "mortgage", "courtage", "brokerage", "fonds", "fund"],
    includeWeak: ["service", "conseil", "advice", "gestion", "management"],
    excludeStrong: ["blog", "emploi", "job", "news"],
  },
  "Gouvernement & Public": {
    includeStrong: ["gouvernement", "government", "municipalité", "municipality", "ville", "city", "province", "état", "state", "federal", "fédéral", "ministère", "ministry", "parlement", "parliament", "assemblée", "assembly"],
    includeWeak: ["service public", "public service"],
    excludeStrong: ["commercial", "business", "privé", "private"],
  },
  "Santé & Pharma": {
    includeStrong: ["santé", "health", "pharma", "pharmacy", "pharmacie", "médical", "medical", "hôpital", "hospital", "clinique", "clinic", "médecin", "physician", "chirurgie", "surgery", "diagnostic", "labocaroire", "laboratory", "thérapie", "therapy"],
    includeWeak: ["bien-être", "wellness", "soin", "care"],
    excludeStrong: ["blog", "news"],
  },
  "Éducation & Formation": {
    includeStrong: ["université", "university", "college", "collège", "école", "school", "cégep", "formation", "training", "cours", "course", "apprentissage", "learning", "étudiant", "student", "professeur", "professor"],
    includeWeak: ["éducation", "education"],
    excludeStrong: ["news", "blog"],
  },
  "Commerce de détail": {
    includeStrong: ["commerce", "retail", "magasin", "store", "boutique", "vente", "sale", "détaillant", "retailer", "marchandise", "merchandise", "produit", "product", "épicerie", "grocery", "pharmacie"],
    includeWeak: ["distribution", "vente"],
    excludeStrong: ["blog", "wholesale"],
  },
  "Transport & Logistique": {
    includeStrong: ["transport", "logistics", "logistique", "camion", "truck", "livraison", "delivery", "cargo", "fret", "freight", "chauffeur", "driver", "port", "aéroport", "airport"],
    includeWeak: ["courrier", "courier"],
    excludeStrong: ["blog", "news"],
  },
  "Immobilier": {
    includeStrong: ["immobilier", "real estate", "propriété", "property", "construction", "développement", "development", "promoteur", "developer", "courtier", "broker", "location", "rental"],
    includeWeak: ["terrain", "land"],
    excludeStrong: ["blog", "news"],
  },
  "Industrie & Manufacture": {
    includeStrong: ["usine", "factory", "manufacture", "fabrication", "production", "industrie", "industry", "acier", "steel", "papier", "paper", "chimie", "chemistry", "mécanique", "mechanics"],
    includeWeak: ["procédé", "process"],
    excludeStrong: ["blog", "news"],
  },
  "Droit & Comptabilité": {
    includeStrong: ["avocat", "lawyer", "droit", "law", "comptable", "accountant", "comptabilité", "accounting", "juridique", "legal", "notaire", "notary", "cabinet", "firm"],
    includeWeak: ["conseil", "advice"],
    excludeStrong: ["blog"],
  },
  "Associations & OBNL": {
    includeStrong: ["association", "obnl", "npo", "fondation", "foundation", "caritative", "charitable", "bénévole", "volunteer", "cause"],
    includeWeak: ["communauté", "community"],
    excludeStrong: ["commercial", "business"],
  },
};

const STRONG_GLOBAL_EXCLUDES = /\b(blog|news|presse|press|eventos|événements|award|gala|emploi|job|directory|map|classement|ranking|top)\b/i;

function normText(t) {
  return (t || "").toLowerCase().replace(/[^\w\s]/g, " ");
}

function matchSectorsBackfill(fullText, sectors) {
  const matched = [];
  const scores = {};

  for (const sector of sectors) {
    const rules = SECTOR_RULES[sector];
    if (!rules) continue;

    // Quick fail: strong global exclude
    if (STRONG_GLOBAL_EXCLUDES.test(fullText)) {
      scores[sector] = -10;
      continue;
    }

    let score = 0;
    const textNorm = normText(fullText);

    // Include strong (+2 each)
    for (const kw of rules.includeStrong) {
      const count = (textNorm.match(new RegExp(`\\b${normText(kw)}\\b`, "g")) || []).length;
      score += count * 2;
    }

    // Include weak (+1 each)
    for (const kw of rules.includeWeak) {
      const count = (textNorm.match(new RegExp(`\\b${normText(kw)}\\b`, "g")) || []).length;
      score += count * 1;
    }

    // Exclude strong (-3 each)
    for (const kw of rules.excludeStrong) {
      const count = (textNorm.match(new RegExp(`\\b${normText(kw)}\\b`, "g")) || []).length;
      score -= count * 3;
    }

    scores[sector] = score;

    // THRESHOLD = 3 minimum confidence
    if (score >= 3) {
      matched.push(sector);
    }
  }

  return { matched, scores };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false; // default true
  const limit = body.limit || 500;

  console.log(`[BACKFILL] START: dryRun=${dryRun}, limit=${limit}`);

  const sectors = Object.keys(SECTOR_RULES);
  let scanned = 0;
  let updated = 0;
  let skippedAlreadyFilled = 0;
  let skippedLowConfidence = 0;
  const bySector = {};
  const sampleUpdated = [];

  // Initialize sector counts
  sectors.forEach(s => {
    bySector[s] = 0;
  });

  // Paginate KBEntity
  let page = 0;
  const pageSize = 500;

  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntity.list(
      '-updated_date',
      pageSize,
      page * pageSize
    ).catch(() => []);

    if (!batch || batch.length === 0) break;

    console.log(`[BACKFILL] page=${page} fetched=${batch.length}`);

    for (const kb of batch) {
      scanned++;

      // Skip if already filled
      if (Array.isArray(kb.industrySectors) && kb.industrySectors.length > 0) {
        skippedAlreadyFilled++;
        continue;
      }

      // Build full text
      const fullText = [
        kb.name || "",
        kb.domain || "",
        (Array.isArray(kb.tags) ? kb.tags.join(" ") : ""),
        kb.notes || "",
      ]
        .join(" ")
        .toLowerCase();

      // Match sectors
      const { matched } = matchSectorsBackfill(fullText, sectors);

      if (matched.length === 0) {
        skippedLowConfidence++;
        continue;
      }

      updated++;

      // Track by sector
      matched.forEach(s => {
        bySector[s]++;
      });

      // Collect sample (first 10)
      if (sampleUpdated.length < 10) {
        sampleUpdated.push({
          domain: kb.domain,
          name: kb.name,
          sectors: matched,
          industryLabel: matched[0] || null,
        });
      }

      // Update if not dryRun
      if (!dryRun) {
        await base44.asServiceRole.entities.KBEntity.update(kb.id, {
          industrySectors: matched,
          industryLabel: matched[0] || null,
        }).catch(err => {
          console.error(`[BACKFILL] update failed for ${kb.id}:`, err.message);
        });
      }

      if (scanned >= limit) {
        console.log(`[BACKFILL] limit reached: scanned=${scanned}`);
        break;
    }

    if (scanned >= limit) break;
    page++;

    // Safety: stop after 20 pages
    if (page >= 20) {
      console.log(`[BACKFILL] safety stop: page=${page}`);
      break;
    }
  }

  console.log(
    `[BACKFILL] END: scanned=${scanned}, updated=${updated}, alreadyFilled=${skippedAlreadyFilled}, lowConf=${skippedLowConfidence}`
  );

  const result = {
    scanned,
    updated,
    skippedAlreadyFilled,
    skippedLowConfidence,
    bySector: Object.fromEntries(
      Object.entries(bySector)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
    ),
    sampleUpdated,
    dryRun,
  };

  return Response.json(result);
});