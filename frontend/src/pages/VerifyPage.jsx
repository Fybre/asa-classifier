import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { confirmJob, getJob, getJobDocumentUrl, getSettings, searchCodes } from '../api.js'

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ value }) {
  const pct = Math.round((value || 0) * 100)
  const colour = pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400'
  const barColour = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${colour}`}>{pct}%</span>
    </div>
  )
}

// ── Suggestion card ───────────────────────────────────────────────────────────

function SuggestionCard({ suggestion, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <button
      type="button"
      onClick={() => onSelect(suggestion)}
      className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
        selected
          ? 'border-indigo-500 bg-indigo-500/10'
          : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div>
          <span className="font-mono font-bold text-white text-sm">{suggestion.asa_code}</span>
          <p className="text-slate-400 text-xs mt-0.5 leading-snug">{suggestion.hierarchy}</p>
        </div>
        {selected && (
          <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </span>
        )}
      </div>
      <ConfidenceBadge value={suggestion.confidence} />
      {suggestion.reasoning && (
        <div className="mt-2">
          <p className={`text-xs text-slate-500 leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
            {suggestion.reasoning}
          </p>
          {suggestion.reasoning.length > 120 && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
              className="text-xs text-indigo-400 hover:text-indigo-300 mt-0.5"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
      {suggestion.disposal_action && (
        <p className="text-xs text-slate-500 mt-1.5 border-t border-slate-700/60 pt-1.5">
          <span className="text-slate-600">Disposal: </span>{suggestion.disposal_action}
        </p>
      )}
    </button>
  )
}

// ── Document preview ──────────────────────────────────────────────────────────

function DocumentPreview({ jobId, fileExt, filename }) {
  const url = getJobDocumentUrl(jobId)
  const ext = (fileExt || '').toLowerCase()
  const isImage = ['.jpg', '.jpeg', '.png'].includes(ext)
  const isPdf = ext === '.pdf'
  const isText = ext === '.txt'

  if (isImage) {
    return (
      <img
        src={url}
        alt={filename}
        className="w-full h-full object-contain rounded-lg bg-slate-900"
      />
    )
  }
  if (isPdf) {
    return (
      <iframe
        src={url}
        title={filename}
        className="w-full h-full rounded-lg bg-slate-900 border-0"
      />
    )
  }
  if (isText) {
    return (
      <iframe
        src={url}
        title={filename}
        className="w-full h-full rounded-lg bg-slate-900 border-0 font-mono text-sm"
      />
    )
  }
  // Unsupported for inline preview
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500">
      <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <div className="text-center">
        <p className="text-sm text-slate-400">{filename}</p>
        <p className="text-xs text-slate-600 mt-1">Preview not available for {ext} files</p>
      </div>
      <a
        href={url}
        download={filename}
        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors"
      >
        Download file
      </a>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VerifyPage() {
  const { jobId } = useParams()
  const navigate = useNavigate()

  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState(null)   // { asa_code, hierarchy, disposal_action }
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const searchTimeout = useRef(null)

  const [allowTraining, setAllowTraining] = useState(true)
  const [train, setTrain] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [confirmError, setConfirmError] = useState('')

  // Load job and settings
  useEffect(() => {
    Promise.all([getJob(jobId), getSettings()])
      .then(([jobData, settings]) => {
        setJob(jobData)
        setAllowTraining(settings.allow_user_training)
        if (jobData.suggestions?.length > 0) {
          const top = jobData.suggestions[0]
          setSelected({ asa_code: top.asa_code, hierarchy: top.hierarchy, disposal_action: top.disposal_action })
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [jobId])

  // Debounced code search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchCodes(searchQuery.trim())
        setSearchResults(results.slice(0, 8))
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(searchTimeout.current)
  }, [searchQuery])

  async function handleConfirm() {
    if (!selected?.asa_code) return
    setConfirming(true)
    setConfirmError('')
    try {
      await confirmJob(jobId, {
        confirmedCode: selected.asa_code,
        confirmedHierarchy: selected.hierarchy || '',
        confirmedDisposal: selected.disposal_action || '',
        train,
        trainArchive: true,
      })
      setConfirmed(true)
    } catch (e) {
      setConfirmError(e.message)
    } finally {
      setConfirming(false)
    }
  }

  // ── Loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-500 text-sm">Loading job…</div>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-red-400 text-sm">{error || 'Job not found.'}</p>
          <button onClick={() => navigate('/')} className="text-sm text-slate-500 hover:text-slate-300">
            Back to home
          </button>
        </div>
      </div>
    )
  }

  // ── Confirmed success ───────────────────────────────────────────────────────

  if (confirmed) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-semibold text-lg">Classification confirmed</h2>
            <p className="text-slate-400 text-sm mt-1">
              <span className="font-mono text-indigo-400">{selected.asa_code}</span>
              {selected.hierarchy && <> — {selected.hierarchy}</>}
            </p>
            {train && (
              <p className="text-slate-500 text-xs mt-1">Training example saved.</p>
            )}
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Back to home
          </button>
        </div>
      </div>
    )
  }

  // ── Main layout ─────────────────────────────────────────────────────────────

  const isPhoto = job.metadata?.is_photo
  const suggestedTitle = job.suggested_title || ''
  const suggestions = job.suggestions || []

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-semibold text-white">Verify Classification</h1>
              {suggestedTitle
                ? <p className="text-xs text-slate-300 truncate max-w-sm" title={suggestedTitle}>{suggestedTitle}</p>
                : <p className="text-xs text-slate-500 truncate max-w-xs">{job.filename}</p>
              }
              {suggestedTitle && (
                <p className="text-xs text-slate-600 truncate max-w-xs">{job.filename}</p>
              )}
            </div>
          </div>
          {isPhoto && (
            <span className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-full px-3 py-1">
              Photograph detected
            </span>
          )}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Left: document preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden" style={{ minHeight: '520px' }}>
            <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Document</span>
              <span className="text-xs text-slate-600 truncate">{job.filename}</span>
            </div>
            <div className="p-3 h-[480px]">
              <DocumentPreview jobId={jobId} fileExt={job.file_ext} filename={job.filename} />
            </div>
          </div>

          {/* Right: classification panel */}
          <div className="flex flex-col gap-4">

            {/* Suggestions */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-medium text-slate-300 mb-3">Suggested classifications</h2>
              <div className="space-y-2">
                {suggestions.map(s => (
                  <SuggestionCard
                    key={s.asa_code}
                    suggestion={s}
                    selected={selected?.asa_code === s.asa_code}
                    onSelect={s => setSelected({ asa_code: s.asa_code, hierarchy: s.hierarchy, disposal_action: s.disposal_action })}
                  />
                ))}
              </div>
            </div>

            {/* Search for a different code */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <h2 className="text-sm font-medium text-slate-300 mb-3">Search for a different code</h2>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by keyword or code…"
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              {searchResults.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {searchResults.map(r => (
                    <li key={r.asa_code}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected({ asa_code: r.asa_code, hierarchy: r.hierarchy, disposal_action: r.disposal_action })
                          setSearchQuery('')
                          setSearchResults([])
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          selected?.asa_code === r.asa_code
                            ? 'bg-indigo-500/20 text-indigo-300'
                            : 'hover:bg-slate-800 text-slate-300'
                        }`}
                      >
                        <span className="font-mono text-xs text-indigo-400 mr-2">{r.asa_code}</span>
                        {r.hierarchy}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Selected code summary */}
            {selected && (
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Selected</p>
                <p className="font-mono font-bold text-indigo-400">{selected.asa_code}</p>
                {selected.hierarchy && <p className="text-sm text-slate-300 mt-0.5">{selected.hierarchy}</p>}
                {selected.disposal_action && (
                  <p className="text-xs text-slate-500 mt-1">{selected.disposal_action}</p>
                )}
              </div>
            )}

            {/* Train option */}
            {allowTraining && (
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={train}
                  onChange={e => setTrain(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-slate-900"
                />
                <span className="text-sm text-slate-400">Train the system with this result</span>
              </label>
            )}

            {/* Confirm error */}
            {confirmError && (
              <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {confirmError}
              </p>
            )}

            {/* Confirm button */}
            <button
              onClick={handleConfirm}
              disabled={!selected?.asa_code || confirming}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {confirming ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Confirming…
                </>
              ) : (
                'Confirm Classification'
              )}
            </button>

          </div>
        </div>
      </div>
    </div>
  )
}
