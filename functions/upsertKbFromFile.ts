import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { kbData, dryRun } = await req.json();
  if (!Array.isArray(kbData) || kbData.length === 0) return Response.json({ error: 'kbData is required and must be non-empty array' }, { status: 400 });

  let upserted = 0, created = 0, updated = 0, skipped = 0;
  const errors = [];

  for (const kb of kbData) {
    if (!kb.domain || !kb.name) { skipped++; continue; }
    const domNorm = kb.domain.toLowerCase().replace(/^www\./, '');
    
    try {
      const existing = await base44.entities.KBEntity.filter({ domain: domNorm }).catch(() => []);
      const payload = {
        name: kb.name,
        domain: domNorm,
        website: kb.website || null,
        hqLocation: kb.hqLocation || null,
        entityType: kb.entityType || null,
        tags: Array.isArray(kb.tags) ? kb.tags : [],
        notes: kb.notes || null,
        source: kb.source || null,
        lastVerifiedAt: kb.lastVerifiedAt || null,
        seedBatchId: kb.seedBatchId || null,
        seedBatchIds: Array.isArray(kb.seedBatchIds) ? kb.seedBatchIds : [],
        industrySectors: Array.isArray(kb.industrySectors) ? kb.industrySectors : [],
        industryLabel: kb.industryLabel || null,
      };

      if (!dryRun) {
        if (existing.length > 0) {
          await base44.entities.KBEntity.update(existing[0].id, payload);
          updated++;
        } else {
          await base44.entities.KBEntity.create(payload);
          created++;
        }
      }
      upserted++;
    } catch (e) {
      errors.push({ domain: domNorm, error: e.message });
    }
  }

  return Response.json({
    success: true,
    summary: { total: kbData.length, upserted, created, updated, skipped, errors: errors.length },
    errors: errors.slice(0, 10),
    dryRun,
  });
});