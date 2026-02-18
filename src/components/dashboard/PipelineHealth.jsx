import { TrendingUp } from "lucide-react";

const STATUS_LABELS = {
  NEW: "Nouveau",
  CONTACTED: "Contacté",
  REPLIED: "A répondu",
  MEETING: "Meeting",
  CLOSED_WON: "Gagné",
  CLOSED_LOST: "Perdu",
};

const STATUS_COLORS = {
  NEW: "bg-slate-400",
  CONTACTED: "bg-blue-400",
  REPLIED: "bg-yellow-400",
  MEETING: "bg-orange-400",
  CLOSED_WON: "bg-green-500",
  CLOSED_LOST: "bg-red-400",
};

export default function PipelineHealth({ leads, isLoading }) {
  const statuses = ["NEW", "CONTACTED", "REPLIED", "MEETING", "CLOSED_WON", "CLOSED_LOST"];
  const counts = statuses.reduce((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length;
    return acc;
  }, {});
  const total = leads.length;

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-green-600" />
        <span className="font-semibold text-sm text-slate-800">Santé du Pipeline</span>
      </div>
      {isLoading ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {statuses.filter(s => counts[s] > 0 || ["NEW", "CONTACTED"].includes(s)).map(s => (
            <div key={s} className="flex items-center gap-3">
              <div className="w-24 text-xs text-slate-600 truncate">{STATUS_LABELS[s]}</div>
              <div className="flex-1 bg-slate-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${STATUS_COLORS[s]}`}
                  style={{ width: total > 0 ? `${(counts[s] / total) * 100}%` : "0%" }}
                />
              </div>
              <div className="w-6 text-xs text-slate-500 text-right">{counts[s]}</div>
            </div>
          ))}
          {total === 0 && <p className="text-xs text-slate-400 text-center py-2">Aucun lead dans le pipeline</p>}
        </div>
      )}
    </div>
  );
}