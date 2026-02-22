import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

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

const QC_CITIES = new Set([
  "quebec","gatineau","sherbrooke","saguenay","levis","trois-rivieres","chicoutimi",
  "saint-hyacinthe","granby","drummondville","saint-jean-sur-richelieu","rimouski",
  "shawinigan","victoriaville","rouyn-noranda","val-d-or","sept-iles","baie-comeau",
]);

function resolveRegion(hqCity, hqProvince, hqCountry, hqRegion) {
  // Only fix entries where hqRegion is NOT a valid enum value
  const VALID = new Set(["MTL", "GM", "QC_OTHER", "OUTSIDE_QC", "UNKNOWN"]);
  if (VALID.has(hqRegion)) return null; // already correct, skip

  const cityNorm = normText(hqCity || "");
  const provNorm = normText(hqProvince || "");
  const country = (hqCountry || "CA").toUpperCase();

  if (country !== "CA") return { hqRegion: "OUTSIDE_QC", hqProvince: hqProvince || "", hqCountry: country };

  // Province detection from raw hqProvince (may be "Québec" etc.)
  let province = hqProvince;
  if (/qu[eé]bec|^qc$/.test(provNorm)) province = "QC";
  else if (/ontario|^on$/.test(provNorm)) province = "ON";
  else if (/british columbia|^bc$/.test(provNorm)) province = "BC";
  else if (/alberta|^ab$/.test(provNorm)) province = "AB";
  else if (/nova scotia|^ns$/.test(provNorm)) province = "NS";
  else if (/new brunswick|^nb$/.test(provNorm)) province = "NB";
  else if (/manitoba|^mb$/.test(provNorm)) province = "MB";
  else if (/saskatchewan|^sk$/.test(provNorm)) province = "SK";

  if (province !== "QC") return { hqRegion: "OUTSIDE_QC", hqProvince: province || hqProvince || "" };

  // QC → MTL vs QC_OTHER
  if (MTL_CITIES.has(cityNorm)) return { hqRegion: "MTL", hqProvince: "QC" };

  // Check if city token matches any MTL city
  for (const token of cityNorm.split(/[\s\-,]+/)) {
    if (MTL_CITIES.has(token)) return { hqRegion: "MTL", hqProvince: "QC" };
  }

  return { hqRegion: "QC_OTHER", hqProvince: "QC" };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { dryRun = true, seedBatchId = "KB_MASTER_2026-02-22" } = body;

  console.log(`[FIX_REGION] START dryRun=${dryRun} seedBatchId=${seedBatchId}`);

  // Load all KB entries (not just the batch — we check all with invalid hqRegion)
  let all = [];
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-created_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;
  }

  console.log(`[FIX_REGION] loaded=${all.length}`);

  const VALID_REGIONS = new Set(["MTL", "GM", "QC_OTHER", "OUTSIDE_QC", "UNKNOWN"]);
  const toFix = all.filter(e => !VALID_REGIONS.has(e.hqRegion));
  console.log(`[FIX_REGION] toFix=${toFix.length}`);

  let fixed = 0, skipped = 0, errors = 0;
  const samples = [];
  const regionDistribution = {};

  for (let i = 0; i < toFix.length; i += 10) {
    const batch = toFix.slice(i, i + 10);
    for (const e of batch) {
      const fix = resolveRegion(e.hqCity, e.hqProvince, e.hqCountry, e.hqRegion);
      if (!fix) { skipped++; continue; }

      regionDistribution[fix.hqRegion] = (regionDistribution[fix.hqRegion] || 0) + 1;

      if (samples.length < 20) {
        samples.push({ name: e.name, domain: e.domain, hqCity: e.hqCity, before: e.hqRegion, after: fix.hqRegion, hqProvince: fix.hqProvince });
      }

      if (!dryRun) {
        try {
          await base44.asServiceRole.entities.KBEntityV2.update(e.id, fix);
          fixed++;
        } catch (err) {
          errors++;
          console.log(`[FIX_REGION] ERR ${e.domain}: ${err.message}`);
        }
      } else {
        fixed++;
      }
    }
    if (!dryRun && i + 10 < toFix.length) {
      await new Promise(r => setTimeout(r, 800));
    }
    if (i % 100 === 0) console.log(`[FIX_REGION] progress ${i}/${toFix.length} fixed=${fixed}`);
  }

  console.log(`[FIX_REGION] END fixed=${fixed} skipped=${skipped} errors=${errors}`);

  return Response.json({
    dryRun,
    total: all.length,
    toFix: toFix.length,
    fixed,
    skipped,
    errors,
    regionDistribution,
    samples,
  });
});