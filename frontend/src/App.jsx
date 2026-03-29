import { Routes, Route, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard.jsx'
import CodeDetail from './pages/CodeDetail.jsx'
import UserPortal from './pages/UserPortal.jsx'
import HelpPage from './pages/HelpPage.jsx'
import VerifyPage from './pages/VerifyPage.jsx'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Routes>
        <Route path="/" element={<UserPortal />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/verify/:jobId" element={<VerifyPage />} />
        <Route path="/admin" element={<Dashboard />} />
        <Route path="/admin/codes/:code" element={<CodeDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
