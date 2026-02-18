import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { startOfDay, endOfDay, format } from "date-fns";
import { fr } from "date-fns/locale";
import { Building2, ChevronRight, AlertTriangle, Clock, LayoutGrid, List, Calendar, MessageSquare, CheckCircle2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import LeadBoard from "@/components/leads/LeadBoard";
import { toast } from "sonner";

const VIEWS = ["Aujourd'hui", "Overdue", "Tous", "Board"];
const ACTION_LABELS = { FOLLOW_UP_J7: "Relance J+7", FOLLOW_UP_J14: "Relance J+14", CALL: "Appel", SEND_MESSAGE: "Message", CUSTOM: "Action" };

export default function Pipeline() {
  const [user, setUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [draftsByLead, setDraftsByLead] = useState({});
  const [activeView, setActiveView] = useState("Tous");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadLeads();
  }, [user]);

  const loadLeads = async () => {
    const f = user.role === "admin" ? {} : { ownerUserId: user.email };
    const [data, msgs] = await Promise.all([
      base44.entities.Lead.filter(f, "-updated_date", 200),
      base44.entities.Message.filter(user.role === "admin" ? {} : { ownerUserId: user.email }, "-created_date", 500),
    ]);
    setLeads(data);
    // Group messages by lead: track drafts and recent sent
    const byLead = {};
    msgs.forEach(m => {
      if (!m.leadId) return;
      if (!byLead[m.leadId]) byLead[m.leadId] = { drafts: [], lastSent: null };
      if (m.status === "DRAFT" || m.status === "COPIED") {
        byLead[m.leadId].drafts.push(m);
      } else if (m.status === "SENT") {
        if (!byLead[m.leadId].lastSent || new Date(m.sentAt) > new Date(byLead[m.leadId].lastSent.sentAt)) {
          byLead[m.leadId].lastSent = m;
        }
      }
    });
    setDraftsByLead(byLead);
    setIsLoading(false);
  };

  const handleQuickStatus = async (lead, status) => {
    const updates = { status };
    if (status === "REPLIED") {
      // Stop active follow-ups — commercial will decide next step manually
      updates.nextActionStatus = "CANCELED";
      updates.nextActionDueAt = null;
    } else if (status === "MEETING") {
      updates.nextActionStatus = "CANCELED";
      updates.nextActionDueAt = null;
    }
    await base44.entities.Lead.update(lead.id, updates);

    // Log
    const actionTypeMap = { REPLIED: "LEAD_REPLIED", MEETING: "LEAD_MEETING" };
    await base44.entities.ActivityLog.create({
      ownerUserId: user?.email,
      actionType: actionTypeMap[status] || "LEAD_STATUS_CHANGED",
      entityType: "Lead",
      entityId: lead.id,
      payload: { status, relancesStopped: true },
      status: "SUCCESS",
    });

    toast.success(status === "REPLIED" ? "✓ A répondu — relances arrêtées" : "✓ RDV enregistré — relances arrêtées");
    loadLeads();
  };

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const getFiltered = () => {
    const active = leads.filter(l => l.nextActionStatus === "ACTIVE" && l.nextActionDueAt);
    if (activeView === "Aujourd'hui") return active.filter(l => new Date(l.nextActionDueAt) >= todayStart && new Date(l.nextActionDueAt) <= todayEnd);
    if (activeView === "Overdue") return active.filter(l => new Date(l.nextActionDueAt) < todayStart);
    return leads;
  };

  const filtered = getFiltered();

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Suivi des leads</h1>
          <p className="text-sm text-slate-500 mt-0.5">{leads.length} leads · {leads.filter(l => l.nextActionStatus === "ACTIVE").length} actions actives</p>
        </div>
      </div>

      {/* View tabs */}
      <div className="flex gap-1 mb-5">
        {VIEWS.map(v => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeView === v ? "bg-blue-600 text-white" : "bg-white border text-slate-600 hover:bg-slate-50"
            }`}
          >
            {v === "Board" && <LayoutGrid className="w-3.5 h-3.5" />}
            {v === "Aujourd'hui" && <Calendar className="w-3.5 h-3.5" />}
            {v === "Overdue" && <AlertTriangle className="w-3.5 h-3.5" />}
            {v === "Tous" && <List className="w-3.5 h-3.5" />}
            {v}
            {v !== "Board" && filtered.length > 0 && activeView === v && (
              <span className="bg-white bg-opacity-30 text-white text-xs px-1.5 rounded-full">{filtered.length}</span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : activeView === "Board" ? (
        <LeadBoard leads={leads.filter(l => !["CLOSED_LOST"].includes(l.status))} />
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center bg-white rounded-xl border">
          <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">
            {activeView === "Aujourd'hui" ? "Aucune action prévue aujourd'hui" :
             activeView === "Overdue" ? "Aucun lead en retard 🎉" :
             "Aucun lead dans le pipeline"}
          </p>
          {activeView === "Tous" && (
            <p className="text-sm text-slate-400 mt-1">Exportez des prospects qualifiés pour les voir ici</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Entreprise</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden md:table-cell">Statut</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden lg:table-cell">Dernier contact</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden lg:table-cell">Prochaine relance</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(lead => {
                const isOverdue = lead.nextActionDueAt && lead.nextActionStatus === "ACTIVE" && new Date(lead.nextActionDueAt) < todayStart;
                return (
                  <tr key={lead.id} className={`hover:bg-slate-50 ${isOverdue ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                        <div>
                          <div className="font-medium text-slate-800">{lead.companyName}</div>
                          <div className="text-xs text-slate-400">{lead.domain || lead.industry || ""}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <StatusBadge status={lead.status} type="lead" />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                     <div className="flex flex-col gap-1 text-xs">
                       {draftsByLead[lead.id]?.lastSent ? (
                         <div className="flex items-center gap-1.5 text-green-700 font-medium">
                           <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                           <span>Envoyé le {format(new Date(draftsByLead[lead.id].lastSent.sentAt), "d MMM", { locale: fr })}</span>
                         </div>
                       ) : lead.lastContactedAt ? (
                         <div className="flex items-center gap-1.5 text-slate-500">
                           <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                           <span>Contacté le {format(new Date(lead.lastContactedAt), "d MMM", { locale: fr })}</span>
                         </div>
                       ) : (
                         <span className="text-slate-300">Pas encore contacté</span>
                       )}
                       {(lead.messageCount || 0) > 0 && (
                         <span className="text-slate-400">{lead.messageCount} message{lead.messageCount > 1 ? "s" : ""} envoyé{lead.messageCount > 1 ? "s" : ""}</span>
                       )}
                       {draftsByLead[lead.id]?.drafts?.length > 0 && (
                         <Link
                           to={createPageUrl("LeadDetail") + "?id=" + lead.id}
                           className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 hover:bg-amber-200 w-fit"
                         >
                           ✏️ Brouillon en attente
                         </Link>
                       )}
                     </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs">
                      {lead.nextActionDueAt && lead.nextActionStatus === "ACTIVE" ? (
                        <div className="flex flex-col gap-0.5">
                          <div className={`font-medium ${isOverdue ? "text-red-600" : "text-slate-700"}`}>
                            {ACTION_LABELS[lead.nextActionType] || "Action"}
                          </div>
                          <div className={`flex items-center gap-1 ${isOverdue ? "text-red-500 font-medium" : "text-slate-400"}`}>
                            <Calendar className="w-3 h-3" />
                            {format(new Date(lead.nextActionDueAt), "d MMM yyyy", { locale: fr })}
                            {isOverdue && <span className="text-red-500">⚠️ En retard</span>}
                          </div>
                        </div>
                      ) : lead.nextActionStatus === "DONE" ? (
                        <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Fait</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {lead.status === "CONTACTED" && (
                          <>
                            <button onClick={() => handleQuickStatus(lead, "REPLIED")} title="A répondu" className="p-1 rounded hover:bg-green-50 text-slate-400 hover:text-green-600">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleQuickStatus(lead, "MEETING")} title="RDV" className="p-1 rounded hover:bg-blue-50 text-slate-400 hover:text-blue-600">
                              <PhoneCall className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <Link to={createPageUrl("LeadDetail") + "?id=" + lead.id} className="p-1.5 text-slate-400 hover:text-blue-500 inline-flex">
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}