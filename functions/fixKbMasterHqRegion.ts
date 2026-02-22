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

// Parse "Montréal, Québec, Canada" → { city, province, country }
function parseHqLocation(hqCity, hqProvince, hqCountry) {
  // hqCity may be the full "City, Province, Country" string (import artifact)
  // Detect by checking if it contains commas
  let city = hqCity || "";
  let province = hqProvince || "";
  let country = hqCountry || "CA";

  if (city.includes(",")) {
    const parts = city.split(",").map(s => s.trim());
    city = parts[0] || "";
    if (parts.length >= 3) {
      province = parts[1] || province;
      country = parts[2] || country;
    } else if (parts.length === 2) {
      province = parts[1] || province;
    }
  }

  // Normalize country: "Canada" → "CA"
  const countryRaw = country.trim();
  const countryCode = countryRaw === "Canada" ? "CA"
    : countryRaw === "United States" || countryRaw === "USA" ? "US"
    : countryRaw.length === 2 ? countryRaw.toUpperCase()
    : "CA";

  return { city: normText(city), province: normText(province), country: countryCode };
}

function resolveRegion(hqCity, hqProvince, hqCountry, hqRegion) {
  const VALID = new Set(["MTL", "GM", "QC_OTHER", "OUTSIDE_QC", "UNKNOWN"]);
  if (VALID.has(hqRegion)) return null; // already correct

  const { city, province, country } = parseHqLocation(hqCity, hqProvince, hqCountry);

  if (country !== "CA" && country !== "") return { hqRegion: "OUTSIDE_QC", hqProvince: hqProvince || "" };

  // Province normalization
  let prov = "UNKNOWN";
  if (/qu[eé]bec|^qc$/.test(province)) prov = "QC";
  else if (/ontario|^on$/.test(province)) prov = "ON";
  else if (/british columbia|colombie|^bc$/.test(province)) prov = "BC";
  else if (/alberta|^ab$/.test(province)) prov = "AB";
  else if (/nova scotia|nouvelle-ecosse|^ns$/.test(province)) prov = "NS";
  else if (/new brunswick|nouveau-brunswick|^nb$/.test(province)) prov = "NB";
  else if (/manitoba|^mb$/.test(province)) prov = "MB";
  else if (/saskatchewan|^sk$/.test(province)) prov = "SK";
  else if (/canada/.test(province) && !province) prov = "QC"; // default to QC if ambiguous

  if (prov !== "QC" && prov !== "UNKNOWN") return { hqRegion: "OUTSIDE_QC", hqProvince: prov };
  if (prov === "UNKNOWN") {
    // Last resort: check city against MTL set
    if (MTL_CITIES.has(city)) return { hqRegion: "MTL", hqProvince: "QC" };
    return { hqRegion: "QC_OTHER", hqProvince: "QC" };
  }

  // QC → MTL or QC_OTHER
  if (MTL_CITIES.has(city)) return { hqRegion: "MTL", hqProvince: "QC" };
  for (const token of city.split(/[\s\-]+/)) {
    if (MTL_CITIES.has(token)) return { hqRegion: "MTL", hqProvince: "QC" };
  }

  // Check if raw hqProvince or city string mentions a non-QC city clearly
  if (/toronto|ottawa|hamilton|london|kingston|windsor/.test(city)) return { hqRegion: "OUTSIDE_QC", hqProvince: "ON" };
  if (/vancouver|victoria|kelowna/.test(city)) return { hqRegion: "OUTSIDE_QC", hqProvince: "BC" };
  if (/calgary|edmonton/.test(city)) return { hqRegion: "OUTSIDE_QC", hqProvince: "AB" };

  // Extract clean city for storage
  const cleanCity = (hqCity || "").includes(",") ? (hqCity || "").split(",")[0].trim() : (hqCity || "");
  return { hqRegion: "QC_OTHER", hqProvince: "QC", hqCity: cleanCity };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { dryRun = true, offset = 0, batchLimit = 150 } = body;

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
  const allToFix = all.filter(e => !VALID_REGIONS.has(e.hqRegion));
  const toFix = allToFix.slice(offset, offset + batchLimit);
  console.log(`[FIX_REGION] totalToFix=${allToFix.length} batchToProcess=${toFix.length} offset=${offset}`);

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
      await new Promise(r => setTimeout(r, 2500));
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