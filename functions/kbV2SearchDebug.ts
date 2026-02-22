import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normText(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\w\s]/g, ' ');
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const locationQuery   = body.locationQuery   || 'Montréal, QC';
  const industrySectors = body.industrySectors || [];

  const locNorm = normText(locationQuery);
  const isMTL   = /montr/.test(locNorm);
  const isQC    = /\b(qc|qu[eé]bec)\b/.test(locNorm);

  // 1. Load all KBEntityV2 (paginated, up to 3000)
  let allEntities = [];
  for (let page = 0; page < 6; page++) {
    const batch = await base44.asServiceRole.entities.KBEntityV2.list('-confidenceScore', 500, page * 500).catch(() => []);
    if (!batch || batch.length === 0) break;
    allEntities = allEntities.concat(batch);
    if (batch.length < 500) break;
  }
  const totalKB = allEntities.length;

  // 2. Region filter
  let afterRegion = [];
  const rejected_region = [];
  for (const e of allEntities) {
    if (isMTL) {
      if (e.hqRegion === 'MTL') afterRegion.push(e);
      else rejected_region.push({ domain: e.domain, name: e.name, reason: `hqRegion=${e.hqRegion} (want MTL)` });
    } else if (isQC) {
      if (e.hqProvince === 'QC') afterRegion.push(e);
      else rejected_region.push({ domain: e.domain, name: e.name, reason: `hqProvince=${e.hqProvince} (want QC)` });
    } else {
      afterRegion.push(e); // No geo filter
    }
  }

  // 3. Sector filter
  let afterSector = [];
  const rejected_sector = [];
  for (const e of afterRegion) {
    if (industrySectors.length === 0) {
      afterSector.push(e);
      continue;
    }
    const kbSectors = Array.isArray(e.industrySectors) ? e.industrySectors : [];
    const intersection = kbSectors.filter(s => industrySectors.includes(s));
    if (intersection.length > 0) {
      afterSector.push({ ...e, _matchedSectors: intersection });
    } else {
      rejected_sector.push({ domain: e.domain, name: e.name, reason: `sectors=${JSON.stringify(kbSectors)} (want ${industrySectors.join(',')})` });
    }
  }

  // 4. Sample accepted/rejected
  const accepted = afterSector.slice(0, 20).map(e => ({
    name: e.name, domain: e.domain,
    hqRegion: e.hqRegion, hqCity: e.hqCity, hqProvince: e.hqProvince,
    industrySectors: e.industrySectors, confidenceScore: e.confidenceScore,
    matchedSectors: e._matchedSectors || e.industrySectors,
  }));

  const rejected = [
    ...rejected_region.slice(0, 10).map(r => ({ ...r, phase: 'REGION' })),
    ...rejected_sector.slice(0, 10).map(r => ({ ...r, phase: 'SECTOR' })),
  ].slice(0, 20);

  return Response.json({
    locationQuery, industrySectors,
    filters: { isMTL, isQC },
    totalKB,
    afterRegionFilter: afterRegion.length,
    afterSectorFilter: afterSector.length,
    accepted,
    rejected,
  });
});