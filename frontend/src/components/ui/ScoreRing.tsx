interface ScoreRingProps {
  score: number | null;
  size?: "sm" | "md" | "lg";
}

export default function ScoreRing({ score, size = "md" }: ScoreRingProps) {
  if (score === null) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-12 h-12 rounded-full border-4 border-slate-200 flex items-center justify-center">
          <span className="text-slate-300 text-xs font-bold">—</span>
        </div>
      </div>
    );
  }

  const color =
    score >= 80 ? "#10b981" :
    score >= 60 ? "#6366f1" :
    score >= 40 ? "#f59e0b" : "#f43f5e";

  const sizes = {
    sm: { outer: 40, stroke: 4, font: "text-[10px]" },
    md: { outer: 52, stroke: 5, font: "text-xs" },
    lg: { outer: 72, stroke: 6, font: "text-sm" },
  };

  const { outer, stroke, font } = sizes[size];
  const r = (outer - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: outer, height: outer }}>
      <svg width={outer} height={outer} className="-rotate-90">
        <circle cx={outer / 2} cy={outer / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle
          cx={outer / 2} cy={outer / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round"
          className="score-bar"
        />
      </svg>
      <span className={`absolute font-black ${font}`} style={{ color }}>
        {score}
      </span>
    </div>
  );
}
