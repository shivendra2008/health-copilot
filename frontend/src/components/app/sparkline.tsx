const LINE = "#0E7A54";

/** Tiny trend line. Decorative: the numbers are always shown next to it. */
export function Sparkline({ points, width = 84, height = 28 }: { points: { value: number }[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = 3;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke={LINE} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={2.75} fill={LINE} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}
