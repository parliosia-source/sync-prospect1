import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

// All cities in the Greater Montreal area → hqRegion=MTL
const MTL_CITIES = new Set([
  "montreal","laval","longueuil","brossard","terrebonne","repentigny","boucherville",
  "dorval","pointe-claire","kirkland","beaconsfield","saint-lambert","westmount",
  "mont-royal","cote-saint-luc","verdun","anjou","outremont","pierrefonds","lasalle",
  "saint-laurent","saint-jerome","blainville","boisbriand","mascouche","mirabel",
  "la-prairie","chateauguay","candiac","laprairie","saint-jean-sur-richelieu",
  "vaudreuil-dorion","les-coteaux","sainte-catherine","sainte-julie","varennes",
  "brossard","montreal-est","montreal-nord","montreal-ouest","lachine","mercier",
  "rosemont","plateau","villeray","hochelaga","riviere-des-prairies","saint-leonard",
  "bordeaux","cartierville","ahuntsic","montrial","mtl",
]);

function isMtlQuery(locationQuery) {
  const norm = normText(locationQuery);
  // Direct match against city list
  if (MTL_CITIES.has(norm)) return true;
  // Also match if any token matches (e.g. "Laval, QC")
  for (const token of norm.split(/[,\s]+/)) {
    if (MTL_CITIES.has(token)) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { locationQuery = "Montréal", industrySectors = [] } = body;

  const locNorm = normText(locationQuery);
  const isMTL = isMtlQuery(locationQuery);
  const isQC = /qu[eé]bec|qc/.test(locNorm) && !isMTL;

  // Load all KBEntityV2
  let all = [];
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-confidenceScore', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    if (batch.length < 500) break;
    page++;
    if (page >= 10) break;
  }

  const totalKB = all.length;

  // Region filter
  let afterRegion = [];
  const regionRejects = [];
  for (const e of all) {
    let pass = true;
    let reason = null;
    if (isMTL && e.hqRegion !== "MTL") {
      pass = false; reason = `hqRegion=${e.hqRegion} (wanted MTL)`;
    } else if (isQC && !["MTL", "QC_OTHER"].includes(e.hqRegion) && e.hqProvince !== "QC") {
      pass = false; reason = `hqRegion=${e.hqRegion}, hqProvince=${e.hqProvince} (wanted QC)`;
    }
    if (pass) afterRegion.push(e);
    else regionRejects.push({ domain: e.domain, name: e.name, reason });
  }

  // Sector filter
  let afterSector = [];
  const sectorRejects = [];
  for (const e of afterRegion) {
    if (industrySectors.length === 0) { afterSector.push(e); continue; }
    const kbSectors = Array.isArray(e.industrySectors) ? e.industrySectors : [];
    const match = kbSectors.some(s => industrySectors.includes(s));
    if (match) afterSector.push(e);
    else sectorRejects.push({ domain: e.domain, name: e.name, industrySectors: kbSectors, reason: `No intersection with ${industrySectors.join(",")}` });
  }

  // Sort by confidenceScore desc
  afterSector.sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0));

  const accepted = afterSector.slice(0, 20).map(e => ({
    name: e.name,
    domain: e.domain,
    hqCity: e.hqCity,
    hqRegion: e.hqRegion,
    hqProvince: e.hqProvince,
    industrySectors: e.industrySectors,
    industryLabel: e.industryLabel,
    confidenceScore: e.confidenceScore,
    entityType: e.entityType,
  }));

  const rejected = [
    ...regionRejects.slice(0, 10).map(r => ({ ...r, rejectStage: "REGION" })),
    ...sectorRejects.slice(0, 10).map(r => ({ ...r, rejectStage: "SECTOR" })),
  ].slice(0, 20);

  return Response.json({
    locationQuery,
    industrySectors,
    filters: { isMTL, isQC },
    totalKB,
    afterRegionFilter: afterRegion.length,
    afterSectorFilter: afterSector.length,
    accepted,
    rejected,
  });
});