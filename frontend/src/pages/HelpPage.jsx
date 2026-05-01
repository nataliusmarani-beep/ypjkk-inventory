export default function HelpPage({ role }) {
  const isAdmin      = role === 'Manager' || role === 'Storekeeper';
  const isManager    = role === 'Manager';
  const isStorekeeper= role === 'Storekeeper';

  const Section = ({ icon, title, children }) => (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
        <span style={{ fontSize:22 }}>{icon}</span>
        <h3 style={{ margin:0, fontSize:16, fontWeight:800, color:'var(--navy)' }}>{title}</h3>
      </div>
      <div style={{ paddingLeft:32 }}>{children}</div>
    </div>
  );

  const Step = ({ n, text }) => (
    <div style={{ display:'flex', gap:12, marginBottom:10, alignItems:'flex-start' }}>
      <div style={{
        minWidth:24, height:24, borderRadius:'50%', background:'var(--blue)',
        color:'white', fontSize:12, fontWeight:800,
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1,
      }}>{n}</div>
      <div style={{ fontSize:13, lineHeight:1.6, color:'var(--text)' }}>{text}</div>
    </div>
  );

  const Note = ({ color = '#eff6ff', border = '#bfdbfe', text = '#1e40af', children }) => (
    <div style={{ background:color, border:`1px solid ${border}`, borderRadius:8, padding:'10px 14px', fontSize:13, color:text, marginTop:10, lineHeight:1.6 }}>
      {children}
    </div>
  );

  const Badge = ({ label, color }) => (
    <span style={{ display:'inline-block', padding:'2px 10px', borderRadius:20, fontSize:11, fontWeight:700, background:color, color:'white', marginRight:6 }}>
      {label}
    </span>
  );

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <div className="page-title">📖 User Guide</div>
          <div className="page-subtitle">How to use the YPJ KK Inventory System</div>
        </div>
      </div>

      {/* ── Role Overview ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ marginBottom:14 }}>👥 User Roles</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12 }}>
          {[
            { role:'Manager',     color:'#2563eb', desc:'Full access. Manages users, approves requests, views reports and backups.' },
            { role:'Storekeeper', color:'#0d9488', desc:'Manages items in assigned store. Reviews and approves/rejects requests.' },
            { role:'Teacher',     color:'#7c3aed', desc:'Submits item requests. Views own request history.' },
            { role:'Other',       color:'#6b7280', desc:'Same as Teacher. Can view inventory and submit requests.' },
          ].map(r => (
            <div key={r.role} style={{ background:'var(--bg)', borderRadius:8, padding:'12px 14px' }}>
              <div style={{ fontWeight:800, fontSize:13, color:r.color, marginBottom:6 }}>{r.role}</div>
              <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.5 }}>{r.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── For Teachers / Others ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ marginBottom:14 }}>
          📋 Making a Request
          <span style={{ marginLeft:8 }}><Badge label="Teacher" color="#7c3aed" /><Badge label="Other" color="#6b7280" /></span>
        </div>

        <Section icon="🛒" title="How to Submit an Item Request">
          <Step n={1} text='Go to "My Requests" in the sidebar.' />
          <Step n={2} text='Click the blue "🛒 New Request" button at the top right.' />
          <Step n={3} text='Browse items or use the search bar to find what you need. Click ℹ️ on any item to see its full description.' />
          <Step n={4} text='Click "+ Add to Cart" on the items you want. Use − and + to adjust quantities.' />
          <Step n={5} text='On the right side, confirm your name and email (auto-filled), select Type (Used-up or Borrow), and fill in the Purpose.' />
          <Step n={6} text='If borrowing, set the Return By date.' />
          <Step n={7} text='Click "📤 Submit" to send your request for approval.' />
          <Note>⏳ You will receive an email and/or Telegram notification once the storekeeper reviews your request.</Note>
        </Section>

        <Section icon="📜" title="Viewing Your Request History">
          <Step n={1} text='Go to "My Requests" — your past requests are listed in the table below.' />
          <Step n={2} text='Each request shows the items, type, status (Pending / Approved / Rejected / Returned), and date.' />
        </Section>

        <Section icon="↩️" title="Returning Borrowed Items">
          <Note color="#f0fdf4" border="#bbf7d0" text="#15803d">
            When a borrowed item is returned to the storeroom, the Storekeeper will mark it as returned in the system. You will see the status change to <strong>Returned</strong> in your request history.
          </Note>
        </Section>
      </div>

      {/* ── For Storekeepers ── */}
      {(isAdmin) && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title" style={{ marginBottom:14 }}>
            ✅ Approvals & Items
            <span style={{ marginLeft:8 }}><Badge label="Storekeeper" color="#0d9488" />{isManager && <Badge label="Manager" color="#2563eb" />}</span>
          </div>

          <Section icon="✅" title="Approving or Rejecting a Request">
            <Step n={1} text='Go to "Approvals" in the sidebar. Pending requests are listed here.' />
            <Step n={2} text='Click "✅ Approve" to approve, or "❌ Reject" to reject a request.' />
            <Step n={3} text='You may add an optional note before confirming.' />
            <Step n={4} text='For requests that need manager review, click "📨 Forward to Manager".' />
            <Note>📦 When a request is approved, the item stock is <strong>automatically deducted</strong>. When a borrowed item is returned, the stock is restored.</Note>
          </Section>

          <Section icon="➕" title="Adding a New Item">
            <Step n={1} text='Click "Add Item" in the sidebar.' />
            <Step n={2} text='Fill in all required fields: Name, Store Category, Category, Location, Unit School, Quantity, Unit, Min Threshold, Condition, and PR/PO Number.' />
            <Step n={3} text='Store Category determines which Category options are available.' />
            <Step n={4} text='Click "💾 Save Item" to add it to inventory.' />
            <Note color="#fffbeb" border="#fde68a" text="#92400e">🔒 Location and Unit School are <strong>locked to your assigned store</strong> if you are a Storekeeper assigned to a specific unit.</Note>
          </Section>

          <Section icon="✏️" title="Editing an Item">
            <Step n={1} text='Go to "Inventory Items" and find the item you want to edit.' />
            <Step n={2} text='Click the ✏️ button on the right side of the row.' />
            <Step n={3} text='Update the fields and click "Save".' />
            <Note color="#fef2f2" border="#fecaca" text="#b91c1c">🔒 You can only edit items that belong to your assigned store location.</Note>
          </Section>

          <Section icon="📂" title="Importing Items via CSV">
            <Step n={1} text='Click "⬇ Template" to download the CSV template.' />
            <Step n={2} text='Fill in the spreadsheet following the column headers.' />
            <Step n={3} text='Click "📂 Import CSV" and select your filled file.' />
            <Note>Maximum 500 rows per import. Items with duplicate names will be skipped.</Note>
          </Section>
        </div>
      )}

      {/* ── For Managers ── */}
      {isManager && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title" style={{ marginBottom:14 }}>
            🔧 Manager Tools
            <span style={{ marginLeft:8 }}><Badge label="Manager" color="#2563eb" /></span>
          </div>

          <Section icon="👥" title="Managing Users">
            <Step n={1} text='Go to "Users" in the sidebar.' />
            <Step n={2} text='Click "+ Add User" to create a new account. Fill in name, email, role, unit school, and a temporary password.' />
            <Step n={3} text='Use the ✏️ button to edit a user or reset their password.' />
            <Step n={4} text='Use "📂 Import CSV" to bulk-create users from a spreadsheet.' />
            <Note color="#fffbeb" border="#fde68a" text="#92400e">⚠️ Storekeeper and Teacher roles cannot be assigned to "All" — they must be assigned to a specific unit (PAUD, SD, or SMP).</Note>
          </Section>

          <Section icon="🗄️" title="Database Backup">
            <Step n={1} text='Go to "Backup" in the sidebar.' />
            <Step n={2} text='Click "⬇️ Download Latest Backup" to create and download a fresh backup file.' />
            <Step n={3} text='The system automatically creates a backup on every restart and every 24 hours, keeping the last 14 backups.' />
          </Section>

          <Section icon="📊" title="Reports & Activity Log">
            <Step n={1} text='"Reports" shows inventory statistics and request summaries.' />
            <Step n={2} text='"Activity Log" records all changes made to items and requests, including who made each change and when.' />
          </Section>
        </div>
      )}

      {/* ── Telegram Setup ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ marginBottom:14 }}>✈️ Setting Up Telegram Notifications</div>
        <Section icon="📱" title="Connect Your Telegram Account">
          <Step n={1} text='Open Telegram and search for @ypjkkinventory_bot.' />
          <Step n={2} text='Tap Start or send /start — the bot will reply with your Chat ID (a number).' />
          <Step n={3} text='In the app, click your avatar (top right) to open My Profile.' />
          <Step n={4} text='Paste the Chat ID into the Telegram Chat ID field and click 💾 Save.' />
          <Note color="#f0fdf4" border="#bbf7d0" text="#15803d">✅ Once connected, you will receive instant Telegram messages for request submissions, approvals, rejections, and low stock alerts.</Note>
        </Section>
      </div>

      {/* ── Tips ── */}
      <div className="card">
        <div className="card-title" style={{ marginBottom:14 }}>💡 Quick Tips</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[
            'Use the 🔍 search bar on the Inventory page to quickly find items by name or code.',
            'Click ℹ️ on any item card in the request browser to see full details before adding to cart.',
            'Low stock items are highlighted in amber ⚠️, out-of-stock items in red.',
            'Borrowed items must be returned physically to the storeroom — the storekeeper will then mark them as returned in the system.',
            'If you forget your password, ask your Manager to reset it from the Users page.',
          ].map((tip, i) => (
            <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start', fontSize:13, color:'var(--text)', lineHeight:1.6 }}>
              <span style={{ color:'var(--blue)', fontWeight:800, flexShrink:0 }}>→</span>
              <span>{tip}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
