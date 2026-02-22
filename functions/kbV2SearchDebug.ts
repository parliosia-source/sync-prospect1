import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

const GM_CITIES_NORM = new Set([
  "montreal","laval","longueuil","brossard","terrebonne","repentigny","boucherville",
  "dorval","pointe-claire","kirkland","beaconsfield","saint-lambert","westmount",
  "mont-royal","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","saint-jerome","blainville","boisbriand","mascouche","mirabel",
  "la-prairie","chateauguay","candiac","laprairie","saint-jean-sur-richelieu",
  "vaudreuil-dorion","les-coteaux","sainte-catherine","sainte-julie","varennes",
  "montreal-est","montreal-nord","montreal-ouest","lachine","rosemont","villeray",
  "hochelaga","riviere-des-prairies","saint-leonard","ahuntsic","mtl",
  "grand montreal","greater montreal","grand-montreal",
]);

function isGmQuery(locationQuery) {
  const norm = normText(locationQuery);
  if (GM_CITIES_NORM.has(norm)) return true;
  for (const token of norm.split(/[\s,]+/)) {
    if (GM_CITIES_NORM.has(token)) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { locationQuery = "Montréal", industrySectors = [] } = body;

  const isMTL = isGmQuery(locationQuery);
  const locNorm = normText(locationQuery);
  const isQC = /qu[eé]bec|qc/.test(locNorm) || isMTL;

  // Load all KBEntityV2
  let all = [];
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-confidenceScore', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;
  }

  const totalKB = all.length;
  const rejectLog = { region: [], sector: [], missingFields: [] };
  let afterRegion = [];
  let afterSector = [];

  // Step 1: missing fields
  const withFields = all.filter(e => {
    if (!e.domain || !e.website || !e.name) { rejectLog.missingFields.push({ domain: e.domain, name: e.name, reason: "missing domain/website/name" }); return false; }
    return true;
  });

  // Step 2: region filter
  for (const e of withFields) {
    let pass = true;
    let reason = null;
    if (isMTL && !["MTL","GM"].includes(e.hqRegion)) {
      pass = false; reason = `hqRegion=${e.hqRegion} (expected MTL or GM)`;
    } else if (!isMTL && isQC && !["MTL","GM","QC_OTHER"].includes(e.hqRegion) && e.hqProvince !== "QC") {
      pass = false; reason = `hqRegion=${e.hqRegion}, hqProvince=${e.hqProvince} (expected QC)`;
    }
    if (pass) afterRegion.push(e);
    else rejectLog.region.push({ domain: e.domain, name: e.name, reason });
  }

  // Step 3: sector filter
  for (const e of afterRegion) {
    if (industrySectors.length === 0) { afterSector.push(e); continue; }
    const kbSectors = Array.isArray(e.industrySectors) ? e.industrySectors : [];
    const match = kbSectors.some(s => industrySectors.includes(s));
    if (match) afterSector.push(e);
    else rejectLog.sector.push({ domain: e.domain, name: e.name, entityType: e.entityType, industrySectors: kbSectors, reason: `No intersection with [${industrySectors.join(",")}]` });
  }

  afterSector.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));

  // Entity type breakdown
  const entityTypeCounts = {};
  for (const e of afterSector) {
    const t = e.entityType || "UNKNOWN";
    entityTypeCounts[t] = (entityTypeCounts[t] || 0) + 1;
  }

  // Sector breakdown
  const sectorCounts = {};
  for (const e of afterSector) {
    for (const s of (e.industrySectors || [])) {
      sectorCounts[s] = (sectorCounts[s] || 0) + 1;
    }
  }

  const accepted = afterSector.slice(0, 30).map(e => ({
    name: e.name,
    domain: e.domain,
    hqCity: e.hqCity,
    hqRegion: e.hqRegion,
    hqProvince: e.hqProvince,
    entityType: e.entityType,
    industrySectors: e.industrySectors,
    confidenceScore: e.confidenceScore,
  }));

  return Response.json({
    locationQuery,
    industrySectors,
    filters: { isMTL, isQC },
    totalKB,
    afterMissingFieldsFilter: withFields.length,
    afterRegionFilter: afterRegion.length,
    afterSectorFilter: afterSector.length,
    entityTypeCounts,
    sectorCounts,
    rejectSummary: {
      missingFields: rejectLog.missingFields.length,
      byRegion: rejectLog.region.length,
      bySector: rejectLog.sector.length,
    },
    rejectedRegionSample: rejectLog.region.slice(0, 10),
    rejectedSectorSample: rejectLog.sector.slice(0, 10),
    accepted,
  });
});