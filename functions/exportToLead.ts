import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { prospectId } = await req.json();
  if (!prospectId) return Response.json({ error: "prospectId requis" }, { status: 400 });

  const prospects = await base44.entities.Prospect.filter({ id: prospectId });
  const prospect = prospects[0];
  if (!prospect) return Response.json({ error: "Prospect introuvable" }, { status: 404 });
  if (prospect.ownerUserId !== user.email && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  // Idempotency check: 1st by prospectId, fallback by domain+owner
  let existingLeads = await base44.entities.Lead.filter({ prospectId });
  if (existingLeads.length === 0 && prospect.domain) {
    existingLeads = await base44.entities.Lead.filter({ domain: prospect.domain, ownerUserId: prospect.ownerUserId });
  }

  if (existingLeads.length > 0) {
    const lead = existingLeads[0];
    // Ensure prospect status is EXPORTÉ
    if (prospect.status !== "EXPORTÉ") {
      await base44.entities.Prospect.update(prospectId, { status: "EXPORTÉ", leadId: lead.id });
    }
    return Response.json({ success: true, leadId: lead.id, existing: true });
  }

  // Get primary contact
  const contacts = await base44.entities.Contact.filter({ prospectId });
  const primaryContact = contacts.find(c => c.hasEmail) || contacts[0];

  // Create Lead
  const lead = await base44.entities.Lead.create({
    prospectId,
    ownerUserId: prospect.ownerUserId,
    companyName: prospect.companyName,
    website: prospect.website,
    domain: prospect.domain,
    industry: prospect.industry,
    location: prospect.location,
    primaryContactId: primaryContact?.id || null,
    status: "NEW",
    segment: prospect.segment,
    messageCount: 0,
  });

  // Update prospect
  await base44.entities.Prospect.update(prospectId, { status: "EXPORTÉ", leadId: lead.id });

  // Update campaign counter
  if (prospect.campaignId) {
    const campaigns = await base44.entities.Campaign.filter({ id: prospect.campaignId });
    if (campaigns[0]) {
      await base44.entities.Campaign.update(prospect.campaignId, {
        countExported: (campaigns[0].countExported || 0) + 1,
      });
    }
  }

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "EXPORT_TO_LEAD",
    entityType: "Prospect",
    entityId: prospectId,
    payload: { leadId: lead.id },
    status: "SUCCESS",
  });

  return Response.json({ success: true, leadId: lead.id, existing: false });
});