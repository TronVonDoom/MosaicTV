import { useCallback, useEffect, useRef, useState } from 'react'
import { api, logsDownloadUrl, type Health, type LogCategory, type LogEntry, type LogLevel } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { usePolling } from '../../lib/hooks'
import { Button, InfoHint, LinkButton, Select } from '../ui'
import { Tally } from '../onair/OnAir'
import { confirmDialog } from '../../lib/confirm'
import ResourceChart from '../ResourceChart'
import { SettingsSection } from './SettingsKit'

const LEVELS: { value: LogLevel | 'all'; label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
]
const CATEGORIES: { value: LogCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'stream', label: 'Streams' },
  { value: 'ffmpeg', label: 'FFmpeg' },
  { value: 'playout', label: 'Playout' },
  { value: 'system', label: 'System' },
]

const levelStyle: Record<LogLevel, string> = {
  error: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  warn: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  info: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
  debug: 'text-ink-muted border-ink-ghost/40 bg-ink-ghost/10',
}

const uptime = (s: number) => {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** How the server itself is doing — running, for how long, on what — for the
 *  top of the logs, where a problem report starts. */
function useServerStatus() {
  const [health, setHealth] = useState<Health | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const load = useCallback(
    () =>
      api
        .health()
        .then((h) => {
          setHealth(h)
          setReachable(true)
        })
        .catch(() => setReachable(false)),
    [],
  )
  useEffect(() => {
    load()
  }, [load])
  usePolling(load, 30000)

  const status =
    reachable === null
      ? { tone: 'next' as const, label: 'Connecting', note: undefined }
      : !reachable
        ? { tone: 'alert' as const, label: 'Not answering', note: 'Server not answering — is the container running?' }
        : !health?.ffmpeg
          ? { tone: 'next' as const, label: 'No ffmpeg', note: 'ffmpeg not found — channels can’t stream' }
          : { tone: 'ok' as const, label: 'Running', note: undefined }
  return { health: reachable ? health : null, status }
}

/**
 * Settings › Activity: how the server is doing — running, for how long, on
 * what — its CPU and memory, and its log, which is what a bug report wants.
 * (This was the Logs page; /logs lands here.)
 */
export default function ActivitySettings() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [category, setCategory] = useState<LogCategory | 'all'>('all')
  // Which viewer stream to show. Filtered here rather than server-side: the
  // options are whatever sessions appear in the entries we already have.
  const [session, setSession] = useState<string>('all')
  // Debug lines (every ffmpeg command, every segment, the load heartbeat) are
  // recorded always but kept out of the view unless asked for — they outnumber
  // everything else several times over.
  const [showDebug, setShowDebug] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [total, setTotal] = useState(0)
  const [copied, setCopied] = useState(false)
  const [flash, setFlash] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { health, status } = useServerStatus()
  const stickToBottom = useRef(true)

  const refresh = useCallback(async () => {
    const res = await api
      .logs({
        level: level === 'all' ? undefined : level,
        category: category === 'all' ? undefined : category,
        debug: showDebug,
        limit: 1000,
      })
      .catch(() => null)
    if (res) {
      setEntries(res.entries)
      setTotal(res.total)
    }
  }, [level, category, showDebug])

  useEffect(() => {
    refresh()
  }, [refresh])

  usePolling(refresh, 2000, autoRefresh)

  const sessions = [...new Set(entries.map((e) => e.session).filter(Boolean))] as string[]
  const shown = session === 'all' ? entries : entries.filter((e) => e.session === session)

  // Keep the view pinned to the newest entry unless the user scrolls up.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [entries, session])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // Manual refresh: always jump to the newest entry and flash feedback, so it's
  // obvious it ran even when no new lines arrived.
  async function manualRefresh() {
    stickToBottom.current = true
    await refresh()
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setFlash(true)
    setTimeout(() => setFlash(false), 600)
  }

  async function copyAll() {
    // Copy and Download both hand over the entire log — every level, every
    // stream, whatever the filters happen to be set to. Someone pasting this
    // into a bug report wants the whole thing, and a filter they forgot about
    // silently withholding the relevant line is the worst outcome here. Falls
    // back to what's on screen if the dump can't be fetched.
    const text = await fetch(logsDownloadUrl)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .catch(() =>
        shown
          .map((e) => {
            let s = `${e.ts} [${e.level.toUpperCase()}] [${e.category}]${e.session ? ` [${e.session}]` : ''} ${e.message}`
            if (e.detail) s += '\n    ' + e.detail.replace(/\n/g, '\n    ')
            return s
          })
          .join('\n'),
      )
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    // if copying is blocked outright, the download button still works
  }

  async function clearAll() {
    if (
      !(await confirmDialog({
        title: 'Clear all logs?',
        message: 'This wipes the in-memory buffer and the log file.',
        confirmLabel: 'Clear logs',
        danger: true,
      }))
    )
      return
    await api.clearLogs().catch(() => {})
    stickToBottom.current = true
    refresh()
  }

  return (
    <SettingsSection
      wide
      title="Activity"
      description={
        <>
          How the server is doing, and its log of stream, ffmpeg, playout and system events — what to send with a bug report.{' '}
          <InfoHint>
            Lines raised while serving a viewer are tagged with that stream (e.g. V3 Plex) — click a tag to follow just
            that one. Copy and Download always take the whole log, debug lines included, whatever the filters show.
          </InfoHint>
        </>
      }
    >
      {/* The server's status in a line: where a problem report starts. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.045] px-5 py-4">
        <Tally tone={status.tone}>{status.label}</Tally>
        {health && (
          <span className="text-[13.5px] text-ink-soft tabular-nums">
            {[/^\d/.test(health.version) ? `Version ${health.version}` : null, `up ${uptime(health.uptimeSeconds)}`, `Node ${health.node.replace(/^v/, '')}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
        {status.note && <span className="text-[13.5px] text-amber-300">{status.note}</span>}
      </div>

      <ResourceChart />

      <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Server log</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" icon={copied ? 'check' : 'copy'} onClick={copyAll} title="Copies the entire log, including debug lines — filters don't apply">
            {copied ? 'Copied' : 'Copy all'}
          </Button>
          <LinkButton size="sm" icon="download" href={logsDownloadUrl} title="Downloads the entire log, including debug lines — filters don't apply">
            Download
          </LinkButton>
          <Button variant="danger" size="sm" icon="trash" onClick={clearAll}>
            Clear
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
          className="py-1.5"
          aria-label="Filter by level"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value as LogCategory | 'all')}
          className="py-1.5"
          aria-label="Filter by source"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        {(sessions.length > 0 || session !== 'all') && (
          <Select
            value={session}
            onChange={(e) => setSession(e.target.value)}
            className="py-1.5"
            aria-label="Filter by stream"
          >
            <option value="all">All streams</option>
            {(sessions.includes(session) || session === 'all' ? sessions : [session, ...sessions]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
        <label
          className="flex items-center gap-2 text-sm text-ink-muted select-none"
          title="Debug lines are always recorded — this only shows them here. Copy and Download always include them."
        >
          <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
          Include debug
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-muted select-none">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
        <button onClick={manualRefresh} className="text-sm text-ink-muted hover:text-ink-soft">
          {flash ? 'Refreshed ✓' : 'Refresh now'}
        </button>
        <span className="text-xs text-ink-faint ml-auto tabular-nums">
          {session === 'all' ? `${total} matching entries` : `${shown.length} of ${total} entries`}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="rounded-2xl border border-white/[0.08] bg-[rgb(8_7_13/0.8)] font-mono text-xs leading-relaxed h-[62vh] overflow-auto p-3 space-y-1"
      >
        {shown.length === 0 ? (
          <div className="text-ink-faint p-4 text-center">
            No log entries match these filters.
          </div>
        ) : (
          shown.map((e) => (
            <div key={e.id} className="flex gap-2 items-start">
              <span className="text-ink-faint shrink-0 tabular-nums">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              <span
                className={
                  'shrink-0 rounded border px-1.5 text-[10px] uppercase tracking-wide ' + levelStyle[e.level]
                }
              >
                {e.level}
              </span>
              <span className="text-ink-faint shrink-0">[{e.category}]</span>
              {e.session && (
                <button
                  onClick={() => setSession(session === e.session ? 'all' : (e.session as string))}
                  title={session === e.session ? 'Show all streams' : `Show only ${e.session}`}
                  className="shrink-0 rounded border border-indigo-400/40 bg-indigo-400/10 px-1.5 text-[10px] text-indigo-300 hover:bg-indigo-400/20"
                >
                  {e.session}
                </button>
              )}
              <span className="text-ink-soft whitespace-pre-wrap break-words min-w-0">
                {e.message}
                {e.detail && <span className="block text-ink-faint mt-0.5 pl-1">{e.detail}</span>}
              </span>
            </div>
          ))
        )}
      </div>
      </div>
    </SettingsSection>
  )
}
