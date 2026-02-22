import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
// kbV2DeleteCorrupted v2

function isValidUrl(val) {
  if (!val) return false;
  try {
    const u = new URL(val);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isCorrupted(e) {
  const reasons = [];

  // website is not a valid URL
  if (!isValidUrl(e.website)) {
    reasons.push(`invalid_website: "${e.website}"`);
  }

  // domain contains spaces (more than 2 words = clearly not a domain)
  const domainWords = (e.domain || "").trim().split(/\s+/);
  if (domainWords.length > 2) {
    reasons.push(`domain_has_spaces: "${e.domain}"`);
  }

  // hqCity contains "http" (shifted columns in CSV)
  if ((e.hqCity || "").toLowerCase().includes("http")) {
    reasons.push(`hqCity_contains_url: "${e.hqCity}"`);
  }

  return reasons.length > 0 ? reasons : null;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;

  console.log(`[DELETE_CORRUPTED] START dryRun=${dryRun}`);

  // Load all KBEntityV2
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
  console.log(`[DELETE_CORRUPTED] Loaded ${all.length} records`);

  const corruptedRecords = [];
  for (const e of all) {
    const reasons = isCorrupted(e);
    if (reasons) {
      corruptedRecords.push({ id: e.id, name: e.name, domain: e.domain, website: e.website, hqCity: e.hqCity, reasons });
    }
  }

  console.log(`[DELETE_CORRUPTED] Found ${corruptedRecords.length} corrupted records`);

  let deletedCount = 0;
  const deleteErrors = [];

  if (!dryRun) {
    for (const rec of corruptedRecords) {
      try {
        await base44.asServiceRole.entities.KBEntityV2.delete(rec.id);
        deletedCount++;
        console.log(`[DELETE_CORRUPTED] Deleted ${rec.id} (${rec.name})`);
      } catch (err) {
        deleteErrors.push({ id: rec.id, error: err.message });
        console.error(`[DELETE_CORRUPTED] delete failed ${rec.id}: ${err.message}`);
      }
    }
  } else {
    deletedCount = corruptedRecords.length;
  }

  return Response.json({
    dryRun,
    totalScanned: all.length,
    corruptedCount: corruptedRecords.length,
    deletedCount,
    deleteErrors,
    sample: corruptedRecords.slice(0, 20),
  });
});