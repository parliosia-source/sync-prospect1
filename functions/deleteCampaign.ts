import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { campaignId, deleteProspects } = await req.json();
  if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

  const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
  if (campaign.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only allow delete on DRAFT, DONE_PARTIAL, ERROR, COMPLETED, CANCELED
  const deletableStatuses = ["DRAFT", "DONE_PARTIAL", "ERROR", "COMPLETED", "CANCELED"];
  if (!deletableStatuses.includes(campaign.status)) {
    return Response.json({ error: `Impossible de supprimer une campagne ${campaign.status}` }, { status: 400 });
  }

  // Delete prospects if requested
  if (deleteProspects) {
    const prospects = await base44.entities.Prospect.filter({ campaignId });
    for (const p of prospects) {
      await base44.entities.Prospect.delete(p.id);
    }
  }

  // Delete the campaign
  await base44.entities.Campaign.delete(campaignId);

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "DELETE_CAMPAIGN",
    entityType: "Campaign",
    entityId: campaignId,
    payload: { campaignName: campaign.name, status: campaign.status, deleteProspects },
    status: "SUCCESS"
  });

  return Response.json({ success: true });
});