import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { LayoutDashboard, Search, Target, Bot, Settings, LogOut, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Dashboard", page: "Dashboard", icon: LayoutDashboard },
  { label: "Campagnes", page: "Campaigns", icon: Search },
  { label: "Pipeline", page: "Pipeline", icon: Target },
  { label: "Assistant IA", page: "Assistant", icon: Bot },
];

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => base44.auth.redirectToLogin());
  }, []);

  const navItems = user?.role === "admin"
    ? [...NAV, { label: "Admin", page: "Admin", icon: Settings }]
    : NAV;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside className={cn(
        "flex flex-col bg-slate-900 text-white flex-shrink-0 transition-all duration-200",
        collapsed ? "w-14" : "w-52"
      )}>
        <div className={cn("flex items-center gap-2 h-14 px-4 border-b border-slate-700", collapsed && "justify-center px-0")}>
          <Zap className="w-5 h-5 text-blue-400 flex-shrink-0" />
          {!collapsed && (
            <div>
              <span className="font-bold text-sm text-white">SYNC</span>
              <span className="text-slate-400 text-xs ml-1">Prospect</span>
            </div>
          )}
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map(({ label, page, icon: Icon }) => (
            <Link
              key={page}
              to={createPageUrl(page)}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                currentPageName === page ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white",
                collapsed && "justify-center px-2"
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-slate-700 p-2 space-y-1">
          {!collapsed && user && (
            <div className="px-3 py-2 rounded-lg bg-slate-800 mb-1">
              <div className="text-xs text-white font-medium truncate">{user.full_name || user.email}</div>
              <div className="text-xs text-slate-400">{user.role === "admin" ? "Administrateur" : "Commercial"}</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 w-full text-xs"
          >
            {collapsed ? <ChevronRight className="w-4 h-4 mx-auto" /> : <><ChevronLeft className="w-4 h-4" /><span>Réduire</span></>}
          </button>
          <button
            onClick={() => base44.auth.logout()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 w-full text-xs"
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span>Déconnexion</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}