import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ArrowLeft, Globe, Brain, RefreshCw, Calendar, MessageSquare, Building2, User, Clock, Send, Plus, CheckCircle2, PhoneCall } from "lucide-react";
import ActivityTimeline from "@/components/leads/ActivityTimeline";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import StatusBadge from "@/components/shared/StatusBadge";
import MessageComposer from "@/components/messages/MessageComposer";
import { toast } from "sonner";

const ACTION_LABELS = { FOLLOW_UP_J7: "Relance J+7", FOLLOW_UP_J14: "Relance J+14", CALL: "Appel", SEND_MESSAGE: "Message", CUSTOM: "Action" };

export default function LeadDetail() {
  const params = new URLSearchParams(window.location.search);
  const leadId = params.get("id");

  const [user, setUser] = useState(null);
  const [lead, setLead] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [msgChannel, setMsgChannel] = useState("LINKEDIN");
  const [msgType, setMsgType] = useState("FIRST_MESSAGE");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [notes, setNotes] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  useEffect(() => { base44.auth.me().then(setUser); }, []);
  useEffect(() => { if (leadId) loadData(); }, [leadId]);

  const loadData = async () => {
    const l = await base44.entities.Lead.filter({ id: leadId }).then(r => r[0]);
    setLead(l);
    setNotes(l?.notes || "");
    if (l?.prospectId) {
      const [ctcts, msgs] = await Promise.all([
        base44.entities.Contact.filter({ prospectId: l.prospectId }),
        base44.entities.Message.filter({ leadId }, "-created_date", 20),
      ]);
      setContacts(ctcts);
      setMessages(msgs);
      if (ctcts.length > 0) setSelectedContactId(ctcts[0].id);
      if (l.messageCount === 0) setMsgType("FIRST_MESSAGE");
      else if (l.messageCount === 1) setMsgType("FOLLOW_UP_J7");
      else setMsgType("FOLLOW_UP_J14");
    }
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    const res = await base44.functions.invoke("generateMessage", {
      leadId,
      prospectId: lead?.prospectId,
      channel: msgChannel,
      templateType: msgType,
      contactId: selectedContactId || undefined,
    });
    if (res?.data?.body) {
      // Check for existing DRAFT to warn user
      const existingDrafts = messages.filter(m => m.status === "DRAFT");
      if (existingDrafts.length > 0) {
        const ok = window.confirm(`Il existe déjà ${existingDrafts.length} brouillon(s). Créer un nouveau message quand même ?`);
        if (!ok) { setIsGenerating(false); return; }
      }
      await base44.entities.Message.create({
        leadId,
        prospectId: lead?.prospectId,
        ownerUserId: user?.email,
        channel: msgChannel,
        subject: res.data.subject || "",
        body: res.data.body,
        generatedBody: res.data.generatedBody || res.data.body,
        generatedSubject: res.data.generatedSubject || res.data.subject || "",
        status: "DRAFT",
        activeVersion: "GENERATED",
        generatedByAI: true,
      });
      await loadData();
      toast.success("Message généré et enregistré en brouillon");
    }
    setIsGenerating(false);
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    await base44.entities.Lead.update(leadId, { notes });
    setIsSavingNotes(false);
    toast.success("Notes sauvegardées");
  };

  const handleUpdateStatus = async (status) => {
    await base44.entities.Lead.update(leadId, { status });
    setLead(l => ({ ...l, status }));
  };

  if (!lead) return (
    <div className="p-6">
      <div className="h-8 w-48 bg-slate-100 rounded animate-pulse mb-4" />
      <div className="h-40 bg-slate-100 rounded animate-pulse" />
    </div>
  );

  const isOverdue = lead.nextActionDueAt && lead.nextActionStatus === "ACTIVE" && new Date(lead.nextActionDueAt) < new Date();
  const draftMessages = messages.filter(m => m.status === "DRAFT" || m.status === "COPIED");
  const sentMessages = messages.filter(m => m.status === "SENT");

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <Link to={createPageUrl("Pipeline")} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-4 h-4" /> Suivi
        </Link>
        {lead.prospectId && (
          <Link to={createPageUrl("ProspectDetail") + "?id=" + lead.prospectId} className="ml-auto text-xs text-blue-600 hover:underline">
            Voir le prospect →
          </Link>
        )}
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">{lead.companyName}</h1>
              <StatusBadge status={lead.status} type="lead" />
              {lead.segment && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${lead.segment === "HOT" ? "bg-orange-100 text-orange-700" : "bg-slate-100 text-slate-600"}`}>
                  {lead.segment}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500 flex-wrap">
              {lead.website && (
                <a href={lead.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                  <Globe className="w-3.5 h-3.5" />{lead.domain || lead.website}
                </a>
              )}
              {lead.industry && <span>{lead.industry}</span>}
              <span className="flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{lead.messageCount || 0} message(s)</span>
            </div>
          </div>
          <Select value={lead.status} onValueChange={handleUpdateStatus}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="NEW">Nouveau</SelectItem>
              <SelectItem value="CONTACTED">Contacté</SelectItem>
              <SelectItem value="REPLIED">A répondu</SelectItem>
              <SelectItem value="MEETING">Meeting</SelectItem>
              <SelectItem value="CLOSED_WON">Gagné</SelectItem>
              <SelectItem value="CLOSED_LOST">Perdu</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Next action */}
        {lead.nextActionDueAt && lead.nextActionStatus === "ACTIVE" && (
          <div className={`mt-3 flex items-center gap-2 p-3 rounded-lg ${isOverdue ? "bg-red-50 border border-red-100" : "bg-blue-50 border border-blue-100"}`}>
            <Clock className={`w-4 h-4 flex-shrink-0 ${isOverdue ? "text-red-500" : "text-blue-500"}`} />
            <div>
              <span className={`text-sm font-medium ${isOverdue ? "text-red-700" : "text-blue-700"}`}>
                {ACTION_LABELS[lead.nextActionType] || "Action"} — {format(new Date(lead.nextActionDueAt), "d MMMM yyyy", { locale: fr })}
                {isOverdue && " (en retard)"}
              </span>
              {lead.nextActionNote && <div className="text-xs text-slate-500 mt-0.5">{lead.nextActionNote}</div>}
            </div>
          </div>
        )}

        {/* Contacts */}
        {contacts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {contacts.map(c => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border text-xs">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-medium">{c.fullName || `${c.firstName || ""} ${c.lastName || ""}`.trim()}</span>
                {c.title && <span className="text-slate-400">· {c.title}</span>}
                {c.email && <span className="text-blue-600">{c.email}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate new message */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h3 className="font-semibold text-sm text-slate-800 mb-4 flex items-center gap-2">
          <Brain className="w-4 h-4 text-blue-500" /> Générer un message
        </h3>
        <div className="flex flex-wrap gap-3">
          <Select value={msgChannel} onValueChange={setMsgChannel}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
            </SelectContent>
          </Select>
          <Select value={msgType} onValueChange={setMsgType}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="FIRST_MESSAGE">Premier message</SelectItem>
              <SelectItem value="FOLLOW_UP_J7">Relance J+7</SelectItem>
              <SelectItem value="FOLLOW_UP_J14">Relance J+14</SelectItem>
            </SelectContent>
          </Select>
          {contacts.length > 0 && (
            <Select value={selectedContactId} onValueChange={setSelectedContactId}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Contact…" /></SelectTrigger>
              <SelectContent>
                {contacts.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName || `${c.firstName} ${c.lastName}`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={handleGenerate} disabled={isGenerating} className="bg-blue-600 hover:bg-blue-700 gap-2">
            {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {isGenerating ? "Génération…" : "Générer"}
          </Button>
        </div>
      </div>

      {/* Active drafts / composers */}
      {draftMessages.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-sm text-slate-700 flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-500" /> Messages en cours ({draftMessages.length})
          </h3>
          {draftMessages.map(m => (
            <MessageComposer key={m.id} message={m} onUpdated={loadData} />
          ))}
        </div>
      )}

      {/* Sent history */}
      {sentMessages.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="font-semibold text-sm text-slate-800 mb-3 flex items-center gap-2">
            <Send className="w-4 h-4 text-green-500" /> Historique des envois ({sentMessages.length})
          </h3>
          <div className="space-y-3">
            {sentMessages.map(m => (
              <div key={m.id} className="p-3 bg-slate-50 rounded-lg border text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${m.channel === "LINKEDIN" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                    {m.channel}
                  </span>
                  <span className="text-xs text-slate-400">{m.sentAt ? format(new Date(m.sentAt), "d MMM yyyy à HH:mm", { locale: fr }) : ""}</span>
                </div>
                {(m.subject || m.editedSubject) && <div className="text-xs font-medium text-slate-600 mb-1">Sujet: {m.editedSubject || m.subject}</div>}
                <div className="text-xs text-slate-600 line-clamp-3 whitespace-pre-wrap">{m.editedBody || m.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h3 className="font-semibold text-sm text-slate-800 mb-3">Notes</h3>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Ajouter des notes sur ce lead…"
          className="text-sm min-h-24 resize-none"
        />
        <div className="flex justify-end mt-2">
          <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={isSavingNotes}>
            {isSavingNotes ? "Sauvegarde…" : "Sauvegarder"}
          </Button>
        </div>
      </div>
    </div>
  );
}