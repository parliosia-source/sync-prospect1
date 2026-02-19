import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Admin one-shot: sets seedBatchId on all KBEntity records where it is empty/missing.
// Usage: invoke('setSeedBatchId', { batchId: "CA_QC_v1" })
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return Response.json({ error: "Forbidden: admin only" }, { status: 403 });

  const body = await req.json();
  const batchId = body.batchId || "CA_QC_v1";

  // Fetch all KB entities (up to 1000)
  const all = await base44.asServiceRole.entities.KBEntity.filter({}, "-created_date", 1000);

  const toUpdate = all.filter(e => !e.seedBatchId);
  let updated = 0;

  for (const e of toUpdate) {
    await base44.asServiceRole.entities.KBEntity.update(e.id, { seedBatchId: batchId });
    updated++;
  }

  return Response.json({
    success: true,
    total: all.length,
    updated,
    skipped: all.length - updated,
    batchId,
  });
});