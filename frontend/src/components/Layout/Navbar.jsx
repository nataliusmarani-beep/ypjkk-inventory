import { NavLink } from 'react-router-dom';

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">School Inventory</div>
      <div className="navbar-links">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'active' : ''}>
          Inventory
        </NavLink>
        <NavLink to="/transactions" className={({ isActive }) => isActive ? 'active' : ''}>
          Transactions
        </NavLink>
      </div>
    </nav>
  );
}
