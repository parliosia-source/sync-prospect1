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

// Very simple CSV parser that handles quoted fields with commas and newlines
function parseCsv(text) {
  const lines = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current); current = "";
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  const rows = lines.map(line => {
    const fields = [];
    let field = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { field += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        fields.push(field); field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields;
  });

  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(f => f.trim() !== "")).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] || "").trim(); });
    return obj;
  });
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
  const { fileUrl, dryRun = false } = body;

  if (!fileUrl) {
    return Response.json({ error: "fileUrl required (upload CSV first and pass the URL)" }, { status: 400 });
  }

  console.log(`[IMPORT_KBV2] START dryRun=${dryRun}, url=${fileUrl}`);

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

  for (const row of rows) {
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
        // Dry run: just count
        if (existingByDomain[record.domain]) updatedCount++;
        else createdCount++;
      }
      if (samples.length < 10) samples.push(record);
    } catch (err) {
      errorCount++;
      errors.push({ domain: record.domain, error: err.message });
      console.error(`[IMPORT_KBV2] Error on ${record.domain}: ${err.message}`);
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