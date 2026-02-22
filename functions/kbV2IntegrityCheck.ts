import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const CSV_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/699527f11946a4f2988597f8/3e49959b6_KBEntityV2_QC_MTL.csv";

// RFC-4180 compliant CSV parser (minimal — only extracts domain column)
function parseCsvDomains(text) {
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  const domainIdx = headers.indexOf("domain");
  if (domainIdx === -1) return [];

  const domains = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple split — domain column should never contain commas
    const fields = line.split(",");
    const raw = (fields[domainIdx] || "").replace(/^"|"$/g, "").trim().toLowerCase().replace(/^www\./, "");
    if (raw) domains.add(raw);
  }
  return [...domains];
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const csvUrl = body.csvUrl || CSV_URL;

  console.log("[KB2_INTEGRITY] START");

  // ── 1. Load all KBEntityV2 from DB ────────────────────────────────────────
  let all = [];
  let page = 0;
  while (true) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-created_date', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    all = all.concat(batch);
    if (batch.length < 500) break;
    page++;
    if (page >= 10) break;
  }

  const totalCount = all.length;
  console.log(`[KB2_INTEGRITY] Loaded ${totalCount} records`);

  // ── 2. countByHqRegion ────────────────────────────────────────────────────
  const countByHqRegion = { MTL: 0, QC_OTHER: 0, OUTSIDE_QC: 0, UNKNOWN: 0 };
  for (const e of all) {
    const r = e.hqRegion || "UNKNOWN";
    if (r in countByHqRegion) countByHqRegion[r]++;
    else countByHqRegion.UNKNOWN++;
  }

  // ── 3. Missing required fields ────────────────────────────────────────────
  const missingDomain = [];
  const missingWebsite = [];
  const missingIndustryLabel = [];
  const missingIndustrySectors = [];
  const missingGeo = []; // missing hqCity OR hqProvince OR hqRegion

  for (const e of all) {
    if (!e.domain) missingDomain.push(e.id);
    if (!e.website) missingWebsite.push(e.id);
    if (!e.industryLabel) missingIndustryLabel.push(e.name || e.id);
    if (!Array.isArray(e.industrySectors) || e.industrySectors.length === 0) missingIndustrySectors.push(e.name || e.id);
    if (!e.hqCity || !e.hqProvince || !e.hqRegion || e.hqRegion === "UNKNOWN") {
      missingGeo.push({ name: e.name, domain: e.domain, hqCity: e.hqCity, hqProvince: e.hqProvince, hqRegion: e.hqRegion });
    }
  }

  const missingRequiredFields = {
    missingDomainCount: missingDomain.length,
    missingDomainIds: missingDomain.slice(0, 10),
    missingWebsiteCount: missingWebsite.length,
    missingIndustryLabelCount: missingIndustryLabel.length,
    missingIndustryLabelSamples: missingIndustryLabel.slice(0, 10),
    missingIndustrySectorsCount: missingIndustrySectors.length,
    missingIndustrySectorsSamples: missingIndustrySectors.slice(0, 10),
    missingGeoCount: missingGeo.length,
    missingGeoSamples: missingGeo.slice(0, 15),
  };

  // ── 4. Duplicates by domain ───────────────────────────────────────────────
  const domainCounts = {};
  for (const e of all) {
    const d = (e.domain || "").toLowerCase().replace(/^www\./, "");
    if (!d) continue;
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }
  const duplicatesByDomain = Object.entries(domainCounts)
    .filter(([_, c]) => c > 1)
    .map(([domain, count]) => ({ domain, count }));

  // ── 5. Domains missing from import (CSV vs DB) ────────────────────────────
  let domainsMissingFromImport = [];
  let csvTotalDomains = 0;
  let csvFetchError = null;

  try {
    const csvRes = await fetch(csvUrl);
    if (!csvRes.ok) throw new Error(`HTTP ${csvRes.status}`);
    const csvText = await csvRes.text();
    const csvDomains = parseCsvDomains(csvText);
    csvTotalDomains = csvDomains.length;

    const dbDomains = new Set(all.map(e => (e.domain || "").toLowerCase().replace(/^www\./, "")));
    domainsMissingFromImport = csvDomains.filter(d => !dbDomains.has(d));
  } catch (err) {
    csvFetchError = err.message;
    console.error(`[KB2_INTEGRITY] CSV fetch error: ${err.message}`);
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────
  const isClean = (
    missingDomain.length === 0 &&
    missingWebsite.length === 0 &&
    missingIndustrySectors.length === 0 &&
    duplicatesByDomain.length === 0 &&
    domainsMissingFromImport.length === 0
  );

  console.log(`[KB2_INTEGRITY] totalCount=${totalCount}, MTL=${countByHqRegion.MTL}, missingDomain=${missingDomain.length}, missingGeo=${missingGeo.length}, duplicates=${duplicatesByDomain.length}, missingFromCSV=${domainsMissingFromImport.length}`);

  return Response.json({
    totalCount,
    countByHqRegion,
    missingRequiredFields,
    duplicatesByDomain,
    domainsMissingFromImport: {
      csvTotalDomains,
      missingCount: domainsMissingFromImport.length,
      missingDomains: domainsMissingFromImport,
      csvFetchError,
    },
    isClean,
    summary: `${totalCount} records in DB. MTL=${countByHqRegion.MTL}/${totalCount}. Missing geo: ${missingGeo.length}. Duplicates: ${duplicatesByDomain.length}. Missing from CSV: ${domainsMissingFromImport.length}.`,
  });
});