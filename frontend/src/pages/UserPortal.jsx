import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { analyseDocument, suggestCodes, trainDocument, getSettings } from '../api.js'
import fybreLogo from '../assets/fybre_logo.png'

const TABS = ['Search Codes', 'Describe Document', 'Classify Document', 'Batch Classify']
const SUPPORTED = '.pdf,.jpg,.jpeg,.png,.txt,.docx,.xlsx,.xls'

function ConfidenceBadge({ value }) {
  const pct = Math.round((value || 0) * 100)
  const colour =
    pct >= 80 ? 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/30' :
    pct >= 50 ? 'bg-amber-500/20 text-amber-400 ring-amber-500/30' :
                'bg-red-500/20 text-red-400 ring-red-500/30'
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ${colour}`}>
      {pct}% confidence
    </span>
  )
}

function DropZone({ file, onFile, disabled }) {
  const [dragging, setDragging] = useState(false)

  function pickFile(f) {
    if (!f) return
    const ext = '.' + f.name.split('.').pop().toLowerCase()
    if (!SUPPORTED.split(',').includes(ext)) return
    onFile(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    pickFile(e.dataTransfer.files[0])
  }

  function onDragOver(e) {
    e.preventDefault()
    if (!disabled) setDragging(true)
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onClick={() => !disabled && document.getElementById('classify-file-input').click()}
      className={`relative border-2 border-dashed rounded-xl px-6 py-12 text-center cursor-pointer transition-all select-none
        ${dragging
          ? 'border-indigo-400 bg-indigo-500/10'
          : file
          ? 'border-emerald-500/50 bg-emerald-500/5'
          : 'border-slate-600 bg-slate-800/50 hover:border-indigo-500/60 hover:bg-indigo-500/5'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <input
        id="classify-file-input"
        type="file"
        accept={SUPPORTED}
        className="sr-only"
        onChange={e => pickFile(e.target.files[0])}
      />
      {file ? (
        <>
          <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-emerald-400 font-medium text-sm">{file.name}</p>
          <p className="text-slate-500 text-xs mt-1">{(file.size / 1024).toFixed(0)} KB — click to change</p>
        </>
      ) : (
        <>
          <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <p className="text-slate-300 text-sm font-medium">Drop a file here, or click to browse</p>
          <p className="text-slate-500 text-xs mt-1">PDF, Word, Excel, images, TXT</p>
        </>
      )}
    </div>
  )
}

function ClassifyTab({ allowTraining }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [trainStatus, setTrainStatus] = useState(null)
  const [trainError, setTrainError] = useState(null)

  function handleFileChange(f) {
    setFile(f)
    setResult(null)
    setError(null)
    setTrainStatus(null)
    setTrainError(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setResult(null)
    setError(null)
    setTrainStatus(null)
    setTrainError(null)
    try {
      const data = await analyseDocument(file)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleTrain(asaCode) {
    if (!file) return
    setTrainStatus({ code: asaCode, status: 'loading' })
    setTrainError(null)
    try {
      const res = await trainDocument(file, asaCode)
      setTrainStatus({ code: asaCode, status: res.status || 'added', message: res.message })
    } catch (err) {
      setTrainStatus({ code: asaCode, status: 'error' })
      setTrainError(err.message)
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-slate-400 text-sm">Upload a document and the system will classify it against the ASA retention schedule.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <DropZone file={file} onFile={handleFileChange} disabled={loading} />
        <button
          type="submit"
          disabled={!file || loading}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
        >
          {loading && (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {loading ? 'Classifying...' : 'Classify Document'}
        </button>
      </form>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-4 text-sm">{error}</div>
      )}

      {result && (
        <div className="space-y-3">
          {result.is_photo && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
              <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div>
                <p className="text-amber-400 text-sm font-medium">Photograph detected</p>
                <p className="text-amber-400/70 text-xs mt-0.5">Classification has been weighted toward photo-relevant ASA codes.</p>
              </div>
            </div>
          )}
          {result.vision_description && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Vision Description</p>
              <p className="text-slate-300 text-sm leading-relaxed">{result.vision_description}</p>
            </div>
          )}
          {result.suggested_title && (
            <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Suggested Title</p>
              <p className="text-slate-200 text-sm font-medium">{result.suggested_title}</p>
            </div>
          )}
          {result.filename && (
            <p className="text-xs text-slate-600">{result.filename}</p>
          )}
          {result.suggestions?.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Suggested Classifications</p>
              {result.suggestions.map((s, i) => (
                <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono font-bold text-indigo-400 text-lg">{s.asa_code}</span>
                      {s.hierarchy && (
                        <span className="text-slate-300 text-sm ml-2.5">{s.hierarchy}</span>
                      )}
                    </div>
                    <ConfidenceBadge value={s.confidence} />
                  </div>
                  {s.description && (
                    <p className="text-slate-400 text-sm">{s.description}</p>
                  )}
                  {s.reasoning && (
                    <p className="text-slate-500 text-xs leading-relaxed italic border-l-2 border-slate-700 pl-3">{s.reasoning}</p>
                  )}
                  {(str(s.examples) || str(s.disposal_action)) && (
                    <div className="space-y-1 pt-1 border-t border-slate-700">
                      {str(s.examples) && (
                        <p className="text-xs">
                          <span className="text-slate-600">Examples: </span>
                          <span className="text-slate-400">{s.examples}</span>
                        </p>
                      )}
                      {str(s.disposal_action) && (
                        <p className="text-xs">
                          <span className="text-slate-600">Disposal: </span>
                          <span className="text-slate-400">{s.disposal_action}</span>
                        </p>
                      )}
                    </div>
                  )}
                  {!result.is_photo && allowTraining && (() => {
                    const ts = trainStatus?.code === s.asa_code ? trainStatus : null
                    return (
                      <div className="border-t border-slate-700 pt-3 flex items-center gap-3">
                        {ts?.status === 'added' ? (
                          <span className="text-emerald-400 text-sm font-medium flex items-center gap-1.5">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Saved as training example
                          </span>
                        ) : ts?.status === 'exact_duplicate' ? (
                          <span className="text-slate-400 text-xs flex items-center gap-1.5">
                            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                            Already in training set
                          </span>
                        ) : ts?.status === 'near_duplicate' ? (
                          <span className="text-amber-400 text-xs flex items-center gap-1.5" title={ts.message}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                            Near-duplicate — skipped
                          </span>
                        ) : (
                          <>
                            <button
                              onClick={() => handleTrain(s.asa_code)}
                              disabled={ts?.status === 'loading'}
                              className="inline-flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-50 text-emerald-400 text-xs font-medium px-3.5 py-1.5 rounded-lg border border-emerald-500/30 transition-colors"
                            >
                              {ts?.status === 'loading' ? 'Saving...' : 'Train with this result'}
                            </button>
                            {ts?.status === 'error' && (
                              <span className="text-red-400 text-xs">{trainError}</span>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function str(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  return s.toLowerCase() === 'nan' ? '' : s
}

function highlight(text, terms) {
  const s = str(text)
  if (!terms?.length || !s) return s
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = s.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  const termSet = new Set(terms.map(t => t.toLowerCase()))
  return parts.map((part, i) =>
    termSet.has(part.toLowerCase())
      ? <mark key={i} className="bg-amber-400/30 text-amber-300 rounded px-0.5">{part}</mark>
      : part
  )
}

function CodeRow({ r, terms }) {
  return (
    <div className="px-4 py-3 hover:bg-slate-700/40 transition-colors">
      <div className="flex items-baseline gap-3">
        <span className="font-mono font-semibold text-indigo-400 text-sm shrink-0">{highlight(r.asa_code, terms)}</span>
        <span className="text-slate-200 text-sm">{highlight(r.hierarchy, terms)}</span>
      </div>
      {str(r.description) && (
        <p className="text-slate-500 text-xs mt-1">{highlight(r.description, terms)}</p>
      )}
      {str(r.examples) && (
        <p className="text-xs mt-1">
          <span className="text-slate-600">Examples: </span>
          <span className="text-slate-400">{highlight(r.examples, terms)}</span>
        </p>
      )}
      {str(r.disposal_action) && (
        <p className="text-xs mt-1">
          <span className="text-slate-600">Disposal: </span>
          <span className="text-slate-400">{highlight(r.disposal_action, terms)}</span>
        </p>
      )}
    </div>
  )
}

function SearchTab() {
  const [query, setQuery] = useState('')
  const [allCodes, setAllCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/asa-codes')
      .then(r => r.json())
      .then(data => setAllCodes(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const q = query.toLowerCase().trim()
  const words = q.split(/\s+/).filter(Boolean)

  const searchText = r => [
    str(r.asa_code), str(r.hierarchy), str(r.description),
    str(r.disposal_action), str(r.examples)
  ].join(' ').toLowerCase()

  let exactMatches = []
  let wordMatches = []

  if (q) {
    allCodes.forEach(r => {
      const text = searchText(r)
      if (text.includes(q)) {
        exactMatches.push(r)
      } else if (words.length > 1 && words.every(w => text.includes(w))) {
        wordMatches.push(r)
      }
    })
  }

  const totalCount = q ? exactMatches.length + wordMatches.length : allCodes.length

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">Search for ASA codes by code number, title, or keyword.</p>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="e.g. financial records, 4.1, student..."
        autoFocus
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors"
      />

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-4 text-sm">{error}</div>
      )}

      {loading && (
        <p className="text-slate-500 text-sm text-center py-8">Loading codes...</p>
      )}

      {!loading && !error && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-600">
            {q ? `${totalCount} code${totalCount !== 1 ? 's' : ''} matched` : `${allCodes.length} codes`}
          </p>
          <div className="bg-slate-800 border border-slate-700 rounded-xl divide-y divide-slate-700/60 max-h-[60vh] overflow-y-auto">
            {!q
              ? allCodes.map(r => <CodeRow key={r.asa_code} r={r} terms={[]} />)
              : totalCount === 0
              ? <p className="text-slate-500 text-sm text-center py-10">No codes matched your search.</p>
              : <>
                  {exactMatches.map(r => <CodeRow key={r.asa_code} r={r} terms={words} />)}
                  {wordMatches.length > 0 && (
                    <>
                      <div className="px-4 py-2 bg-slate-900/60 text-xs text-slate-500 font-medium tracking-wide">
                        Also matched — all words found
                      </div>
                      {wordMatches.map(r => <CodeRow key={r.asa_code} r={r} terms={words} />)}
                    </>
                  )}
                </>
            }
          </div>
        </div>
      )}
    </div>
  )
}

function DescribeTab() {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!description.trim()) return
    setLoading(true)
    setError(null)
    setSuggestions([])
    try {
      const data = await suggestCodes(description)
      setSuggestions(data.suggestions || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-slate-400 text-sm">Describe what a document is about and the system will suggest likely ASA codes.</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Document Description</label>
          <textarea
            value={description}
            onChange={e => { setDescription(e.target.value); setSuggestions([]) }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (description.trim() && !loading) handleSubmit(e) } }}
            placeholder="e.g. A letter from a parent regarding their child's enrolment, including contact details and medical information..."
            rows={4}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-colors"
          />
          <p className="text-xs text-slate-600 mt-1.5">Press Enter to submit, Shift+Enter for new line</p>
        </div>
        <button
          type="submit"
          disabled={!description.trim() || loading}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
        >
          {loading && (
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {loading ? 'Analysing...' : 'Suggest Codes'}
        </button>
      </form>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-4 text-sm">{error}</div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Suggested Classifications</p>
          {suggestions.map((s, i) => (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="font-mono font-bold text-indigo-400 text-lg">{s.asa_code}</span>
                  {s.hierarchy && (
                    <span className="text-slate-300 text-sm ml-2.5">{s.hierarchy}</span>
                  )}
                </div>
                <ConfidenceBadge value={s.confidence} />
              </div>
              {s.description && (
                <p className="text-slate-400 text-sm">{s.description}</p>
              )}
              {s.reasoning && (
                <p className="text-slate-500 text-xs leading-relaxed italic border-l-2 border-slate-700 pl-3">{s.reasoning}</p>
              )}
              {(str(s.examples) || str(s.disposal_action)) && (
                <div className="space-y-1 pt-1 border-t border-slate-700">
                  {str(s.examples) && (
                    <p className="text-xs">
                      <span className="text-slate-600">Examples: </span>
                      <span className="text-slate-400">{s.examples}</span>
                    </p>
                  )}
                  {str(s.disposal_action) && (
                    <p className="text-xs">
                      <span className="text-slate-600">Disposal: </span>
                      <span className="text-slate-400">{s.disposal_action}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BatchClassifyTab() {
  const [files, setFiles] = useState([])
  const [rows, setRows] = useState([])
  const [running, setRunning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useState(null)

  const supported = SUPPORTED.split(',')

  function addFiles(incoming) {
    const valid = Array.from(incoming).filter(f =>
      supported.includes('.' + f.name.split('.').pop().toLowerCase())
    )
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name))
      return [...prev, ...valid.filter(f => !existing.has(f.name))]
    })
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    if (running) return
    addFiles(e.dataTransfer.files)
  }

  function onDragOver(e) {
    e.preventDefault()
    if (!running) setDragging(true)
  }

  async function runBatch() {
    if (!files.length || running) return
    setRunning(true)
    const initial = files.map(f => ({ filename: f.name, status: 'pending', asa_code: null, confidence: null, hierarchy: null, disposal_action: null, is_photo: false, error: null }))
    setRows(initial)

    for (let i = 0; i < files.length; i++) {
      setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' } : r))
      try {
        const data = await analyseDocument(files[i])
        const top = data.suggestions?.[0]
        const s2 = data.suggestions?.[1]
        const s3 = data.suggestions?.[2]
        setRows(prev => prev.map((r, idx) => idx === i ? {
          ...r,
          status: 'done',
          is_photo: !!data.is_photo,
          asa_code: top?.asa_code || '',
          confidence: top?.confidence ?? null,
          hierarchy: top?.hierarchy || '',
          disposal_action: top?.disposal_action || '',
          s2_code: s2?.asa_code || '', s2_conf: s2?.confidence ?? null,
          s3_code: s3?.asa_code || '', s3_conf: s3?.confidence ?? null,
        } : r))
      } catch (e) {
        setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: e.message } : r))
      }
    }
    setRunning(false)
  }

  function downloadCSV() {
    const headers = [
      'Filename', 'ASA Code', 'Hierarchy', 'Confidence %', 'Disposal Action',
      '2nd Code', '2nd Confidence %', '3rd Code', '3rd Confidence %', 'Note'
    ]
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csvRows = rows
      .filter(r => r.status === 'done' || r.status === 'error')
      .map(r => r.status === 'error'
        ? [escape(r.filename), '', '', '', '', '', '', '', '', escape(`Error: ${r.error}`)].join(',')
        : [
            escape(r.filename),
            escape(r.asa_code),
            escape(r.hierarchy),
            escape(r.confidence != null ? Math.round(r.confidence * 100) : ''),
            escape(r.disposal_action),
            escape(r.s2_code),
            escape(r.s2_conf != null ? Math.round(r.s2_conf * 100) : ''),
            escape(r.s3_code),
            escape(r.s3_conf != null ? Math.round(r.s3_conf * 100) : ''),
            escape(r.is_photo ? 'Photograph' : ''),
          ].join(',')
      )
    const csv = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `asa_batch_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doneCount = rows.filter(r => r.status === 'done' || r.status === 'error').length
  const showTable = rows.length > 0

  return (
    <div className="space-y-5">
      <p className="text-slate-400 text-sm">Upload multiple documents to classify in batch. Results appear as each file completes.</p>

      {/* Drop zone — hidden while results are showing */}
      {!showTable && (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={() => setDragging(false)}
          onClick={() => !running && document.getElementById('batch-file-input').click()}
          className={`border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-all select-none
            ${dragging
              ? 'border-indigo-400 bg-indigo-500/10'
              : files.length
              ? 'border-indigo-500/40 bg-indigo-500/5'
              : 'border-slate-600 bg-slate-800/50 hover:border-indigo-500/60 hover:bg-indigo-500/5'}`}
        >
          <input
            id="batch-file-input"
            type="file"
            multiple
            accept={SUPPORTED}
            className="sr-only"
            onChange={e => addFiles(e.target.files)}
          />
          <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
            <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          {files.length === 0 ? (
            <>
              <p className="text-slate-300 text-sm font-medium">Drop files here, or click to browse</p>
              <p className="text-slate-500 text-xs mt-1">PDF, Word, Excel, images, TXT — multiple files</p>
            </>
          ) : (
            <p className="text-indigo-400 text-sm font-medium">{files.length} file{files.length !== 1 ? 's' : ''} selected — drop more or click to add</p>
          )}
        </div>
      )}

      {/* File list */}
      {!showTable && files.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl divide-y divide-slate-700/60 max-h-48 overflow-y-auto">
          {files.map(f => (
            <div key={f.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-300 truncate mr-3">{f.name}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-slate-500">{(f.size / 1024).toFixed(0)} KB</span>
                <button
                  onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter(x => x.name !== f.name)) }}
                  className="text-slate-600 hover:text-red-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {!showTable && (
          <button
            onClick={runBatch}
            disabled={!files.length || running}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
          >
            {running && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {running
              ? `Classifying… (${doneCount}/${files.length})`
              : `Classify ${files.length} Document${files.length !== 1 ? 's' : ''}`}
          </button>
        )}

        {showTable && !running && (
          <button
            onClick={() => { setFiles([]); setRows([]) }}
            className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 font-medium px-4 py-2 rounded-lg transition-colors text-sm"
          >
            New Batch
          </button>
        )}

        {doneCount > 0 && (
          <button
            onClick={downloadCSV}
            className="inline-flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-medium px-4 py-2 rounded-lg transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download CSV ({doneCount})
          </button>
        )}

        {showTable && running && (
          <span className="text-slate-500 text-sm">{doneCount} of {rows.length} complete</span>
        )}
      </div>

      {/* Progress bar */}
      {showTable && (
        <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-indigo-500 h-full transition-all duration-300"
            style={{ width: rows.length ? `${(doneCount / rows.length) * 100}%` : '0%' }}
          />
        </div>
      )}

      {/* Results table */}
      {showTable && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left">
                <th className="px-4 py-3 font-medium text-slate-400 w-6"></th>
                <th className="px-4 py-3 font-medium text-slate-400">Filename</th>
                <th className="px-4 py-3 font-medium text-slate-400">ASA Code</th>
                <th className="px-4 py-3 font-medium text-slate-400">Classification</th>
                <th className="px-4 py-3 font-medium text-slate-400 text-right">Confidence</th>
                <th className="px-4 py-3 font-medium text-slate-400">Disposal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={`transition-colors ${i < rows.length - 1 ? 'border-b border-slate-700/60' : ''}
                    ${r.status === 'processing' ? 'bg-indigo-500/5' : 'hover:bg-slate-700/30'}`}
                >
                  {/* Status icon */}
                  <td className="px-4 py-3 w-6">
                    {r.status === 'pending' && (
                      <span className="block w-2 h-2 rounded-full bg-slate-600 mx-auto" />
                    )}
                    {r.status === 'processing' && (
                      <svg className="animate-spin w-4 h-4 text-indigo-400 mx-auto" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    )}
                    {r.status === 'done' && (
                      <svg className="w-4 h-4 text-emerald-400 mx-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    {r.status === 'error' && (
                      <svg className="w-4 h-4 text-red-400 mx-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                    )}
                  </td>
                  {/* Filename */}
                  <td className="px-4 py-3 text-slate-300 max-w-[160px]">
                    <span className="block truncate" title={r.filename}>{r.filename}</span>
                    {r.is_photo && <span className="text-xs text-amber-500">photograph</span>}
                    {r.status === 'error' && <span className="text-xs text-red-400 block mt-0.5 truncate" title={r.error}>{r.error}</span>}
                  </td>
                  {/* ASA code */}
                  <td className="px-4 py-3">
                    {r.asa_code
                      ? <span className="font-mono font-semibold text-indigo-400">{r.asa_code}</span>
                      : <span className="text-slate-600">—</span>}
                  </td>
                  {/* Hierarchy */}
                  <td className="px-4 py-3 text-slate-400 max-w-[220px]">
                    <span className="block truncate text-xs" title={r.hierarchy}>{r.hierarchy || '—'}</span>
                    {r.s2_code && (
                      <span className="text-slate-600 text-xs">
                        {r.s2_code}{r.s2_conf != null ? ` · ${Math.round(r.s2_conf * 100)}%` : ''}
                        {r.s3_code ? `, ${r.s3_code}${r.s3_conf != null ? ` · ${Math.round(r.s3_conf * 100)}%` : ''}` : ''}
                      </span>
                    )}
                  </td>
                  {/* Confidence */}
                  <td className="px-4 py-3 text-right">
                    {r.confidence != null ? <ConfidenceBadge value={r.confidence} /> : <span className="text-slate-600">—</span>}
                  </td>
                  {/* Disposal */}
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[140px]">
                    <span className="block truncate" title={r.disposal_action}>{r.disposal_action || '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function UserPortal() {
  const [activeTab, setActiveTab] = useState(0)
  const [allowTraining, setAllowTraining] = useState(true)

  useEffect(() => {
    getSettings().then(s => setAllowTraining(s.allow_user_training))
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-10 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
              </div>
              <h1 className="text-xl font-semibold text-white">Document Classification</h1>
            </div>
            <p className="text-slate-500 text-sm ml-11">ASA Retention Schedule Classifier</p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <a
              href="https://github.com/Fybre"
              target="_blank"
              rel="noopener noreferrer"
              title="Fybre on GitHub"
            >
              <img src={fybreLogo} alt="Fybre" className="h-7 w-auto opacity-80 hover:opacity-100 transition-opacity" />
            </a>
            <Link
              to="/admin"
              className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 hover:bg-slate-700 flex items-center justify-center transition-colors"
              title="Admin Dashboard"
            >
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
            </Link>
            <Link
              to="/help"
              className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 hover:bg-slate-700 flex items-center justify-center transition-colors"
              title="Help & API Reference"
            >
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1 mb-8">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === i
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 0 && <SearchTab />}
          {activeTab === 1 && <DescribeTab />}
          {activeTab === 2 && <ClassifyTab allowTraining={allowTraining} />}
          {activeTab === 3 && <BatchClassifyTab />}
        </div>
      </div>
    </div>
  )
}
