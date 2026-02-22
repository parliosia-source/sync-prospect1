import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// ── Helpers ────────────────────────────────────────────────────────────────────
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

function parseLocation(hqLocation) {
  // "Montréal, Québec, Canada" → { hqCity, hqProvince, hqCountry, hqRegion }
  const norm = normText(hqLocation || "");
  const parts = (hqLocation || "").split(",").map(s => s.trim());
  const city = parts[0] || "";
  const cityNorm = normText(city);

  let hqProvince = "QC";
  let hqCountry = "CA";

  // Detect province
  if (/ontario|toronto|ottawa/.test(norm)) hqProvince = "ON";
  else if (/british columbia|vancouver|victoria/.test(norm)) hqProvince = "BC";
  else if (/alberta|calgary|edmonton/.test(norm)) hqProvince = "AB";
  else if (/qu[eé]bec|montr[eé]al|laval/.test(norm)) hqProvince = "QC";

  // Detect country
  if (/united states|usa|\.com/.test(norm)) hqCountry = "US";

  // Determine region
  let hqRegion = "UNKNOWN";
  if (hqCountry !== "CA") hqRegion = "OUTSIDE_QC";
  else if (hqProvince === "QC") {
    const isMTL = MTL_CITIES.has(cityNorm) ||
      [...MTL_CITIES].some(mc => cityNorm.includes(mc));
    hqRegion = isMTL ? "MTL" : "QC_OTHER";
  } else {
    hqRegion = "OUTSIDE_QC";
  }

  return { hqCity: city, hqProvince, hqCountry, hqRegion };
}

function buildRecord(row) {
  const domain = (row.domain || "").toLowerCase().replace(/^www\./, "").trim();
  if (!domain || !row.name || !row.website) return null;

  const loc = parseLocation(row.hqLocation);
  const industrySectors = Array.isArray(row.industrySectors) ? row.industrySectors : (row.industrySectors ? [row.industrySectors] : []);
  const tags = Array.isArray(row.tags) ? row.tags : (row.tags ? [row.tags] : []);

  return {
    name: row.name.trim(),
    normalizedName: normText(row.name),
    domain,
    website: row.website.trim(),
    hqCity: loc.hqCity,
    hqProvince: loc.hqProvince,
    hqCountry: loc.hqCountry,
    hqRegion: loc.hqRegion,
    industryLabel: row.industryLabel || industrySectors[0] || "",
    industrySectors,
    entityType: row.entityType || "COMPANY",
    tags,
    notes: row.notes || "",
    keywords: [],
    synonyms: [],
    sectorSynonymsUsed: [],
    confidenceScore: 85,
    qualityFlags: ["KB_MASTER"],
    sourceOrigin: "IMPORT",
    sourceUrl: row.source || "",
    seedBatchId: row.seedBatchId || "KB_MASTER_2026-02-22",
    lastVerifiedAt: row.lastVerifiedAt || null,
  };
}

// Merge two records — prefer the master import data but union arrays
function mergeRecords(existing, incoming) {
  const merged = { ...existing };

  // Always overwrite with master data (more curated)
  merged.name = incoming.name || existing.name;
  merged.normalizedName = incoming.normalizedName || existing.normalizedName;
  merged.website = incoming.website || existing.website;
  merged.hqCity = incoming.hqCity || existing.hqCity;
  merged.hqProvince = incoming.hqProvince || existing.hqProvince;
  merged.hqCountry = incoming.hqCountry || existing.hqCountry;
  merged.hqRegion = incoming.hqRegion !== "UNKNOWN" ? incoming.hqRegion : (existing.hqRegion || "UNKNOWN");
  merged.entityType = incoming.entityType || existing.entityType;

  // Union arrays
  const unionArr = (a, b) => [...new Set([...(a || []), ...(b || [])])];
  merged.industrySectors = unionArr(existing.industrySectors, incoming.industrySectors);
  merged.tags = unionArr(existing.tags, incoming.tags);
  merged.keywords = unionArr(existing.keywords, incoming.keywords);

  // Prefer longer notes
  merged.notes = (incoming.notes || "").length > (existing.notes || "").length ? incoming.notes : existing.notes;

  // Keep industry label from master if non-empty
  merged.industryLabel = incoming.industryLabel || existing.industryLabel;

  // Raise confidence if we have master data
  merged.confidenceScore = Math.max(existing.confidenceScore || 70, incoming.confidenceScore || 85);

  // Union quality flags
  const qf = new Set([...(existing.qualityFlags || []), ...(incoming.qualityFlags || [])]);
  merged.qualityFlags = [...qf];

  merged.seedBatchId = incoming.seedBatchId || existing.seedBatchId;
  merged.lastVerifiedAt = incoming.lastVerifiedAt || existing.lastVerifiedAt;

  return merged;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    fileUrl,
    dryRun = false,
    batchSize = 8,
    offset = 0,
  } = body;

  if (!fileUrl) {
    return Response.json({ error: "fileUrl required" }, { status: 400 });
  }

  const START = Date.now();
  console.log(`[IMPORT_MASTER] START dryRun=${dryRun} offset=${offset} batchSize=${batchSize}`);

  // Fetch JSON
  const jsonRes = await fetch(fileUrl);
  if (!jsonRes.ok) return Response.json({ error: `Cannot fetch file: ${jsonRes.status}` }, { status: 400 });
  const allRows = await jsonRes.json();

  if (!Array.isArray(allRows)) return Response.json({ error: "File must be a JSON array" }, { status: 400 });

  const rows = allRows.slice(offset, offset + 9999);
  console.log(`[IMPORT_MASTER] total=${allRows.length} processing=${rows.length} offset=${offset}`);

  // Load existing KBEntityV2 domains → id map
  const existingByDomain = {};
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-updated_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    for (const e of batch) { if (e.domain) existingByDomain[e.domain.toLowerCase().replace(/^www\./, "")] = { id: e.id, ...e }; }
    if (batch.length < 500) break;
    page++;
    if (page >= 20) break;
  }
  console.log(`[IMPORT_MASTER] existing KBEntityV2: ${Object.keys(existingByDomain).length}`);

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const errorList = [];
  const samples = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    for (const row of batch) {
      const record = buildRecord(row);
      if (!record) { skipped++; continue; }

      try {
        const existing = existingByDomain[record.domain];

        if (!dryRun) {
          if (existing) {
            const merged = mergeRecords(existing, record);
            // Remove internal fields before update
            const { id, created_date, updated_date, created_by, entity_name, app_id, is_sample, is_deleted, ...updateData } = merged;
            await base44.asServiceRole.entities.KBEntityV2.update(existing.id, updateData);
            existingByDomain[record.domain] = { ...existing, ...updateData };
            updated++;
          } else {
            const created_entity = await base44.asServiceRole.entities.KBEntityV2.create(record);
            existingByDomain[record.domain] = { id: created_entity.id, ...record };
            created++;
          }
        } else {
          if (existing) updated++;
          else created++;
        }

        if (samples.length < 15) {
          samples.push({ name: record.name, domain: record.domain, hqRegion: record.hqRegion, hqCity: record.hqCity, industrySectors: record.industrySectors, action: existing ? "UPDATE" : "CREATE" });
        }
      } catch (err) {
        errors++;
        errorList.push({ domain: record.domain, name: record.name, error: err.message });
        console.log(`[IMPORT_MASTER] ERR ${record.domain}: ${err.message}`);
        // Retry after short delay on rate limit
        if (err.message?.includes("429") || err.message?.includes("Rate limit")) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    // Throttle between batches
    if (!dryRun && i + batchSize < rows.length) {
      await new Promise(r => setTimeout(r, 1200));
    }

    if (i % (batchSize * 10) === 0) {
      console.log(`[IMPORT_MASTER] progress ${i}/${rows.length} created=${created} updated=${updated} errors=${errors}`);
    }
  }

  const elapsed = Date.now() - START;
  console.log(`[IMPORT_MASTER] END created=${created} updated=${updated} skipped=${skipped} errors=${errors} elapsed=${elapsed}ms`);

  return Response.json({
    dryRun,
    totalRows: allRows.length,
    processed: rows.length,
    created,
    updated,
    skipped,
    errors,
    elapsedMs: elapsed,
    samples,
    errorList: errorList.slice(0, 20),
    isComplete: offset + rows.length >= allRows.length,
  });
});