import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { campaignId } = await req.json();
  if (!campaignId) return Response.json({ error: "campaignId requis" }, { status: 400 });

  const campaigns = await base44.entities.Campaign.filter({ id: campaignId });
  const campaign = campaigns[0];
  if (!campaign) return Response.json({ error: "Campagne introuvable" }, { status: 404 });
  if (campaign.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Can only cancel RUNNING campaigns
  if (campaign.status !== "RUNNING") {
    return Response.json({ error: `Impossible d'annuler une campagne ${campaign.status}` }, { status: 400 });
  }

  await base44.entities.Campaign.update(campaignId, {
    status: "CANCELED",
    progressPct: 100,
    errorMessage: "Annulée par l'utilisateur"
  });

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "CANCEL_CAMPAIGN",
    entityType: "Campaign",
    entityId: campaignId,
    payload: { campaignName: campaign.name, previousStatus: campaign.status },
    status: "SUCCESS"
  });

  return Response.json({ success: true });
});