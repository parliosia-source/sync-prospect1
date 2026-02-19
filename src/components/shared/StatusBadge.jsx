import { Badge } from "@/components/ui/badge";

const PROSPECT_COLORS = {
  "NOUVEAU": "bg-slate-100 text-slate-700",
  "ANALYSÉ": "bg-blue-100 text-blue-700",
  "QUALIFIÉ": "bg-green-100 text-green-700",
  "REJETÉ": "bg-red-100 text-red-700",
  "EXPORTÉ": "bg-purple-100 text-purple-700",
  "FAILED_ANALYSIS": "bg-red-100 text-red-600",
};

const LEAD_COLORS = {
  "NEW": "bg-slate-100 text-slate-700",
  "CONTACTED": "bg-blue-100 text-blue-700",
  "REPLIED": "bg-yellow-100 text-yellow-700",
  "MEETING": "bg-orange-100 text-orange-700",
  "CLOSED_WON": "bg-green-100 text-green-700",
  "CLOSED_LOST": "bg-red-100 text-red-700",
};

const CAMPAIGN_COLORS = {
  "DRAFT": "bg-slate-100 text-slate-700",
  "RUNNING": "bg-blue-100 text-blue-700",
  "COMPLETED": "bg-green-100 text-green-700",
  "DONE_PARTIAL": "bg-amber-100 text-amber-700",
  "CANCELED": "bg-slate-300 text-slate-700",
  "FAILED": "bg-red-100 text-red-700",
};

const LABELS = {
  "NOUVEAU": "Nouveau", "ANALYSÉ": "Analysé", "QUALIFIÉ": "Qualifié",
  "REJETÉ": "Rejeté", "EXPORTÉ": "Exporté", "FAILED_ANALYSIS": "Échec analyse",
  "NEW": "Nouveau", "CONTACTED": "Contacté", "REPLIED": "A répondu",
  "MEETING": "Meeting", "CLOSED_WON": "Gagné", "CLOSED_LOST": "Perdu",
  "DRAFT": "Brouillon", "RUNNING": "En cours", "COMPLETED": "Terminé", "DONE_PARTIAL": "Incomplet", "CANCELED": "Annulée", "FAILED": "Échoué",
};

export default function StatusBadge({ status, type = "prospect", className = "" }) {
  const colorMap = type === "lead" ? LEAD_COLORS : type === "campaign" ? CAMPAIGN_COLORS : PROSPECT_COLORS;
  const color = colorMap[status] || "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color} ${className}`}>
      {LABELS[status] || status}
    </span>
  );
}