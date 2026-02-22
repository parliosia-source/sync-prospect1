import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const ALL_SECTORS = [
  "Technologie","Finance & Assurance","Santé & Pharma","Gouvernement & Public",
  "Éducation & Formation","Associations & OBNL","Immobilier","Droit & Comptabilité",
  "Industrie & Manufacture","Commerce de détail","Transport & Logistique",
];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    target = 150,
    location = "GM",
    minScore = 75,
    dryRun = false,
    startSectorIndex = 0,
  } = body;

  const START = Date.now();
  const MAX_MS = 170 * 1000; // ~2m50s budget

  const results = [];
  let sectorIndex = startSectorIndex;
  let nextSectorIndex = null;

  console.log(`[HARVEST_ALL] START startSectorIndex=${startSectorIndex} dryRun=${dryRun}`);

  for (let i = startSectorIndex; i < ALL_SECTORS.length; i++) {
    if (Date.now() - START > MAX_MS * 0.85) {
      nextSectorIndex = i;
      console.log(`[HARVEST_ALL] TIME_BUDGET at sector=${ALL_SECTORS[i]}, nextSectorIndex=${i}`);
      break;
    }

    const sector = ALL_SECTORS[i];
    sectorIndex = i;
    console.log(`[HARVEST_ALL] Processing sector=${sector} (${i + 1}/${ALL_SECTORS.length})`);

    // Call kbV2HarvestSector via SDK
    const harvestRes = await base44.asServiceRole.functions.invoke('kbV2HarvestSector', {
      sector,
      target,
      location,
      minScore,
      maxWeb: 200,
      dryRun,
    }).catch(err => ({ data: { error: err.message } }));

    const r = harvestRes?.data || {};
    results.push({
      sector,
      status: r.status || "ERROR",
      currentBefore: r.currentBefore || 0,
      currentAfter: r.currentAfter || 0,
      inserted: r.inserted || 0,
      rejected: r.rejected || 0,
      fetched: r.fetched || 0,
      error: r.error || null,
    });

    console.log(`[HARVEST_ALL] sector=${sector} inserted=${r.inserted} status=${r.status}`);

    // Small delay between sectors to avoid rate limits
    if (i < ALL_SECTORS.length - 1 && !nextSectorIndex) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const totalInserted = results.reduce((s, r) => s + (r.inserted || 0), 0);
  const elapsedMs = Date.now() - START;

  // Log to ActivityLog
  await base44.asServiceRole.entities.ActivityLog.create({
    actionType: "KB_HARVEST_ALL_SECTORS",
    entityType: "KBEntityV2",
    payload: {
      startSectorIndex,
      nextSectorIndex,
      sectorsProcessed: results.length,
      totalInserted,
      dryRun,
      elapsedMs,
    },
    status: "SUCCESS",
  }).catch(() => {});

  return Response.json({
    startSectorIndex,
    nextSectorIndex,
    sectorsProcessed: results.length,
    totalInserted,
    dryRun,
    elapsedMs,
    results,
    isComplete: nextSectorIndex === null,
    resumePayload: nextSectorIndex !== null ? { startSectorIndex: nextSectorIndex, target, location, minScore, dryRun } : null,
  });
});