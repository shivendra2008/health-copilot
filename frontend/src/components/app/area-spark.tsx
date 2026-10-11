"use client";

import { useId } from "react";

const LINE = "#0E7A54";

/** Soft area trend line. Decorative: the latest value and range are always shown as text beside it. */
export function AreaSpark({ points, height = 56 }: { points: { value: number }[]; height?: number }) {
  const id = useId().replace(/:/g, "");
  if (points.length < 2) {
    return (
      <div className="flex items-center text-[11px] text-muted-foreground" style={{ height }}>
        Trend appears after your next result
      </div>
    );
  }
  const w = 200;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = 6;
  const x = (i: number) => (i * w) / (points.length - 1);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={LINE} stopOpacity="0.28" />
          <stop offset="100%" stopColor={LINE} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke={LINE} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
