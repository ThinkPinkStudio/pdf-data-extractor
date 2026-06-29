import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

export default function Layout() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    navigate('/login');
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="app-logo">📄</span>
          <span className="app-title">PDF Extractor</span>
        </div>
        <nav className="sidebar-nav">
          {[['/', 'Estrai'], ['/batch', 'Batch'], ['/history', 'Cronologia'], ['/settings', 'Impostazioni']]
            .map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'}
                className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
                {label}
              </NavLink>
            ))}
        </nav>
        <button className="logout-btn" onClick={logout} disabled={busy}>
          {busy ? 'Uscita...' : 'Esci'}
        </button>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
