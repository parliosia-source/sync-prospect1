import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun !== false;

  console.log(`[PURGE_DUPS] START dryRun=${dryRun}`);

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
  console.log(`[PURGE_DUPS] Loaded ${all.length} records`);

  // Group by normalized domain
  const byDomain = {};
  for (const e of all) {
    const d = (e.domain || "").toLowerCase().replace(/^www\./, "").trim();
    if (!d) continue;
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(e);
  }

  // Score a record for tie-breaking (more filled = better)
  function score(e) {
    const conf = e.confidenceScore || 0;
    const kwLen = Array.isArray(e.keywords) ? e.keywords.length : 0;
    const tagsLen = Array.isArray(e.tags) ? e.tags.length : 0;
    const notesLen = (e.notes || "").length;
    const sectorsLen = Array.isArray(e.industrySectors) ? e.industrySectors.length : 0;
    return conf * 1000 + kwLen + tagsLen + sectorsLen + Math.min(notesLen, 50);
  }

  const domainsWithDuplicates = [];
  const toDelete = [];
  const kept = [];
  const examples = [];

  for (const [domain, records] of Object.entries(byDomain)) {
    if (records.length <= 1) continue;

    // Sort: highest score first
    records.sort((a, b) => score(b) - score(a));
    const winner = records[0];
    const losers = records.slice(1);

    domainsWithDuplicates.push(domain);
    kept.push(winner.id);
    toDelete.push(...losers.map(l => l.id));

    if (examples.length < 20) {
      examples.push({
        domain,
        keptId: winner.id,
        keptScore: score(winner),
        keptConfidence: winner.confidenceScore,
        deletedCount: losers.length,
        deletedIds: losers.map(l => l.id),
      });
    }
  }

  console.log(`[PURGE_DUPS] domains_with_dups=${domainsWithDuplicates.length}, to_delete=${toDelete.length}`);

  let deletedCount = 0;
  const deleteErrors = [];

  if (!dryRun) {
    for (const id of toDelete) {
      try {
        await base44.asServiceRole.entities.KBEntityV2.delete(id);
        deletedCount++;
      } catch (err) {
        deleteErrors.push({ id, error: err.message });
        console.error(`[PURGE_DUPS] delete failed ${id}: ${err.message}`);
      }
      // Small delay to avoid rate limit
      if (deletedCount % 10 === 0) await new Promise(r => setTimeout(r, 500));
    }
  } else {
    deletedCount = toDelete.length;
  }

  console.log(`[PURGE_DUPS] END deletedCount=${deletedCount} keptCount=${kept.length}`);

  return Response.json({
    dryRun,
    totalRecordsScanned: all.length,
    domainsWithDuplicatesCount: domainsWithDuplicates.length,
    domainsWithDuplicates,
    toDeleteCount: toDelete.length,
    deletedCount,
    keptCount: kept.length,
    deleteErrors: deleteErrors.slice(0, 10),
    examples,
  });
});