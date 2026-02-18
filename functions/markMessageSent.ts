import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { addDays } from 'npm:date-fns@3';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId, leadId, channel, subject, body, editedSubject, editedBody } = await req.json();
  if (!leadId) return Response.json({ error: "leadId requis" }, { status: 400 });

  const leads = await base44.entities.Lead.filter({ id: leadId });
  const lead = leads[0];
  if (!lead) return Response.json({ error: "Lead introuvable" }, { status: 404 });
  if (lead.ownerUserId !== user.email && user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const messageCount = (lead.messageCount || 0) + 1;

  // J+7 after first message, J+14 after subsequent ones
  const daysToNext = messageCount === 1 ? 7 : 14;
  const nextActionType = messageCount === 1 ? "FOLLOW_UP_J7" : "FOLLOW_UP_J14";
  const nextActionDueAt = addDays(now, daysToNext).toISOString();

  // Update lead
  const statusesToNotDowngrade = ["REPLIED", "MEETING", "CLOSED_WON", "CLOSED_LOST"];
  const newLeadStatus = statusesToNotDowngrade.includes(lead.status) ? lead.status : "CONTACTED";

  await base44.entities.Lead.update(leadId, {
    status: newLeadStatus,
    messageCount,
    lastContactedAt: now.toISOString(),
    nextActionType,
    nextActionDueAt,
    nextActionStatus: "ACTIVE",
    nextActionNote: `Relance suite à envoi ${channel || "message"} du ${now.toLocaleDateString("fr-CA")}`,
  });

  // Mark message SENT with final content
  if (messageId) {
    const msgUpdate = {
      status: "SENT",
      sentAt: now.toISOString(),
      activeVersion: (editedBody || body) ? "EDITED" : "GENERATED",
    };
    if (editedSubject !== undefined) msgUpdate.editedSubject = editedSubject;
    if (editedBody !== undefined) msgUpdate.editedBody = editedBody;
    // Also update body/subject to final version for easy read
    if (body) msgUpdate.body = body;
    if (subject) msgUpdate.subject = subject;
    await base44.entities.Message.update(messageId, msgUpdate);
  }

  // Log activity with enriched metadata
  const bodyPreview = (editedBody || body || "").slice(0, 200);
  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "MESSAGE_SENT",
    entityType: "Lead",
    entityId: leadId,
    payload: {
      messageId,
      channel: channel || "INCONNU",
      messageCount,
      nextActionDueAt,
      nextActionType,
      activeVersion: editedBody ? "EDITED" : "GENERATED",
      bodyPreview: bodyPreview || null,
      subject: (editedSubject || subject || null),
    },
    status: "SUCCESS",
  });

  return Response.json({ success: true, nextActionDueAt, nextActionType, messageCount });
});