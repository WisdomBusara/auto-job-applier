"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard",     icon: "📊", label: "Dashboard" },
  { href: "/jobs",          icon: "🔍", label: "Job Queue" },
  { href: "/applications",  icon: "📋", label: "Applications" },
  { href: "/logs",          icon: "🖥️",  label: "Live Logs" },
  { href: "/integrations",  icon: "🔌", label: "Integrations" },
  { href: "/settings",      icon: "⚙️",  label: "Settings" },
];

export default function Sidebar() {
  const path = usePathname();

  return (
    <aside className="w-64 shrink-0 bg-slate-950 min-h-screen flex flex-col border-r border-white/5 shadow-2xl">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-7 border-b border-white/5">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center font-black text-white text-lg shadow-lg shadow-indigo-600/30">
          A
        </div>
        <div>
          <p className="text-white font-black text-sm leading-none tracking-tight">AutoApply AI</p>
          <p className="text-indigo-400 text-[10px] font-bold uppercase tracking-widest mt-0.5">Intelligence Agent</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = path === item.href || (item.href !== "/" && path.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative ${
                active
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                  : "text-slate-500 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              <span className={`text-lg transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-105"}`}>
                {item.icon}
              </span>
              <span className="font-semibold text-sm">{item.label}</span>
              {active && (
                <span className="absolute right-3 w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 pb-6">
        <div className="bg-white/5 rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-emerald-400 text-xs font-bold uppercase tracking-wider">System Online</span>
          </div>
          <p className="text-slate-500 text-[11px] leading-relaxed">
            Backend API connected. Ready to run automation.
          </p>
        </div>
      </div>
    </aside>
  );
}
