import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Forbidden: Admin only" }, { status: 403 });
  }

  // Load all KBEntityV2
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

  const total = all.length;

  // Count by sourceOrigin
  const countBySource = {};
  for (const e of all) {
    const src = e.sourceOrigin || "UNKNOWN";
    countBySource[src] = (countBySource[src] || 0) + 1;
  }

  // Distribution by sector
  const countBySector = {};
  for (const e of all) {
    const sectors = Array.isArray(e.industrySectors) ? e.industrySectors : [];
    for (const s of sectors) {
      countBySector[s] = (countBySector[s] || 0) + 1;
    }
    if (sectors.length === 0) {
      countBySector["_no_sector"] = (countBySector["_no_sector"] || 0) + 1;
    }
  }

  // Distribution by hqRegion
  const countByRegion = {};
  for (const e of all) {
    const r = e.hqRegion || "UNKNOWN";
    countByRegion[r] = (countByRegion[r] || 0) + 1;
  }

  // Last 20 WEB_TOPUP entries
  const webTopUpEntries = all
    .filter(e => e.sourceOrigin === "WEB" && (e.qualityFlags || []).includes("WEB_TOPUP"))
    .sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))
    .slice(0, 20)
    .map(e => ({
      name: e.name,
      domain: e.domain,
      industrySectors: e.industrySectors,
      confidenceScore: e.confidenceScore,
      hqCity: e.hqCity,
      hqRegion: e.hqRegion,
      createdAt: e.created_date,
      sourceUrl: e.sourceUrl,
    }));

  // Avg confidence score by source
  const scoreBySource = {};
  const scoreCountBySource = {};
  for (const e of all) {
    const src = e.sourceOrigin || "UNKNOWN";
    if (e.confidenceScore) {
      scoreBySource[src] = (scoreBySource[src] || 0) + e.confidenceScore;
      scoreCountBySource[src] = (scoreCountBySource[src] || 0) + 1;
    }
  }
  const avgScoreBySource = {};
  for (const src of Object.keys(scoreBySource)) {
    avgScoreBySource[src] = Math.round(scoreBySource[src] / scoreCountBySource[src]);
  }

  return Response.json({
    total,
    countBySource,
    countBySector: Object.fromEntries(
      Object.entries(countBySector).sort((a, b) => b[1] - a[1])
    ),
    countByRegion,
    avgScoreBySource,
    webTopUpEntries,
    webTopUpCount: webTopUpEntries.length,
    generatedAt: new Date().toISOString(),
  });
});