'use client'

// Chart block — renders ```chart JSON blocks from AI answers as
// recharts bar/line charts (max 2 series, brand colors).
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import type { ChartSpec } from './markdown'

const PALETTE = ['var(--gold)', '#1e3a5f', '#7c9dc2', '#b8942c']

export function ChartBlock({ spec }: { spec: ChartSpec }) {
  const data = spec.labels.map((label, i) => {
    const row: Record<string, string | number> = { name: label }
    for (const s of spec.series.slice(0, 2)) row[s.name] = s.data[i] ?? 0
    return row
  })
  const seriesNames = spec.series.slice(0, 2).map((s) => s.name)
  const isLine = spec.type === 'line'

  return (
    <div className="my-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5 text-gold-deep" />
        <span className="truncate">{spec.title ?? 'Chart'}</span>
      </div>
      <div className="h-56 w-full" role="img" aria-label={spec.title ?? 'AI chart'}>
        <ResponsiveContainer width="100%" height="100%">
          {isLine ? (
            <LineChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={48} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {seriesNames.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
              {seriesNames.map((n, i) => (
                <Line
                  key={n}
                  type="monotone"
                  dataKey={n}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={48} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              {seriesNames.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
              {seriesNames.map((n, i) => (
                <Bar key={n} dataKey={n} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {spec.xLabel || spec.yLabel ? (
        <p className="mt-1 text-center text-[10px] text-muted-foreground">
          {spec.xLabel ? `x: ${spec.xLabel}` : ''} {spec.yLabel ? `· y: ${spec.yLabel}` : ''}
        </p>
      ) : null}
    </div>
  )
}
