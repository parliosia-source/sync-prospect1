import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Newspaper, Calendar, TrendingUp, Bell, ExternalLink, RefreshCw } from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/button";

const CATEGORY_CONFIG = {
  EVENT: { icon: Calendar, color: "text-blue-600", bg: "bg-blue-50", label: "Événement" },
  NEWS: { icon: Newspaper, color: "text-slate-600", bg: "bg-slate-50", label: "Nouvelles" },
  OPPORTUNITY: { icon: TrendingUp, color: "text-green-600", bg: "bg-green-50", label: "Opportunité" },
  REMINDER: { icon: Bell, color: "text-orange-600", bg: "bg-orange-50", label: "Rappel" },
};

export default function GazetteBlock() {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => { loadItems(); }, []);

  const loadItems = async () => {
    const data = await base44.entities.Gazette.filter({ status: "ACTIVE" }, "-publishDate", 6);
    setItems(data);
    setIsLoading(false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await base44.functions.invoke("refreshGazette", {});
    await loadItems();
    setIsRefreshing(false);
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-slate-600" />
          <span className="font-semibold text-sm text-slate-800">Gazette / Up Deals</span>
          <span className="text-xs text-slate-400">événements & opportunités à venir</span>
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="text-xs gap-1 h-7">
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-14 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="p-6 text-center text-slate-400 text-sm">
          <Newspaper className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          Aucun item — cliquez "Actualiser" pour générer la gazette du jour
        </div>
      ) : (
        <div className="divide-y">
          {items.map(item => {
            const cfg = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.NEWS;
            const Icon = cfg.icon;
            return (
              <div key={item.id} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50">
                <div className={`p-1.5 rounded-lg ${cfg.bg} flex-shrink-0 mt-0.5`}>
                  <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-slate-800 leading-snug">{item.title}</p>
                    {item.sourceUrl && (
                      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-slate-400 hover:text-blue-500">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  {item.summary && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.summary}</p>}
                  <div className="flex items-center gap-3 mt-1">
                    <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                    {item.eventDate && (
                      <span className="text-xs text-slate-400">
                        {format(parseISO(item.eventDate), "d MMM yyyy", { locale: fr })}
                      </span>
                    )}
                    {item.cta && <span className="text-xs text-blue-600 font-medium">{item.cta}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}