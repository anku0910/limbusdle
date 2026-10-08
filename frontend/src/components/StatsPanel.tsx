import { MAX_GUESSES } from '../lib/game'
import type { Stats } from '../lib/game'

export function Distribution({ stats }: { stats: Stats }) {
  const peak = Math.max(1, ...stats.distribution)
  return (
    <div className="bg-zinc-900 p-3 text-xs">
      <div className="mb-2 font-medium text-zinc-400">猜中次數分布</div>
      <div className="space-y-1">
        {stats.distribution.map((count, index) => {
          const tries = index + 1
          return (
            <div key={tries} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-right text-zinc-500">{tries}</span>
              <div className="h-4 min-w-0 flex-1">
                <div
                  className="flex h-4 items-center justify-end bg-emerald-600 px-1 text-[10px] font-bold text-white"
                  style={{ width: `${Math.round((count / peak) * 100)}%`, minWidth: count ? '1.5rem' : 0 }}
                >
                  {count || ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 text-[10px] text-zinc-600">共 {MAX_GUESSES} 次機會</div>
    </div>
  )
}