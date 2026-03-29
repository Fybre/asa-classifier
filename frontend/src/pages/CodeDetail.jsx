import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { listExamples, deleteExample, trainBulk, openExampleFile } from '../api.js'

export default function CodeDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const decodedCode = decodeURIComponent(code)

  const [examples, setExamples] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [uploadFiles, setUploadFiles] = useState([])
  const [uploadArchive, setUploadArchive] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)

  async function fetchExamples() {
    try {
      setLoading(true)
      setError(null)
      const data = await listExamples(decodedCode)
      setExamples(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchExamples() }, [decodedCode])

  async function handleDelete(id, filename) {
    const confirmed = window.confirm(`Delete example${filename ? ` "${filename}"` : ''}?`)
    if (!confirmed) return
    const shouldDeleteFile = window.confirm('Also delete the archived file from disk?')
    try {
      await deleteExample(id, shouldDeleteFile)
      setExamples(prev => prev.filter(e => e.id !== id))
    } catch (e) {
      alert(`Failed to delete: ${e.message}`)
    }
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!uploadFiles.length) return
    setUploading(true)
    setUploadResult(null)
    setUploadError(null)
    try {
      const result = await trainBulk(uploadFiles, decodedCode, uploadArchive)
      setUploadResult(result)
      setUploadFiles([])
      const input = document.getElementById('detail-file-input')
      if (input) input.value = ''
      fetchExamples()
    } catch (e) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  function formatDate(iso) {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleString('en-AU', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={() => navigate('/admin')}
              className="text-slate-500 hover:text-slate-300 text-sm flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
              Back to Dashboard
            </button>
            <Link to="/" className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 flex items-center justify-center transition-colors" title="User Portal">
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </Link>
          </div>
          <h1 className="text-xl font-semibold text-white">
            ASA Code <span className="font-mono text-indigo-400">{decodedCode}</span>
          </h1>
          {examples.length > 0 && examples[0].hierarchy && (
            <p className="text-slate-400 mt-1 text-sm">{examples[0].hierarchy}</p>
          )}
          <p className="text-slate-600 text-sm mt-1">{examples.length} training example{examples.length !== 1 ? 's' : ''}</p>
        </div>

        {loading && <div className="text-center py-12 text-slate-500">Loading examples...</div>}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-4 mb-6 text-sm">
            Error: {error}
          </div>
        )}

        {!loading && !error && examples.length === 0 && (
          <div className="text-center py-12 text-slate-500">No examples for this code yet.</div>
        )}

        {!loading && !error && examples.length > 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-4 py-3 font-medium text-slate-400">Filename</th>
                  <th className="px-4 py-3 font-medium text-slate-400">Date Added</th>
                  <th className="px-4 py-3 font-medium text-slate-400">Text Preview</th>
                  <th className="px-4 py-3 font-medium text-slate-400">Archive</th>
                  <th className="px-4 py-3 font-medium text-slate-400"></th>
                </tr>
              </thead>
              <tbody>
                {examples.map((ex, i) => (
                  <tr
                    key={ex.id}
                    className={`hover:bg-slate-700/40 transition-colors ${i < examples.length - 1 ? 'border-b border-slate-700/60' : ''}`}
                  >
                    <td className="px-4 py-3 text-slate-200 font-medium max-w-[160px] truncate">
                      {ex.filename || <span className="text-slate-500 italic">unknown</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{formatDate(ex.timestamp)}</td>
                    <td className="px-4 py-3 text-slate-500 max-w-[240px]">
                      <span className="line-clamp-2 text-xs">{ex.text_preview || '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {ex.archive_path ? (
                        <button
                          onClick={() => openExampleFile(ex.id).catch(e => alert(e.message))}
                          className="text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-colors"
                        >
                          View File
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(ex.id, ex.filename)}
                        className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Upload more */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h2 className="text-base font-semibold text-white mb-4">Upload More Documents</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Select Files</label>
              <input
                id="detail-file-input"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.txt,.docx,.xlsx,.xls"
                onChange={e => setUploadFiles(Array.from(e.target.files))}
                className="block w-full text-sm text-slate-400
                  file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                  file:text-sm file:font-medium file:bg-indigo-500/20 file:text-indigo-400
                  hover:file:bg-indigo-500/30 file:transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="detail-archive"
                checked={uploadArchive}
                onChange={e => setUploadArchive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-indigo-500"
              />
              <label htmlFor="detail-archive" className="text-sm text-slate-400">Keep files for reference</label>
            </div>
            <button
              type="submit"
              disabled={uploading || uploadFiles.length === 0}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
            >
              {uploading ? 'Uploading...' : `Upload${uploadFiles.length > 0 ? ` ${uploadFiles.length} file${uploadFiles.length !== 1 ? 's' : ''}` : ''}`}
            </button>
          </form>

          {uploadError && (
            <div className="mt-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm">
              {uploadError}
            </div>
          )}

          {uploadResult && (
            <div className="mt-4 space-y-2">
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg p-3 text-sm">
                <p className="font-medium">
                  Upload complete: {uploadResult.succeeded.length} added
                  {uploadResult.duplicates?.length > 0 && `, ${uploadResult.duplicates.length} duplicate${uploadResult.duplicates.length !== 1 ? 's' : ''} skipped`}
                  {uploadResult.failed.length > 0 && `, ${uploadResult.failed.length} failed`}
                </p>
              </div>
              {uploadResult.duplicates?.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg p-3 text-sm">
                  <p className="font-medium mb-1">Duplicates skipped</p>
                  <ul className="list-disc list-inside text-xs space-y-0.5">
                    {uploadResult.duplicates.map((d, i) => <li key={i}>{d.filename}: {d.reason}</li>)}
                  </ul>
                </div>
              )}
              {uploadResult.failed.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 text-sm">
                  <p className="font-medium mb-1">Failed</p>
                  <ul className="list-disc list-inside text-xs space-y-0.5">
                    {uploadResult.failed.map((f, i) => <li key={i}>{f.filename}: {f.error}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
