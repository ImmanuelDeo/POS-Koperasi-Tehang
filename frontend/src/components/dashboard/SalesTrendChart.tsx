'use client';

import { useState } from 'react';
import { TrendingUp, ShoppingBag } from 'lucide-react';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface TrendDataPoint {
  key: string;
  label: string;
  netSales: number;
  orderCount: number;
}

interface Props {
  data: TrendDataPoint[];
  periodLabel: string;
  className?: string;
}

export default function SalesTrendChart({ data, periodLabel, className = '' }: Props) {
  const fmt = useFormatCurrency();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className={`bg-white rounded-2xl border border-gray-100 p-5 ${className}`}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-emerald-600" />
          <h3 className="font-bold text-gray-900 text-sm">Tren Penjualan</h3>
        </div>
        <div className="py-16 text-center text-gray-400 text-xs">
          Belum ada data penjualan pada periode {periodLabel}.
        </div>
      </div>
    );
  }

  const maxSales = Math.max(...data.map((d) => d.netSales), 1000);
  const totalSales = data.reduce((acc, d) => acc + d.netSales, 0);
  const totalOrders = data.reduce((acc, d) => acc + d.orderCount, 0);

  // SVG dimensions
  const svgWidth = 800;
  const svgHeight = 220;
  const paddingX = 40;
  const paddingTop = 20;
  const paddingBottom = 40;
  const plotWidth = svgWidth - paddingX * 2;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  // Calculate points
  const points = data.map((d, index) => {
    const x = paddingX + (index / Math.max(data.length - 1, 1)) * plotWidth;
    const y = paddingTop + plotHeight - (d.netSales / maxSales) * plotHeight;
    return { x, y, data: d };
  });

  // Generate SVG path for line and area
  const linePath = points.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x} ${p.y}`;
    // Bezier control points for smooth line
    const prev = points[idx - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + plotHeight} L ${points[0].x} ${paddingTop + plotHeight} Z`;

  // X Axis label indices (pick at most 6 evenly spaced labels)
  const step = Math.max(1, Math.floor(data.length / 6));
  const labelIndices = data.map((_, i) => i).filter((i) => i === 0 || i === data.length - 1 || i % step === 0);

  const hoveredPoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className={`bg-white rounded-2xl border border-gray-100 p-5 shadow-xs flex flex-col ${className}`}>
      {/* ── Card Header ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700">
              <TrendingUp size={16} />
            </div>
            <h3 className="font-bold text-gray-900 text-sm">Tren Penjualan & Transaksi</h3>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Periode: {periodLabel}</p>
        </div>

        <div className="flex items-center gap-4 text-xs font-semibold">
          <div className="text-right">
            <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Total Terkumpul</span>
            <span className="text-emerald-800 font-bold text-sm">{fmt(totalSales)}</span>
          </div>
          <div className="text-right border-l border-gray-200 pl-4">
            <span className="text-gray-400 block text-[10px] uppercase tracking-wider">Transaksi</span>
            <span className="text-gray-900 font-bold text-sm">{totalOrders}</span>
          </div>
        </div>
      </div>

      {/* ── Responsive SVG Chart ──────────────────────────────────────────── */}
      <div className="relative w-full overflow-hidden flex-1 min-h-[190px]">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto overflow-visible select-none"
        >
          <defs>
            <linearGradient id="emeraldTrendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
              <stop offset="85%" stopColor="#10b981" stopOpacity="0.03" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0, 0.5, 1].map((ratio) => {
            const y = paddingTop + plotHeight * (1 - ratio);
            return (
              <g key={ratio}>
                <line
                  x1={paddingX}
                  y1={y}
                  x2={svgWidth - paddingX}
                  y2={y}
                  stroke="#f3f4f6"
                  strokeWidth="1.2"
                  strokeDasharray={ratio > 0 && ratio < 1 ? '4 4' : undefined}
                />
                <text
                  x={paddingX - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="9"
                  fontWeight="500"
                  fill="#9ca3af"
                >
                  {ratio === 0 ? 'Rp 0' : fmt(maxSales * ratio).replace(',00', '')}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path d={areaPath} fill="url(#emeraldTrendGradient)" />

          {/* Trend line */}
          <path
            d={linePath}
            fill="none"
            stroke="#059669"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data Points & Invisible Touch/Hover Areas */}
          {points.map((p, idx) => {
            const isHovered = hoveredIdx === idx;
            return (
              <g key={idx}>
                {/* Vertical guide line on hover */}
                {isHovered && (
                  <line
                    x1={p.x}
                    y1={paddingTop}
                    x2={p.x}
                    y2={paddingTop + plotHeight}
                    stroke="#10b981"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                )}

                {/* Visible Point */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isHovered ? 6 : p.data.netSales > 0 ? 3.5 : 2}
                  fill={isHovered ? '#047857' : '#ffffff'}
                  stroke="#059669"
                  strokeWidth={isHovered ? 3 : 2}
                  className="transition-all duration-150"
                />

                {/* Large transparent hover target */}
                <rect
                  x={p.x - plotWidth / (data.length * 2)}
                  y={0}
                  width={plotWidth / data.length}
                  height={svgHeight}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              </g>
            );
          })}

          {/* X Axis Labels */}
          {labelIndices.map((idx) => {
            const p = points[idx];
            if (!p) return null;
            return (
              <text
                key={idx}
                x={p.x}
                y={svgHeight - 12}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="#6b7280"
              >
                {p.data.label}
              </text>
            );
          })}
        </svg>

        {/* ── Interactive HTML Tooltip ──────────────────────────────────────── */}
        {hoveredPoint && (
          <div
            className="absolute pointer-events-none bg-gray-900/95 text-white text-xs px-3 py-2 rounded-xl shadow-xl border border-gray-700/50 backdrop-blur-xs transform -translate-x-1/2 -translate-y-full z-20"
            style={{
              left: `${(hoveredPoint.x / svgWidth) * 100}%`,
              top: `${(hoveredPoint.y / svgHeight) * 100 - 8}%`,
            }}
          >
            <div className="font-semibold text-emerald-400 text-[11px] mb-1">
              Waktu: {hoveredPoint.data.key}
            </div>
            <div className="font-bold text-sm text-white">
              {fmt(hoveredPoint.data.netSales)}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-gray-300 mt-0.5">
              <ShoppingBag size={11} className="text-gray-400" />
              {hoveredPoint.data.orderCount} Transaksi
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
