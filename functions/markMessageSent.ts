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

  // J+7 on first send, J+14 on subsequent
  const daysToNext = messageCount === 1 ? 7 : 14;
  const nextActionType = messageCount === 1 ? "FOLLOW_UP_J7" : "FOLLOW_UP_J14";
  const nextActionDueAt = addDays(now, daysToNext).toISOString();

  // Update Lead: CONTACTED (unless already further along), bump messageCount, set nextAction
  const advanceStatuses = ["REPLIED", "MEETING", "CLOSED_WON", "CLOSED_LOST"];
  const newLeadStatus = advanceStatuses.includes(lead.status) ? lead.status : "CONTACTED";

  await base44.entities.Lead.update(leadId, {
    status: newLeadStatus,
    messageCount,
    lastContactedAt: now.toISOString(),
    nextActionType,
    nextActionDueAt,
    nextActionStatus: "ACTIVE",
    nextActionNote: `Relance suite à l'envoi du ${now.toLocaleDateString("fr-CA")}`,
  });

  // Mark message as SENT with final content
  if (messageId) {
    const msgUpdate = {
      status: "SENT",
      sentAt: now.toISOString(),
    };
    // Store final edited content if provided
    if (editedSubject !== undefined) msgUpdate.editedSubject = editedSubject;
    if (editedBody !== undefined) msgUpdate.editedBody = editedBody;
    // Keep subject/body as the authoritative sent version
    if (subject !== undefined) msgUpdate.subject = subject;
    if (body !== undefined) msgUpdate.body = body;

    await base44.entities.Message.update(messageId, msgUpdate);
  }

  // Log the activity
  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "MESSAGE_SENT_CONFIRMED",
    entityType: "Lead",
    entityId: leadId,
    payload: { messageId, channel, messageCount, nextActionDueAt, nextActionType },
    status: "SUCCESS",
  });

  return Response.json({
    success: true,
    nextActionDueAt,
    nextActionType,
    nextActionDueDateFormatted: addDays(now, daysToNext).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" }),
  });
});