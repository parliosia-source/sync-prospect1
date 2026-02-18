import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Building2, ChevronRight } from "lucide-react";
import StatusBadge from "@/components/shared/StatusBadge";

const COLUMNS = [
  { key: "NEW", label: "Nouveau" },
  { key: "CONTACTED", label: "Contacté" },
  { key: "REPLIED", label: "A répondu" },
  { key: "MEETING", label: "Meeting" },
  { key: "CLOSED_WON", label: "Gagné" },
];

const COL_COLORS = {
  NEW: "border-t-slate-400",
  CONTACTED: "border-t-blue-400",
  REPLIED: "border-t-yellow-400",
  MEETING: "border-t-orange-400",
  CLOSED_WON: "border-t-green-500",
};

export default function LeadBoard({ leads }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {COLUMNS.map(col => {
        const colLeads = leads.filter(l => l.status === col.key);
        return (
          <div key={col.key} className={`flex-shrink-0 w-60 bg-slate-50 rounded-xl border border-t-4 ${COL_COLORS[col.key]}`}>
            <div className="px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">{col.label}</span>
              <span className="text-xs text-slate-400 bg-slate-200 rounded-full px-1.5 py-0.5">{colLeads.length}</span>
            </div>
            <div className="px-2 pb-2 space-y-2">
              {colLeads.map(lead => (
                <Link
                  key={lead.id}
                  to={createPageUrl("LeadDetail") + "?id=" + lead.id}
                  className="block bg-white rounded-lg border p-3 hover:shadow-sm hover:border-blue-200 transition-all group"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{lead.companyName}</div>
                      <div className="text-xs text-slate-400 truncate">{lead.industry || lead.domain}</div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-slate-300 group-hover:text-blue-400 flex-shrink-0 mt-0.5" />
                  </div>
                  {lead.nextActionDueAt && lead.nextActionStatus === "ACTIVE" && (
                    <div className="mt-2 text-xs text-slate-500">
                      🎯 {new Date(lead.nextActionDueAt) < new Date()
                        ? <span className="text-red-500 font-medium">En retard</span>
                        : new Date(lead.nextActionDueAt).toLocaleDateString("fr-CA")
                      }
                    </div>
                  )}
                </Link>
              ))}
              {colLeads.length === 0 && (
                <div className="py-4 text-center text-xs text-slate-400">—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}