type ChartPoint = {
  date: string
  value: number
}

function buildPolyline(points: ChartPoint[], width: number, height: number) {
  if (points.length === 0) return ""

  const max = Math.max(...points.map((point) => point.value), 1)

  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width
      const y = height - (point.value / max) * height
      return `${x},${y}`
    })
    .join(" ")
}

export function AnalyticsLineChart({
  title,
  subtitle,
  points,
  colorClassName,
}: {
  title: string
  subtitle: string
  points: ChartPoint[]
  colorClassName: string
}) {
  const max = Math.max(...points.map((point) => point.value), 0)
  const last = points[points.length - 1]
  const polyline = buildPolyline(points, 320, 120)

  return (
    <div className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">{last?.value ?? 0}</div>
          <div className="text-xs text-muted-foreground">Latest day</div>
        </div>
      </div>

      <div className="mt-5">
        <svg viewBox="0 0 320 120" className="w-full h-32 overflow-visible">
          <line x1="0" y1="119" x2="320" y2="119" className="stroke-border" strokeWidth="1" />
          {polyline ? (
            <polyline
              points={polyline}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className={colorClassName}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{points[0]?.date ?? "Start"}</span>
        <span>Peak {max}</span>
        <span>{last?.date ?? "Today"}</span>
      </div>
    </div>
  )
}
