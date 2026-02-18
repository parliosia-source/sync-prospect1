import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { startOfDay, endOfDay, format } from "date-fns";
import { fr } from "date-fns/locale";
import { Building2, ChevronRight, AlertTriangle, Clock, LayoutGrid, List, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatusBadge from "@/components/shared/StatusBadge";
import LeadBoard from "@/components/leads/LeadBoard";

const VIEWS = ["Aujourd'hui", "Overdue", "Tous", "Board"];
const ACTION_LABELS = { FOLLOW_UP_J7: "Relance J+7", FOLLOW_UP_J14: "Relance J+14", CALL: "Appel", SEND_MESSAGE: "Message", CUSTOM: "Action" };

export default function Pipeline() {
  const [user, setUser] = useState(null);
  const [leads, setLeads] = useState([]);
  const [activeView, setActiveView] = useState("Tous");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(setUser);
  }, []);

  useEffect(() => {
    if (!user) return;
    const f = user.role === "admin" ? {} : { ownerUserId: user.email };
    base44.entities.Lead.filter(f, "-updated_date", 200).then(data => {
      setLeads(data);
      setIsLoading(false);
    });
  }, [user]);

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
          <h1 className="text-2xl font-bold text-slate-900">Pipeline</h1>
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
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden lg:table-cell">Prochaine action</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 hidden lg:table-cell">Échéance</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Ouvrir</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(lead => {
                const isOverdue = lead.nextActionDueAt && lead.nextActionStatus === "ACTIVE" && new Date(lead.nextActionDueAt) < todayStart;
                return (
                  <tr key={lead.id} className={`hover:bg-slate-50 ${isOverdue ? "bg-red-50" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isOverdue && <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                        <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <div>
                          <div className="font-medium text-slate-800">{lead.companyName}</div>
                          <div className="text-xs text-slate-400">{lead.domain}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <StatusBadge status={lead.status} type="lead" />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-600">
                      {ACTION_LABELS[lead.nextActionType] || "—"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs">
                      {lead.nextActionDueAt && lead.nextActionStatus === "ACTIVE" ? (
                        <span className={isOverdue ? "text-red-600 font-medium" : "text-slate-600"}>
                          {format(new Date(lead.nextActionDueAt), "d MMM", { locale: fr })}
                          {isOverdue && " (retard)"}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link to={createPageUrl("LeadDetail") + "?id=" + lead.id} className="p-1.5 text-slate-400 hover:text-blue-500 inline-flex">
                        <ChevronRight className="w-4 h-4" />
                      </Link>
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