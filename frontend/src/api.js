// ── Admin credentials (stored in sessionStorage, cleared on tab close) ────────

const AUTH_KEY = 'asa_admin_auth'

export function getAdminCredentials() {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function setAdminCredentials(username, password) {
  sessionStorage.setItem(AUTH_KEY, JSON.stringify({ username, password }))
}

export function clearAdminCredentials() {
  sessionStorage.removeItem(AUTH_KEY)
}

function adminAuthHeader() {
  const creds = getAdminCredentials()
  if (!creds) return {}
  return { Authorization: `Basic ${btoa(`${creds.username}:${creds.password}`)}` }
}

/**
 * fetch() wrapper for admin endpoints. Throws an error with status=401
 * when credentials are missing or wrong so callers can redirect to login.
 */
async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...adminAuthHeader(), ...(options.headers || {}) },
  })
  if (res.status === 401) {
    clearAdminCredentials()
    const err = new Error('Authentication required')
    err.status = 401
    throw err
  }
  return res
}

// ── Public settings ───────────────────────────────────────────────────────────

export async function getSettings() {
  const res = await fetch('/api/settings')
  if (!res.ok) return { allow_user_training: true, admin_auth_enabled: false }
  return res.json()
}

// ── Admin API ─────────────────────────────────────────────────────────────────

export async function startRebuildEmbeddings() {
  const res = await adminFetch('/api/admin/rebuild-embeddings', { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Rebuild failed: ${res.status}`)
  }
  return res.json()
}

export async function getRebuildStatus() {
  const res = await adminFetch('/api/admin/rebuild-status')
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`)
  return res.json()
}

export async function exportExamples() {
  const res = await adminFetch('/api/admin/export-examples')
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'asa_training_examples.json'
  a.click()
  URL.revokeObjectURL(url)
}

export async function importExamples(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await adminFetch('/api/admin/import-examples', { method: 'POST', body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Import failed: ${res.status}`)
  }
  return res.json()
}

export async function listCodes() {
  const res = await adminFetch('/api/training/codes')
  if (!res.ok) throw new Error(`Failed to fetch codes: ${res.status}`)
  return res.json()
}

export async function listExamples(code) {
  const res = await adminFetch(`/api/training/codes/${encodeURIComponent(code)}/examples`)
  if (!res.ok) throw new Error(`Failed to fetch examples: ${res.status}`)
  return res.json()
}

export async function deleteExample(id, deleteFile = false) {
  const res = await adminFetch(
    `/api/training/examples/${encodeURIComponent(id)}?delete_file=${deleteFile}`,
    { method: 'DELETE' }
  )
  if (!res.ok) throw new Error(`Failed to delete example: ${res.status}`)
  return res.json()
}

export async function trainBulk(files, asaCode, archive = true) {
  const formData = new FormData()
  for (const file of files) {
    formData.append('files', file)
  }
  formData.append('asa_code', asaCode)
  formData.append('archive', archive ? 'true' : 'false')
  const res = await adminFetch('/api/train/bulk', { method: 'POST', body: formData })
  if (!res.ok) throw new Error(`Bulk train failed: ${res.status}`)
  return res.json()
}

/** Fetches an archived example file with admin auth and opens it as a blob URL. */
export async function openExampleFile(id) {
  const res = await adminFetch(`/api/training/examples/${encodeURIComponent(id)}/file`)
  if (!res.ok) throw new Error(`File not found: ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function trainDocument(file, asaCode, archive = true) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('asa_code', asaCode)
  formData.append('archive', archive ? 'true' : 'false')
  const res = await fetch('/api/train', { method: 'POST', body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Training failed: ${res.status}`)
  }
  return res.json()
}

export async function analyseDocument(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/analyse', { method: 'POST', body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Analysis failed: ${res.status}`)
  }
  return res.json()
}

export async function searchCodes(query) {
  const res = await fetch(`/api/asa-codes?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.json()
}

// ── Jobs (submit / verify / confirm) ─────────────────────────────────────────

export async function submitJob(formData) {
  const res = await fetch('/api/jobs/submit', { method: 'POST', body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Submission failed: ${res.status}`)
  }
  return res.json()
}

export async function getJob(jobId) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Job not found: ${res.status}`)
  }
  return res.json()
}

export function getJobDocumentUrl(jobId) {
  return `/api/jobs/${encodeURIComponent(jobId)}/document`
}

export async function confirmJob(jobId, { confirmedCode, confirmedHierarchy, confirmedDisposal, train = false, trainArchive = true }) {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmed_code: confirmedCode,
      confirmed_hierarchy: confirmedHierarchy,
      confirmed_disposal: confirmedDisposal,
      train,
      train_archive: trainArchive,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Confirm failed: ${res.status}`)
  }
  return res.json()
}

export async function suggestCodes(description) {
  const formData = new FormData()
  formData.append('description', description)
  const res = await fetch('/api/suggest', { method: 'POST', body: formData })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Suggestion failed: ${res.status}`)
  }
  return res.json()
}
