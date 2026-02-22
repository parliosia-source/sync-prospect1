import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Parse a JSON array field from CSV (handles stringified arrays)
function parseJsonArray(val) {
  if (!val || val === '' || val === 'nan') return [];
  if (Array.isArray(val)) return val;
  const s = String(val).trim();
  if (s === '' || s === '[]') return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    // Fallback: comma-split if it looks like a plain list
    return s.split(',').map(x => x.trim()).filter(Boolean);
  }
}

function parseNumber(val, fallback = 70) {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function parseDate(val) {
  if (!val || val === '' || val === 'nan') return null;
  return String(val).trim() || null;
}

// Parse CSV respecting quoted fields with embedded commas/newlines
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && next === '\n') i++;
        if (row.length > 0 || field !== '') { row.push(field); rows.push(row); row = []; field = ''; }
      } else { field += ch; }
    }
  }
  if (row.length > 0 || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const fileUrl = body.fileUrl;
  const dryRun  = body.dryRun === true;

  if (!fileUrl) return Response.json({ error: 'fileUrl required' }, { status: 400 });

  // Fetch the CSV file
  const csvResponse = await fetch(fileUrl);
  if (!csvResponse.ok) return Response.json({ error: `Failed to fetch CSV: ${csvResponse.status}` }, { status: 400 });
  const csvText = await csvResponse.text();

  const allRows = parseCSV(csvText);
  if (allRows.length < 2) return Response.json({ error: 'Empty CSV' }, { status: 400 });

  const headers = allRows[0].map(h => h.trim());
  console.log(`[IMPORT_V2] headers: ${headers.join(', ')}`);
  console.log(`[IMPORT_V2] total rows (excl header): ${allRows.length - 1}`);

  // Column index map
  const col = (name) => headers.indexOf(name);

  let createdCount = 0;
  let updatedCount = 0;
  let errorCount   = 0;
  const examples   = [];
  const errors     = [];

  // Load existing domains for upsert (batch lookup)
  const existingList = await base44.asServiceRole.entities.KBEntityV2.list('-created_date', 5000, 0).catch(() => []);
  const domainToId = {};
  for (const e of existingList) {
    if (e.domain) domainToId[e.domain.toLowerCase()] = e.id;
  }
  console.log(`[IMPORT_V2] existing domains loaded: ${Object.keys(domainToId).length}`);

  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (r.length < 3) continue; // skip blank rows

    const get = (name) => (r[col(name)] || '').trim();

    const domain = get('domain').toLowerCase().replace(/^www\./, '');
    const name   = get('name');
    const website = get('website');

    if (!domain || !name) { errorCount++; errors.push({ row: i, reason: 'missing domain or name' }); continue; }

    // Valid hqRegion values
    const rawRegion = get('hqRegion');
    const validRegions = ['MTL', 'QC_OTHER', 'OUTSIDE_QC', 'UNKNOWN'];
    const hqRegion = validRegions.includes(rawRegion) ? rawRegion : 'UNKNOWN';

    // Valid entityType values
    const validEntityTypes = [
      'COMPANY', 'STARTUP', 'ASSOCIATION', 'FOUNDATION', 'NONPROFIT',
      'UNIVERSITY', 'CEGEP', 'EDUCATION', 'TRAINING_CENTER',
      'HOSPITAL', 'CLINIC', 'PUBLIC_AGENCY', 'GOVERNMENT', 'MUNICIPALITY',
      'PROFESSIONAL_ORDER', 'CHAMBER', 'OTHER'
    ];
    const rawEntityType = get('entityType');
    const entityType = validEntityTypes.includes(rawEntityType) ? rawEntityType : 'OTHER';

    // Valid sourceOrigin
    const validOrigins = ['MIGRATION', 'MANUAL', 'WEB_SCRAPE', 'CSV_IMPORT', 'API'];
    const rawOrigin = get('sourceOrigin');
    const sourceOrigin = validOrigins.includes(rawOrigin) ? rawOrigin : 'CSV_IMPORT';

    const record = {
      name,
      normalizedName: get('normalizedName') || name.toLowerCase(),
      domain,
      website: website || `https://${domain}`,
      hqCity:    get('hqCity')    || null,
      hqProvince: get('hqProvince') || null,
      hqCountry: get('hqCountry') || 'CA',
      hqRegion,
      industryLabel:   get('industryLabel')   || null,
      industrySectors: parseJsonArray(get('industrySectors')),
      entityType,
      tags:              parseJsonArray(get('tags')),
      notes:             get('notes') || null,
      keywords:          parseJsonArray(get('keywords')),
      synonyms:          parseJsonArray(get('synonyms')),
      sectorSynonymsUsed: parseJsonArray(get('sectorSynonymsUsed')),
      confidenceScore:   parseNumber(get('confidenceScore'), 70),
      qualityFlags:      parseJsonArray(get('qualityFlags')),
      sourceOrigin,
      sourceUrl:              get('sourceUrl')              || null,
      seedBatchId:            get('seedBatchId')            || null,
      lastVerifiedAt:         parseDate(get('lastVerifiedAt')),
      migratedFromKbEntityId: get('migratedFromKbEntityId') || null,
    };

    if (examples.length < 5) examples.push({ domain, name, industrySectors: record.industrySectors, hqRegion, entityType });

    if (dryRun) { createdCount++; continue; }

    try {
      const existingId = domainToId[domain];
      if (existingId) {
        await base44.asServiceRole.entities.KBEntityV2.update(existingId, record);
        updatedCount++;
      } else {
        const created = await base44.asServiceRole.entities.KBEntityV2.create(record);
        domainToId[domain] = created.id;
        createdCount++;
      }
    } catch (err) {
      errorCount++;
      if (errors.length < 10) errors.push({ row: i, domain, reason: err.message });
      console.error(`[IMPORT_V2] row ${i} (${domain}): ${err.message}`);
    }

    // Log progress every 50 records
    if ((createdCount + updatedCount) % 50 === 0) {
      console.log(`[IMPORT_V2] progress: created=${createdCount} updated=${updatedCount} errors=${errorCount}`);
    }
  }

  console.log(`[IMPORT_V2] DONE: created=${createdCount} updated=${updatedCount} errors=${errorCount}`);

  return Response.json({
    success: true,
    dryRun,
    totalRows: allRows.length - 1,
    createdCount,
    updatedCount,
    errorCount,
    examples,
    errors: errors.slice(0, 10),
  });
});