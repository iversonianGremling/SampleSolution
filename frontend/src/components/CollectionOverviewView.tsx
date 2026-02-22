import type { CollectionOverview, WorkspaceTab } from '../types/workspace'

interface CollectionOverviewViewProps {
  overview: CollectionOverview
  tab: WorkspaceTab
}

interface StatCardProps {
  label: string
  value: string
}

const TAB_THEME: Record<WorkspaceTab, { label: string; badge: string }> = {
  details: {
    label: 'Details',
    badge: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  },
  rack: {
    label: 'Rack',
    badge: 'border-accent-primary/30 bg-accent-primary/10 text-accent-primary',
  },
  lab: {
    label: 'Lab',
    badge: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300',
  },
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'

  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised/80 p-3">
      <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-white">{value}</div>
    </div>
  )
}

function TopMetricList({ title, items }: { title: string; items: { name: string; count: number }[] }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-raised/80 p-3">
      <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">{title}</div>
      {items.length === 0 ? (
        <div className="text-xs text-slate-500">No data yet</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((item) => (
            <div key={item.name} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-slate-200">{item.name}</span>
              <span className="font-mono text-xs text-slate-400">{item.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function CollectionOverviewView({ overview, tab }: CollectionOverviewViewProps) {
  const theme = TAB_THEME[tab]
  const topTagItems = overview.topTags.map((tag) => ({ name: tag.name, count: tag.count }))

  return (
    <div className="h-full overflow-y-auto bg-surface-base p-4">
      <div className="space-y-4">
        <div className="rounded-lg border border-surface-border bg-surface-raised/80 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-white">Collection Overview</h2>
            <span className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest ${theme.badge}`}>
              {theme.label}
            </span>
          </div>
          <p className="text-sm text-slate-300">{overview.scopeLabel}</p>
          <p className="mt-1 text-xs text-slate-500">Stats below describe the full current scope, not just selected items.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Samples" value={overview.totalSamples.toLocaleString()} />
          <StatCard label="Tracks" value={overview.totalTracks.toLocaleString()} />
          <StatCard label="Folders" value={overview.totalFolders.toLocaleString()} />
          <StatCard label="Tags" value={overview.totalTags.toLocaleString()} />
          <StatCard label="Favorites" value={overview.favoriteSamples.toLocaleString()} />
          <StatCard label="Modified" value={overview.modifiedSamples.toLocaleString()} />
          <StatCard label="Total Time" value={formatDuration(overview.totalDurationSec)} />
          <StatCard label="Avg BPM" value={overview.averageBpm !== null ? Math.round(overview.averageBpm).toString() : 'N/A'} />
        </div>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <TopMetricList title="Top Tags" items={topTagItems} />
          <TopMetricList title="Top Instruments" items={overview.topInstruments} />
          <TopMetricList title="Top Keys" items={overview.topKeys} />
        </div>

        <div className="rounded-lg border border-surface-border bg-surface-raised/80 p-3 text-xs text-slate-500">
          Average sample length: <span className="text-slate-300">{formatDuration(overview.averageDurationSec)}</span>
        </div>
      </div>
    </div>
  )
}
