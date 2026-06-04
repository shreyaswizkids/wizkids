import { Link, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'

const LEGACY_PAGES = [
  { path: 'student', label: 'Student', target: '/student.html' },
  { path: 'mentor', label: 'Mentor', target: '/mentor.html' },
  { path: 'sme', label: 'SME', target: '/sme.html' },
  { path: 'start', label: 'Start', target: '/start.html' },
  { path: 'branding', label: 'Branding (Admin)', target: '/admin/school-branding.html' },
]

function LegacyFrame({ target }) {
  return (
    <iframe
      title={`Legacy page ${target}`}
      className="legacy-frame"
      src={target}
      loading="eager"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  )
}

function App() {
  return (
    <div className="migration-shell">
      <header className="migration-header">
        <div>
          <h1>WizKids React Migration</h1>
          <p>
            Existing app remains untouched. This React app wraps the legacy UI while migration
            proceeds screen-by-screen.
          </p>
        </div>
        <nav className="migration-nav">
          {LEGACY_PAGES.map((page) => (
            <Link key={page.path} to={`/${page.path}`} className="migration-link">
              {page.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="migration-main">
        <Routes>
          <Route path="/" element={<Navigate to="/student" replace />} />
          {LEGACY_PAGES.map((page) => (
            <Route key={page.path} path={`/${page.path}`} element={<LegacyFrame target={page.target} />} />
          ))}
        </Routes>
      </main>
    </div>
  )
}

export default App
