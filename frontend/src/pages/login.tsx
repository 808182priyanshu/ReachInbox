const Login = () => {
  const handleGoogleLogin = () => {
    const base = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api";
    window.location.href = `${base}/auth/google`;
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand brand-center"><span className="brand-mark">R</span><span>ReachInbox</span></div>
        <div className="login-copy"><h1>Smart email scheduling</h1><p>Plan campaigns, control sending pace, and track delivery from one workspace.</p></div>
        <button className="google-button" onClick={handleGoogleLogin}><span className="google-icon">G</span>Continue with Google</button>
        <p className="login-note">Secure sign-in with Google OAuth</p>
      </section>
    </main>
  );
};
export default Login;
