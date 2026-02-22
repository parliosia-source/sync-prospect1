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
  const { target = 150 } = body;

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

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;

  const coverage = ALL_SECTORS.map(sector => {
    // GM = MTL or GM hqRegion
    const gmEntries = all.filter(e => {
      const secs = Array.isArray(e.industrySectors) ? e.industrySectors : [];
      return secs.includes(sector) && (e.hqRegion === "MTL" || e.hqRegion === "GM");
    });

    const count = gmEntries.length;
    const gap = Math.max(0, target - count);

    // Last inserted date
    const sortedByDate = [...gmEntries].sort((a, b) =>
      new Date(b.created_date || 0) - new Date(a.created_date || 0)
    );
    const lastInsertedAt = sortedByDate[0]?.created_date || null;

    // Inserted last 7 days
    const insertedLast7Days = gmEntries.filter(e =>
      e.created_date && new Date(e.created_date).getTime() > sevenDaysAgo
    ).length;

    // Avg confidence
    const scores = gmEntries.map(e => e.confidenceScore || 0).filter(s => s > 0);
    const avgConfidence = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    // Source breakdown
    const bySource = {};
    for (const e of gmEntries) {
      const src = e.sourceOrigin || "UNKNOWN";
      bySource[src] = (bySource[src] || 0) + 1;
    }

    return {
      sector,
      currentCountGM: count,
      gapTo150: gap,
      pctCoverage: Math.min(100, Math.round((count / target) * 100)),
      lastInsertedAt,
      insertedLast7Days,
      avgConfidence,
      bySource,
    };
  });

  const totalGM = all.filter(e => e.hqRegion === "MTL" || e.hqRegion === "GM").length;
  const totalAll = all.length;
  const harvestEntries = all.filter(e => (e.qualityFlags || []).includes("WEB_HARVEST")).length;

  return Response.json({
    target,
    totalKBEntityV2: totalAll,
    totalGM,
    harvestEntries,
    generatedAt: new Date().toISOString(),
    coverage,
    summary: coverage.map(c => `${c.sector}: ${c.currentCountGM}/${target} (gap=${c.gapTo150})`),
  });
});