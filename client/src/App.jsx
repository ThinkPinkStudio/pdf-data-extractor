import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login    from './pages/Login.jsx';
import Extractor from './pages/Extractor.jsx';
import Batch    from './pages/Batch.jsx';
import History  from './pages/History.jsx';
import Settings from './pages/Settings.jsx';
import Layout   from './components/Layout.jsx';

function RequireAuth({ children }) {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setStatus(d.authenticated ? 'ok' : 'no'))
      .catch(() => setStatus('no'));
  }, []);
  if (status === 'loading') return <div className="loading">Caricamento...</div>;
  if (status === 'no') return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index          element={<Extractor />} />
          <Route path="batch"   element={<Batch />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
