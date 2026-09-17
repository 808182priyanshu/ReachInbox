import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/login";
import Dashboard from "./pages/Dashboard";
import { api } from "./services/api";
import type { User } from "./types";
import "./App.css";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get("/auth/me").then((response) => { if (response.data.success) setUser(response.data.data); }).catch(() => setUser(null)).finally(() => setLoading(false)); }, []);
  const handleLogout = async () => { try { await api.post("/auth/logout"); } finally { setUser(null); } };
  if (loading) return <div className="page-loading"><div className="spinner" /> Loading workspace…</div>;
  return <BrowserRouter><Routes><Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Login />} /><Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} /><Route path="/dashboard" element={user ? <Dashboard user={user} onLogout={handleLogout} /> : <Navigate to="/" replace />} /><Route path="*" element={<Navigate to={user ? "/dashboard" : "/"} replace />} /></Routes></BrowserRouter>;
}
export default App;
