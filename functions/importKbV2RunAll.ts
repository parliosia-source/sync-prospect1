import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const DEFAULT_CSV_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/699527f11946a4f2988597f8/3e49959b6_KBEntityV2_QC_MTL.csv";
const MAX_DURATION_MS = 170_000; // 170s safety margin (function timeout ~180s)
const BATCH_SIZE = 15;           // records per inner batch
const BATCH_DELAY_MS = 2000;     // delay between batches to avoid rate limit

// ── Shared helpers (inlined — no local imports) ───────────────────────────────

function parseJsonArray(val) {
  if (!val || val === "" || val === "[]") return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return val.split(",").map(s => s.trim()).filter(Boolean);
  }
}

function parseNumber(val, fallback = 70) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function parseCsv(text) {
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records = [];
  let i = 0;
  const n = text.length;

  function parseField() {
    if (i >= n) return "";
    if (text[i] === '"') {
      i++;
      let val = "";
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += text[i++]; }
      }
      return val;
    } else {
      let val = "";
      while (i < n && text[i] !== ',' && text[i] !== '\n') { val += text[i++]; }
      return val;
    }
  }

  function parseRecord() {
    const fields = [];
    while (i < n && text[i] !== '\n') {
      fields.push(parseField());
      if (i < n && text[i] === ',') i++;
    }
    if (i < n && text[i] === '\n') i++;
    return fields;
  }

  const headers = parseRecord().map(h => h.trim());
  while (i < n) {
    if (text[i] === '\n') { i++; continue; }
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
    ? row.hqRegion : "UNKNOWN";
  const sourceOrigin = ["MIGRATION", "MANUAL", "SEED", "WEB", "IMPORT"].includes(row.sourceOrigin)
    ? row.sourceOrigin : "IMPORT";

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

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    fileUrl = DEFAULT_CSV_URL,
    offset = 0,        // row offset in CSV to start from
    limit = 9999,      // max rows to process this run
    dryRun = false,
  } = body;

  const START_TIME = Date.now();
  console.log(`[IMPORT_ALL] START offset=${offset} limit=${limit} dryRun=${dryRun}`);

  // Fetch + parse CSV
  const csvRes = await fetch(fileUrl);
  if (!csvRes.ok) return Response.json({ error: `Cannot fetch CSV: ${csvRes.status}` }, { status: 400 });
  const csvText = await csvRes.text();
  const allRows = parseCsv(csvText);
  const totalRows = allRows.length;

  const workRows = allRows.slice(offset, offset + limit);
  console.log(`[IMPORT_ALL] Total CSV rows=${totalRows}, processing ${workRows.length} (offset=${offset})`);

  // Load existing domains for upsert
  const existingByDomain = {};
  let pg = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-updated_date', 500, pg * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    for (const e of batch) { if (e.domain) existingByDomain[e.domain.toLowerCase()] = e.id; }
    if (batch.length < 500) break;
    pg++;
    if (pg >= 10) break;
  }
  console.log(`[IMPORT_ALL] Existing domains in DB: ${Object.keys(existingByDomain).length}`);

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const errorDetails = [];
  let lastProcessedOffset = offset;
  let stoppedEarly = false;

  for (let bi = 0; bi < workRows.length; bi += BATCH_SIZE) {
    // Time-budget guard
    if (Date.now() - START_TIME > MAX_DURATION_MS) {
      stoppedEarly = true;
      lastProcessedOffset = offset + bi;
      console.log(`[IMPORT_ALL] TIME BUDGET reached at row ${lastProcessedOffset}`);
      break;
    }

    const batch = workRows.slice(bi, bi + BATCH_SIZE);

    for (const row of batch) {
      const record = buildRecord(row);
      if (!record) { skipped++; continue; }

      const existingId = existingByDomain[record.domain];

      try {
        if (!dryRun) {
          if (existingId) {
            await base44.asServiceRole.entities.KBEntityV2.update(existingId, record);
            updated++;
          } else {
            const created_ = await base44.asServiceRole.entities.KBEntityV2.create(record);
            existingByDomain[record.domain] = created_.id;
            created++;
          }
        } else {
          if (existingId) updated++;
          else created++;
        }
      } catch (err) {
        // Retry once after delay on rate limit
        const isRL = err.message?.includes("Rate limit") || err.message?.includes("429");
        if (isRL) {
          await new Promise(r => setTimeout(r, 4000));
          try {
            if (!dryRun) {
              if (existingId) {
                await base44.asServiceRole.entities.KBEntityV2.update(existingId, record);
                updated++;
              } else {
                const created_ = await base44.asServiceRole.entities.KBEntityV2.create(record);
                existingByDomain[record.domain] = created_.id;
                created++;
              }
            }
          } catch (err2) {
            errors++;
            if (errorDetails.length < 20) errorDetails.push({ domain: record.domain, error: err2.message });
          }
        } else {
          errors++;
          if (errorDetails.length < 20) errorDetails.push({ domain: record.domain, error: err.message });
        }
      }
    }

    // Progress log
    const done = bi + batch.length;
    if (done % (BATCH_SIZE * 5) === 0 || done === workRows.length) {
      console.log(`[IMPORT_ALL] ${offset + done}/${totalRows} — created=${created} updated=${updated} errors=${errors}`);
    }

    // Delay between batches (only if not dry run and more rows remain)
    if (!dryRun && bi + BATCH_SIZE < workRows.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const elapsedMs = Date.now() - START_TIME;
  const processedCount = created + updated + skipped + errors;
  const nextOffset = stoppedEarly ? lastProcessedOffset : offset + workRows.length;
  const isComplete = nextOffset >= totalRows;

  console.log(`[IMPORT_ALL] END elapsedMs=${elapsedMs} created=${created} updated=${updated} skipped=${skipped} errors=${errors} nextOffset=${nextOffset} complete=${isComplete}`);

  return Response.json({
    dryRun,
    offset,
    limit,
    totalCsvRows: totalRows,
    processedCount,
    created,
    updated,
    skipped,
    errors,
    errorDetails: errorDetails.slice(0, 20),
    nextOffset,
    isComplete,
    stoppedEarly,
    elapsedMs,
    message: isComplete
      ? `✅ Import complete. ${created} created, ${updated} updated, ${errors} errors.`
      : `⚠️ Stopped at offset ${nextOffset}/${totalRows}. Re-run with offset=${nextOffset} to continue.`,
  });
});