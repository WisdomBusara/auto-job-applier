interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  color?: "indigo" | "emerald" | "amber" | "rose" | "slate" | "violet";
  icon?: string;
}

const colorMap = {
  indigo:  { bg: "bg-indigo-50",  text: "text-indigo-600",  border: "border-indigo-100" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-100" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-600",   border: "border-amber-100" },
  rose:    { bg: "bg-rose-50",    text: "text-rose-600",    border: "border-rose-100" },
  slate:   { bg: "bg-slate-900",  text: "text-white",       border: "border-slate-800" },
  violet:  { bg: "bg-violet-50",  text: "text-violet-600",  border: "border-violet-100" },
};

export default function StatCard({ label, value, sub, color = "indigo", icon }: StatCardProps) {
  const c = colorMap[color];
  return (
    <div className={`${c.bg} rounded-2xl p-6 border ${c.border}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className={`text-[11px] font-black uppercase tracking-widest mb-2 ${color === "slate" ? "text-slate-400" : "text-slate-500"}`}>
            {label}
          </p>
          <p className={`text-4xl font-black ${c.text} leading-none`}>{value}</p>
          {sub && <p className={`text-xs mt-2 font-medium ${color === "slate" ? "text-slate-400" : "text-slate-400"}`}>{sub}</p>}
        </div>
        {icon && <span className="text-2xl opacity-60">{icon}</span>}
      </div>
    </div>
  );
}
