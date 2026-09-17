import { useState } from "react";
import type { User } from "../types";

interface HeaderProps { user: User; onLogout: () => void }

const Header = ({ user, onLogout }: HeaderProps) => {
  const [avatarFailed, setAvatarFailed] = useState(false);
  const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <header className="header">
      <div className="brand"><span className="brand-mark">R</span><span>ReachInbox</span></div>
      <div className="user-section">
        {user.avatarUrl && !avatarFailed ? <img src={user.avatarUrl} alt="" className="avatar" onError={() => setAvatarFailed(true)} /> : <div className="avatar avatar-fallback">{initials || "R"}</div>}
        <div className="user-info"><strong>{user.name}</strong><span>{user.email}</span></div>
        <button className="secondary-button" onClick={onLogout}>Logout</button>
      </div>
    </header>
  );
};
export default Header;
