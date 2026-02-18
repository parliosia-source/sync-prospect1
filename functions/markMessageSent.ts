import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { addDays } from 'npm:date-fns@3';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId, leadId, channel } = await req.json();
  if (!leadId) return Response.json({ error: "leadId requis" }, { status: 400 });

  const leads = await base44.entities.Lead.filter({ id: leadId });
  const lead = leads[0];
  if (!lead) return Response.json({ error: "Lead introuvable" }, { status: 404 });
  if (lead.ownerUserId !== user.email && user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const messageCount = (lead.messageCount || 0) + 1;

  // Determine next action: J+7 after first send, J+14 after subsequent
  const daysToNext = messageCount === 1 ? 7 : 14;
  const nextActionType = messageCount === 1 ? "FOLLOW_UP_J7" : "FOLLOW_UP_J14";
  const nextActionDueAt = addDays(now, daysToNext).toISOString();

  // Cancel any existing active nextAction, create new one
  await base44.entities.Lead.update(leadId, {
    status: lead.status === "NEW" ? "CONTACTED" : lead.status,
    messageCount,
    lastContactedAt: now.toISOString(),
    nextActionType,
    nextActionDueAt,
    nextActionStatus: "ACTIVE",
  });

  // Mark message as SENT
  if (messageId) {
    await base44.entities.Message.update(messageId, { status: "SENT", sentAt: now.toISOString() });
  }

  await base44.entities.ActivityLog.create({
    ownerUserId: user.email,
    actionType: "MARK_MESSAGE_SENT",
    entityType: "Lead",
    entityId: leadId,
    payload: { messageId, channel, messageCount, nextActionDueAt },
    status: "SUCCESS",
  });

  return Response.json({ success: true, nextActionDueAt, nextActionType });
});