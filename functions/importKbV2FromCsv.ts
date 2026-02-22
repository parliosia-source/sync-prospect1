import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Parse a JSON array field safely — always returns a JS array
function parseJsonArray(val) {
  if (!val || val === "" || val === "[]") return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    // Try comma-split as fallback
    return val.split(",").map(s => s.trim()).filter(Boolean);
  }
}

function parseNumber(val, fallback = 70) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

// RFC-4180 compliant CSV parser
function parseCsv(text) {
  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  const records = [];
  let i = 0;
  const n = text.length;

  function parseField() {
    if (i >= n) return "";
    if (text[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let val = "";
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; } // closing quote
        } else {
          val += text[i++];
        }
      }
      return val;
    } else {
      // Unquoted field
      let val = "";
      while (i < n && text[i] !== ',' && text[i] !== '\n') {
        val += text[i++];
      }
      return val;
    }
  }

  function parseRecord() {
    const fields = [];
    while (i < n && text[i] !== '\n') {
      fields.push(parseField());
      if (i < n && text[i] === ',') i++; // skip comma
    }
    if (i < n && text[i] === '\n') i++; // skip newline
    return fields;
  }

  // Parse header
  const headers = parseRecord().map(h => h.trim());
  
  // Parse rows
  while (i < n) {
    if (text[i] === '\n') { i++; continue; } // skip blank lines
    const fields = parseRecord();
    if (fields.length === 0 || fields.every(f => !f.trim())) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (fields[idx] || "").trim(); });
    records.push(obj);
  }

  return records;
}

function buildRecord(row) {
  const domain = (row.domain || "").toLowerCase().replace(/^www\./, "").trim();
  if (!domain || !row.name || !row.website) return null;

  const hqRegion = ["MTL", "QC_OTHER", "OUTSIDE_QC", "UNKNOWN"].includes(row.hqRegion)
    ? row.hqRegion
    : "UNKNOWN";

  const sourceOrigin = ["MIGRATION", "MANUAL", "SEED", "WEB", "IMPORT"].includes(row.sourceOrigin)
    ? row.sourceOrigin
    : "IMPORT";

  return {
    name: row.name.trim(),
    normalizedName: row.normalizedName || row.name.toLowerCase().trim(),
    domain,
    website: row.website.trim(),
    hqCity: row.hqCity || "",
    hqProvince: row.hqProvince || "",
    hqCountry: row.hqCountry || "CA",
    hqRegion,
    industryLabel: row.industryLabel || "",
    industrySectors: parseJsonArray(row.industrySectors),
    entityType: row.entityType || "COMPANY",
    tags: parseJsonArray(row.tags),
    notes: row.notes || "",
    keywords: parseJsonArray(row.keywords),
    synonyms: parseJsonArray(row.synonyms),
    sectorSynonymsUsed: parseJsonArray(row.sectorSynonymsUsed),
    confidenceScore: parseNumber(row.confidenceScore, 70),
    qualityFlags: parseJsonArray(row.qualityFlags),
    sourceOrigin,
    sourceUrl: row.sourceUrl || "",
    seedBatchId: row.seedBatchId || "",
    lastVerifiedAt: row.lastVerifiedAt || null,
    migratedFromKbEntityId: row.migratedFromKbEntityId || "",
  };
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
    offset = 0,   // row offset to start from (0-indexed, after header)
    limit = 9999, // max rows to process
  } = body;

  if (!fileUrl) {
    return Response.json({ error: "fileUrl required (upload CSV first and pass the URL)" }, { status: 400 });
  }

  console.log(`[IMPORT_KBV2] START dryRun=${dryRun}, offset=${offset}, limit=${limit}, url=${fileUrl}`);

  // Fetch CSV
  const csvRes = await fetch(fileUrl);
  if (!csvRes.ok) return Response.json({ error: `Cannot fetch CSV: ${csvRes.status}` }, { status: 400 });
  const csvText = await csvRes.text();

  const rows = parseCsv(csvText);
  console.log(`[IMPORT_KBV2] Parsed ${rows.length} rows from CSV`);

  if (rows.length === 0) return Response.json({ error: "No rows parsed from CSV" }, { status: 400 });

  // Load existing domains for upsert
  let existingByDomain = {};
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-updated_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    for (const e of batch) { if (e.domain) existingByDomain[e.domain.toLowerCase()] = e.id; }
    if (batch.length < 500) break;
    page++;
    if (page >= 10) break;
  }
  console.log(`[IMPORT_KBV2] Existing KBEntityV2 domains: ${Object.keys(existingByDomain).length}`);

  let createdCount = 0, updatedCount = 0, errorCount = 0, skippedCount = 0;
  const samples = [];
  const errors = [];

  // Process in small batches with delay to avoid rate limits
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 1200;

  for (let bi = 0; bi < rows.length; bi += BATCH_SIZE) {
    const batch = rows.slice(bi, bi + BATCH_SIZE);

    for (const row of batch) {
      const record = buildRecord(row);
      if (!record) { skippedCount++; continue; }

      try {
        if (!dryRun) {
          const existingId = existingByDomain[record.domain];
          if (existingId) {
            await base44.asServiceRole.entities.KBEntityV2.update(existingId, record);
            updatedCount++;
          } else {
            const created = await base44.asServiceRole.entities.KBEntityV2.create(record);
            existingByDomain[record.domain] = created.id;
            createdCount++;
          }
        } else {
          if (existingByDomain[record.domain]) updatedCount++;
          else createdCount++;
        }
        if (samples.length < 10) samples.push({ name: record.name, domain: record.domain, hqCity: record.hqCity, hqRegion: record.hqRegion, industrySectors: record.industrySectors, confidenceScore: record.confidenceScore });
      } catch (err) {
        // Retry once on rate limit
        if (err.message?.includes("Rate limit") || err.message?.includes("429")) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const existingId = existingByDomain[record.domain];
            if (!dryRun) {
              if (existingId) {
                await base44.asServiceRole.entities.KBEntityV2.update(existingId, record);
                updatedCount++;
              } else {
                const created = await base44.asServiceRole.entities.KBEntityV2.create(record);
                existingByDomain[record.domain] = created.id;
                createdCount++;
              }
            }
          } catch (err2) {
            errorCount++;
            errors.push({ domain: record.domain, error: err2.message });
          }
        } else {
          errorCount++;
          errors.push({ domain: record.domain, error: err.message });
          console.error(`[IMPORT_KBV2] Error on ${record.domain}: ${err.message}`);
        }
      }
    }

    // Delay between batches
    if (!dryRun && bi + BATCH_SIZE < rows.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
    
    if ((bi / BATCH_SIZE) % 5 === 0) {
      console.log(`[IMPORT_KBV2] Progress: ${bi + batch.length}/${rows.length} — created=${createdCount} updated=${updatedCount} errors=${errorCount}`);
    }
  }

  console.log(`[IMPORT_KBV2] END: created=${createdCount}, updated=${updatedCount}, errors=${errorCount}, skipped=${skippedCount}`);

  return Response.json({
    dryRun,
    totalRowsParsed: rows.length,
    createdCount,
    updatedCount,
    errorCount,
    skippedCount,
    samples,
    errors: errors.slice(0, 20),
  });
});