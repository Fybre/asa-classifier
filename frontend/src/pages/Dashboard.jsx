import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { listCodes, startRebuildEmbeddings, getRebuildStatus, exportExamples, importExamples, getSettings, setAdminCredentials, clearAdminCredentials, getAdminCredentials } from '../api.js'
import BulkUploadModal from '../components/BulkUploadModal.jsx'

export default function Dashboard() {
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [rebuild, setRebuild] = useState({ status: 'idle', log: [], error: null })
  const [importState, setImportState] = useState({ status: 'idle', result: null, error: null })
  const pollRef = useRef(null)
  const logRef = useRef(null)
  const importInputRef = useRef(null)
  const navigate = useNavigate()

  // Auth state
  const [authRequired, setAuthRequired] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState(null)
  const [loginLoading, setLoginLoading] = useState(false)

  function handleUnauthorized() {
    clearAdminCredentials()
    setAuthenticated(false)
  }

  async function fetchCodes() {
    try {
      setLoading(true)
      setError(null)
      const data = await listCodes()
      setCodes(data)
    } catch (e) {
      if (e.status === 401) { handleUnauthorized(); return }
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function init() {
      const settings = await getSettings()
      setAuthRequired(settings.admin_auth_enabled)
      if (settings.admin_auth_enabled) {
        const creds = getAdminCredentials()
        if (!creds) { setLoading(false); return }
        // Verify stored credentials
        try {
          await getRebuildStatus()
          setAuthenticated(true)
          fetchCodes()
        } catch (e) {
          if (e.status === 401) { clearAdminCredentials(); setLoading(false) }
        }
      } else {
        setAuthenticated(true)
        fetchCodes()
        getRebuildStatus().then(setRebuild).catch(() => {})
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (authenticated) {
      getRebuildStatus().then(setRebuild).catch(() => {})
    }
  }, [authenticated])

  async function handleLogin(e) {
    e.preventDefault()
    setLoginError(null)
    setLoginLoading(true)
    setAdminCredentials(loginUsername, loginPassword)
    try {
      await getRebuildStatus()
      setAuthenticated(true)
      fetchCodes()
    } catch (err) {
      clearAdminCredentials()
      setLoginError(err.status === 401 ? 'Invalid username or password.' : 'Connection error.')
    } finally {
      setLoginLoading(false)
    }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [rebuild.log])

  async function handleRebuild() {
    try {
      await startRebuildEmbeddings()
      setRebuild({ status: 'running', log: [], error: null })
      pollRef.current = setInterval(async () => {
        try {
          const state = await getRebuildStatus()
          setRebuild(state)
          if (state.status === 'done' || state.status === 'error') {
            clearInterval(pollRef.current)
          }
        } catch {}
      }, 1000)
    } catch (e) {
      setRebuild({ status: 'error', log: [], error: e.message })
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  async function handleExport() {
    try { await exportExamples() } catch (e) { alert(e.message) }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportState({ status: 'loading', result: null, error: null })
    try {
      const result = await importExamples(file)
      setImportState({ status: 'done', result, error: null })
      fetchCodes()
    } catch (err) {
      setImportState({ status: 'error', result: null, error: err.message })
    }
    e.target.value = ''
  }

  const totalExamples = codes.reduce((sum, c) => sum + c.count, 0)

  function formatDate(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })
    } catch { return iso }
  }

  // Show login screen when auth is required and not yet authenticated
  if (authRequired && !authenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-white">Admin Sign In</h1>
          </div>
          <form onSubmit={handleLogin} className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
              <input
                type="text"
                value={loginUsername}
                onChange={e => setLoginUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={e => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2.5 text-sm">
                {loginError}
              </div>
            )}
            <button
              type="submit"
              disabled={loginLoading || !loginUsername || !loginPassword}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              {loginLoading && (
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {loginLoading ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="text-center text-xs text-slate-600 pt-1">
              <Link to="/" className="hover:text-slate-400 transition-colors">← Back to user portal</Link>
            </p>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-10">
          <div className="flex items-center gap-3">
            <Link to="/" className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 flex items-center justify-center transition-colors shrink-0" title="User Portal">
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
              </svg>
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-white">ASA Classifier Admin</h1>
              <p className="text-slate-500 text-sm">Manage training examples and classification data</p>
            </div>
          </div>
          {authRequired && (
            <button
              onClick={() => { clearAdminCredentials(); navigate('/') }}
              className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 text-sm transition-colors"
              title="Sign out"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              Sign out
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <p className="text-sm text-slate-500">ASA Codes Trained</p>
            <p className="text-3xl font-bold text-white mt-1">{loading ? '—' : codes.length}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <p className="text-sm text-slate-500">Total Training Examples</p>
            <p className="text-3xl font-bold text-white mt-1">{loading ? '—' : totalExamples}</p>
          </div>
        </div>

        {/* Action cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">

          {/* Admin Tasks */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Admin Tasks</h2>

            {/* Rebuild embeddings */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">Rebuild Embeddings</p>
                  <p className="text-xs text-slate-500 mt-0.5">Re-index all training examples and rules with the current model.</p>
                </div>
                <button
                  onClick={handleRebuild}
                  disabled={rebuild.status === 'running'}
                  className="shrink-0 inline-flex items-center gap-1.5 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-50 text-amber-400 border border-amber-500/30 font-medium px-3 py-1.5 rounded-lg transition-colors text-xs"
                >
                  {rebuild.status === 'running' && (
                    <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {rebuild.status === 'running' ? 'Rebuilding…' : 'Rebuild'}
                </button>
              </div>
              {rebuild.status !== 'idle' && (
                <div className={`rounded-lg border overflow-hidden ${
                  rebuild.status === 'error' ? 'border-red-500/30' :
                  rebuild.status === 'done'  ? 'border-emerald-500/30' : 'border-amber-500/30'
                }`}>
                  <div className={`px-3 py-2 flex items-center justify-between text-xs font-medium ${
                    rebuild.status === 'error' ? 'bg-red-500/10 text-red-400' :
                    rebuild.status === 'done'  ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    <span>
                      {rebuild.status === 'running' && 'Rebuilding embeddings…'}
                      {rebuild.status === 'done'    && 'Rebuild complete'}
                      {rebuild.status === 'error'   && `Rebuild failed: ${rebuild.error}`}
                    </span>
                    {(rebuild.status === 'done' || rebuild.status === 'error') && (
                      <button onClick={() => setRebuild({ status: 'idle', log: [], error: null })} className="opacity-60 hover:opacity-100 transition-opacity ml-2">Dismiss</button>
                    )}
                  </div>
                  {rebuild.log.length > 0 && (
                    <div ref={logRef} className="bg-slate-900 text-slate-400 text-xs font-mono px-3 py-2 max-h-32 overflow-y-auto space-y-0.5">
                      {rebuild.log.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-700" />

            {/* Export / Import */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">Export Examples</p>
                  <p className="text-xs text-slate-500 mt-0.5">Download all training examples as a JSON backup.</p>
                </div>
                <button
                  onClick={handleExport}
                  className="shrink-0 inline-flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600 font-medium px-3 py-1.5 rounded-lg transition-colors text-xs"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export
                </button>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-200">Import Examples</p>
                  <p className="text-xs text-slate-500 mt-0.5">Restore from a JSON export. Duplicates are skipped.</p>
                </div>
                <button
                  onClick={() => importInputRef.current?.click()}
                  disabled={importState.status === 'loading'}
                  className="shrink-0 inline-flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 border border-slate-600 font-medium px-3 py-1.5 rounded-lg transition-colors text-xs"
                >
                  {importState.status === 'loading' ? (
                    <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5V21" />
                    </svg>
                  )}
                  {importState.status === 'loading' ? 'Importing…' : 'Import'}
                </button>
              </div>
              <input ref={importInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              {importState.status === 'done' && importState.result && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg px-3 py-2 text-xs">
                  Import complete: {importState.result.imported} imported, {importState.result.skipped} skipped.
                </div>
              )}
              {importState.status === 'error' && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2 text-xs">
                  Import failed: {importState.error}
                </div>
              )}
            </div>
          </div>

          {/* Bulk Upload */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Bulk Upload</h2>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-200">Upload Training Documents</p>
                <p className="text-xs text-slate-500 mt-0.5">Add multiple documents at once and assign them to an ASA code.</p>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors text-xs"
              >
                Bulk Upload
              </button>
            </div>
          </div>
        </div>

        {/* Training examples table */}
        {loading && (
          <div className="text-center py-16 text-slate-500">Loading training data...</div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-4 mb-4 text-sm">
            Error: {error}
          </div>
        )}

        {!loading && !error && codes.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <p>No training examples yet.</p>
            <p className="text-sm mt-2">Use Bulk Upload to add training documents.</p>
          </div>
        )}

        {!loading && !error && codes.length > 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-4 py-3 font-medium text-slate-400">ASA Code</th>
                  <th className="px-4 py-3 font-medium text-slate-400">Hierarchy</th>
                  <th className="px-4 py-3 font-medium text-slate-400 text-right">Examples</th>
                  <th className="px-4 py-3 font-medium text-slate-400">Last Trained</th>
                  <th className="px-4 py-3 font-medium text-slate-400"></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c, i) => (
                  <tr
                    key={c.asa_code}
                    className={`hover:bg-slate-700/40 transition-colors ${i < codes.length - 1 ? 'border-b border-slate-700/60' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-indigo-400">{c.asa_code}</td>
                    <td className="px-4 py-3 text-slate-300">{c.hierarchy || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-block bg-indigo-500/20 text-indigo-400 text-xs font-medium px-2 py-0.5 rounded-full">
                        {c.count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.last_trained)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => navigate(`/admin/codes/${encodeURIComponent(c.asa_code)}`)}
                        className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors text-xs"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <BulkUploadModal onClose={() => { setShowModal(false); fetchCodes() }} />
      )}
    </div>
  )
}
