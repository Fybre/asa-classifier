import { useState } from 'react'
import { trainBulk } from '../api.js'

export default function BulkUploadModal({ onClose }) {
  const [asaCode, setAsaCode] = useState('')
  const [files, setFiles] = useState([])
  const [archive, setArchive] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!asaCode.trim()) { setError('ASA Code is required.'); return }
    if (files.length === 0) { setError('Please select at least one file.'); return }
    setError(null)
    setUploading(true)
    try {
      const data = await trainBulk(files, asaCode.trim(), archive)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h2 className="text-base font-semibold text-white">Bulk Upload Training Documents</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {result === null ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  ASA Code <span className="text-slate-500 font-normal">e.g. 4.1</span>
                </label>
                <input
                  type="text"
                  value={asaCode}
                  onChange={e => setAsaCode(e.target.value)}
                  placeholder="e.g. 4.1"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Files <span className="text-slate-500 font-normal">(multiple allowed)</span>
                </label>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.txt,.docx,.xlsx,.xls"
                  onChange={e => setFiles(Array.from(e.target.files))}
                  className="block w-full text-sm text-slate-400
                    file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                    file:text-sm file:font-medium file:bg-indigo-500/20 file:text-indigo-400
                    hover:file:bg-indigo-500/30 file:transition-colors"
                />
                {files.length > 0 && (
                  <p className="text-xs text-slate-500 mt-1.5">{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="modal-archive"
                  checked={archive}
                  onChange={e => setArchive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-indigo-500"
                />
                <label htmlFor="modal-archive" className="text-sm text-slate-400">Keep files for reference</label>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-3 py-2.5 text-sm">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
                >
                  {uploading && (
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {uploading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                <p className="font-semibold text-emerald-400 text-sm">Upload complete</p>
                <p className="text-emerald-400/70 text-sm mt-1">
                  {result.succeeded.length} added
                  {result.duplicates?.length > 0 && `, ${result.duplicates.length} duplicate${result.duplicates.length !== 1 ? 's' : ''} skipped`}
                  {result.failed.length > 0 && `, ${result.failed.length} failed`}
                </p>
                {result.succeeded.length > 0 && (
                  <ul className="mt-2 list-disc list-inside text-emerald-400/70 text-xs space-y-0.5">
                    {result.succeeded.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                )}
              </div>
              {result.duplicates?.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                  <p className="font-semibold text-amber-400 text-sm">Duplicates skipped</p>
                  <ul className="mt-2 list-disc list-inside text-amber-400/70 text-xs space-y-0.5">
                    {result.duplicates.map((d, i) => <li key={i}>{d.filename}: {d.reason}</li>)}
                  </ul>
                </div>
              )}
              {result.failed.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <p className="font-semibold text-red-400 text-sm">Failed</p>
                  <ul className="mt-2 list-disc list-inside text-red-400/70 text-xs space-y-0.5">
                    {result.failed.map((f, i) => <li key={i}>{f.filename}: {f.error}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2 rounded-lg transition-colors text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
