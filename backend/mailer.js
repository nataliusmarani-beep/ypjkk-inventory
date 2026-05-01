require('dotenv').config();

// ── Resend HTTP API (replaces nodemailer SMTP to avoid Railway IPv6 issues) ──
// Docs: https://resend.com/docs/api-reference/emails/send-email
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_NAME      = 'YPJ KK Storekeeper';
const FROM_DOMAIN    = process.env.MAIL_FROM_DOMAIN || 'ypj.sch.id';   // your verified Resend domain
const FROM           = `"${FROM_NAME}" <noreply@${FROM_DOMAIN}>`;

async function send({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.warn('[mailer] RESEND_API_KEY not set — skipping email to', to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
const table = (rows) => `
  <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
    ${rows.map(([k, v]) => `
      <tr>
        <td style="padding:6px 20px 6px 0;color:#64748b;font-weight:600;white-space:nowrap">${k}</td>
        <td style="font-weight:700">${v}</td>
      </tr>`).join('')}
  </table>`;

const itemList = (items) => `
  <table style="border-collapse:collapse;margin:16px 0;font-size:14px;width:100%">
    <thead>
      <tr style="background:#f1f5f9">
        <th style="padding:8px 12px;text-align:left;color:#475569;font-size:12px">Item</th>
        <th style="padding:8px 12px;text-align:right;color:#475569;font-size:12px">Qty</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(i => `
        <tr style="border-bottom:1px solid #e2e8f0">
          <td style="padding:8px 12px;font-weight:600">${i.item_name}</td>
          <td style="padding:8px 12px;text-align:right">${i.quantity} ${i.unit_name || ''}</td>
        </tr>`).join('')}
    </tbody>
  </table>`;

const wrap = (body) => `
  <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;background:#f8fafc">
    <div style="background:#1a2f5e;padding:16px 24px;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:12px">
      <div style="color:white;font-size:18px;font-weight:800">📦 YPJ KK Inventory</div>
    </div>
    <div style="background:white;padding:28px 24px;border-radius:0 0 10px 10px;border:1px solid #e2e8f0;border-top:none">
      ${body}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
      <p style="color:#94a3b8;font-size:12px;margin:0">
        Yayasan Pendidikan Jayawijaya — Kuala Kencana Campus<br>
        This is an automated message. Please do not reply directly.
      </p>
    </div>
  </div>`;

// ── 1. Request Submitted ───────────────────────────────────────────────────
async function sendRequestSubmitted({ requesterName, requesterEmail, items, type, purpose, returnDate, groupId }) {
  if (!requesterEmail) return;
  const typeLabel = type === 'borrow' ? 'Borrow (must be returned)' : 'Used-up';
  const totalQty  = items.reduce((s, i) => s + i.quantity, 0);

  await send({
    to: requesterEmail,
    subject: `[YPJ KK Inventory] Your request has been submitted for approval`,
    html: wrap(`
      <p>Dear <strong>${requesterName}</strong>,</p>
      <p>Your item request has been <strong style="color:#2563eb">successfully submitted</strong> and is now awaiting approval from the storekeeper.</p>

      ${table([
        ['Request ID', groupId || '—'],
        ['Type',       typeLabel],
        ['Total Items', `${items.length} item(s) — ${totalQty} unit(s)`],
        ...(purpose    ? [['Purpose',     purpose]]     : []),
        ...(returnDate ? [['Return By',   returnDate]]  : []),
      ])}

      ${itemList(items)}

      <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:4px;font-size:13px;color:#1e40af">
        ⏳ You will receive another email once the storekeeper has reviewed your request.
      </div>
    `),
  }).catch(e => console.error('Submission email failed:', e.message));
}

// ── 2. Request Approved ────────────────────────────────────────────────────
async function sendRequestApproved({ requesterName, requesterEmail, itemName, quantity, type, returnDate, approvalNotes }) {
  if (!requesterEmail) return;
  await send({
    to: requesterEmail,
    subject: `[YPJ KK Inventory] Your request has been approved ✅`,
    html: wrap(`
      <p>Dear <strong>${requesterName}</strong>,</p>
      <p>Your item request has been <strong style="color:#16a34a">approved</strong>.</p>
      ${table([
        ['Item',     itemName],
        ['Quantity', String(quantity)],
        ['Type',     type === 'borrow' ? 'Borrow (must be returned)' : 'Used-up'],
        ...(returnDate    ? [['Return By', returnDate]]       : []),
        ...(approvalNotes ? [['Note',      approvalNotes]]    : []),
      ])}
      <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:4px;font-size:13px;color:#15803d">
        ✅ Please collect your item from the storeroom.${type === 'borrow' ? ' Remember to return it by the due date.' : ''}
      </div>
    `),
  }).catch(e => console.error('Approval email failed:', e.message));
}

// ── 3. Request Rejected ────────────────────────────────────────────────────
async function sendRequestRejected({ requesterName, requesterEmail, itemName, quantity, notes }) {
  if (!requesterEmail) return;
  await send({
    to: requesterEmail,
    subject: `[YPJ KK Inventory] Your request was not approved`,
    html: wrap(`
      <p>Dear <strong>${requesterName}</strong>,</p>
      <p>Unfortunately your item request has been <strong style="color:#dc2626">rejected</strong>.</p>
      ${table([
        ['Item',     itemName],
        ['Quantity', String(quantity)],
        ...(notes ? [['Reason', notes]] : []),
      ])}
      <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:4px;font-size:13px;color:#b91c1c">
        ❌ Please contact the storekeeper or submit a new request if needed.
      </div>
    `),
  }).catch(e => console.error('Rejection email failed:', e.message));
}

// ── 4. Low Stock Alert ─────────────────────────────────────────────────────
async function sendLowStockAlert({ itemName, itemCode, category, location, quantity, minThreshold, unitName, recipients }) {
  if (!recipients || recipients.length === 0) return;

  const isOut = quantity === 0;
  const statusLabel = isOut ? 'OUT OF STOCK' : 'LOW STOCK';
  const statusColor = isOut ? '#dc2626' : '#d97706';
  const statusBg    = isOut ? '#fef2f2'  : '#fffbeb';
  const statusBorder= isOut ? '#dc2626'  : '#d97706';

  const html = wrap(`
    <div style="background:${statusBg};border-left:4px solid ${statusBorder};padding:12px 16px;border-radius:4px;margin-bottom:20px">
      <strong style="color:${statusColor}">⚠️ ${statusLabel}</strong>
      <span style="color:${statusColor};font-size:13px;margin-left:8px">
        ${isOut ? 'This item is completely out of stock.' : `Stock has dropped below the minimum threshold of ${minThreshold} ${unitName}.`}
      </span>
    </div>

    ${table([
      ['Item',         itemName],
      ...(itemCode ? [['Code', itemCode]] : []),
      ['Category',     category || '—'],
      ['Location',     location || '—'],
      ['Current Stock',`<strong style="color:${statusColor}">${quantity} ${unitName}</strong>`],
      ['Min Threshold',`${minThreshold} ${unitName}`],
    ])}

    <p style="font-size:13px;color:#475569">Please restock this item as soon as possible to avoid disruption.</p>
  `);

  await Promise.all(
    recipients.map(r => send({
      to:      r.email,
      subject: `[YPJ KK Inventory] ⚠️ ${statusLabel}: ${itemName} (${quantity} ${unitName} remaining)`,
      html,
    }).catch(e => console.error(`Low-stock alert to ${r.email} failed:`, e.message)))
  );
}

// ── 5. New Request Alert (to relevant Storekeepers + Managers) ────────────
async function sendNewRequestAlert({ requesterName, requesterUnit, items, type, purpose, groupId, recipients }) {
  if (!recipients || recipients.length === 0) return;
  const typeLabel  = type === 'borrow' ? 'Borrow (must be returned)' : 'Used-up';
  const totalQty   = items.reduce((s, i) => s + i.quantity, 0);
  const html = wrap(`
    <p>Dear Storekeeper / Manager,</p>
    <p>A new item request has been <strong style="color:#2563eb">submitted and is awaiting your approval</strong>.</p>

    ${table([
      ['Request ID',   groupId || '—'],
      ['From',         requesterName],
      ['Unit / School',requesterUnit || '—'],
      ['Type',         typeLabel],
      ['Total Items',  `${items.length} item(s) — ${totalQty} unit(s)`],
      ...(purpose ? [['Purpose', purpose]] : []),
    ])}

    ${itemList(items)}

    <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:4px;font-size:13px;color:#1e40af">
      👉 Please log in to the inventory system to review and approve or reject this request.
    </div>
  `);
  await Promise.all(
    recipients.map(r => send({
      to:      r.email,
      subject: `[YPJ KK Inventory] 🔔 New Request Pending Approval — from ${requesterName}`,
      html,
    }).catch(e => console.error(`New-request alert to ${r.email} failed:`, e.message)))
  );
}

// ── 6. Request Forwarded ───────────────────────────────────────────────────
async function sendRequestForwarded({ storekeepName, requesterName, items, purpose, forwardedNote, recipients }) {
  if (!recipients || recipients.length === 0) return;
  const itemList2 = items.map(i => `${i.item_name} × ${i.quantity} ${i.unit_name || ''}`).join(', ');
  const html = wrap(`
    <p>Dear Manager,</p>
    <p>A request has been <strong style="color:#7c3aed">forwarded to you</strong> for approval by the storekeeper.</p>
    ${table([
      ['Forwarded By', storekeepName || 'Storekeeper'],
      ['Requester',    requesterName],
      ['Items',        itemList2],
      ...(purpose       ? [['Purpose',        purpose]]       : []),
      ...(forwardedNote ? [['Storekeeper Note', forwardedNote]] : []),
    ])}
    <div style="background:#f5f3ff;border-left:4px solid #7c3aed;padding:12px 16px;border-radius:4px;font-size:13px;color:#6d28d9">
      📨 Please log in to the inventory system to review and approve or reject this request.
    </div>
  `);
  await Promise.all(
    recipients.map(r => send({
      to:      r.email,
      subject: `[YPJ KK Inventory] 📨 Request forwarded for your approval`,
      html,
    }).catch(e => console.error(`Forward email to ${r.email} failed:`, e.message)))
  );
}

// ── 7. Checkout / Checkin stubs ────────────────────────────────────────────
async function sendCheckoutConfirmation() {}
async function sendCheckinConfirmation()  {}

// ── 8. Principal: new request submitted (CC) ───────────────────────────────
async function sendPrincipalSubmissionNotice({ requesterName, requesterUnit, items, type, purpose, groupId, recipients }) {
  if (!recipients || recipients.length === 0) return;
  const typeLabel = type === 'borrow' ? 'Borrow (must be returned)' : 'Used-up';
  const totalQty  = items.reduce((s, i) => s + i.quantity, 0);

  const html = wrap(`
    <p>Dear Principal,</p>
    <p>This is to inform you that a new item request has been <strong style="color:#2563eb">submitted</strong> and is pending storekeeper approval.</p>

    ${table([
      ['Request ID',   groupId || '—'],
      ['From',         requesterName],
      ['Unit / School',requesterUnit || '—'],
      ['Type',         typeLabel],
      ['Total Items',  `${items.length} item(s) — ${totalQty} unit(s)`],
      ...(purpose ? [['Purpose', purpose]] : []),
    ])}

    ${itemList(items)}

    <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:4px;font-size:13px;color:#1e40af">
      📋 This is an informational copy. The storekeeper will review and approve or reject this request.
    </div>
  `);

  await Promise.all(
    recipients.map(r => send({
      to:      r.email,
      subject: `[YPJ KK Inventory] 📋 Request Submitted — ${requesterName} (${requesterUnit || '—'})`,
      html,
    }).catch(e => console.error(`Principal submission notice to ${r.email} failed:`, e.message)))
  );
}

// ── 9. Principal: request approved or rejected (CC) ───────────────────────
async function sendPrincipalDecisionNotice({ requesterName, requesterUnit, items, type, status, notes, groupId, recipients }) {
  if (!recipients || recipients.length === 0) return;

  const isApproved   = status === 'approved';
  const statusLabel  = isApproved ? 'APPROVED' : 'REJECTED';
  const statusColor  = isApproved ? '#16a34a' : '#dc2626';
  const statusBg     = isApproved ? '#f0fdf4'  : '#fef2f2';
  const statusBorder = isApproved ? '#86efac'  : '#fecaca';
  const statusIcon   = isApproved ? '✅' : '❌';
  const typeLabel    = type === 'borrow' ? 'Borrow (must be returned)' : 'Used-up';

  const html = wrap(`
    <p>Dear Principal,</p>
    <p>A request from <strong>${requesterName}</strong> (${requesterUnit || '—'}) has been
       <strong style="color:${statusColor}">${statusLabel}</strong>.</p>

    ${table([
      ['Request ID',   groupId || '—'],
      ['From',         requesterName],
      ['Unit / School',requesterUnit || '—'],
      ['Type',         typeLabel],
      ...(notes ? [[isApproved ? 'Approval Note' : 'Reason', notes]] : []),
    ])}

    ${itemList(items)}

    <div style="background:${statusBg};border-left:4px solid ${statusBorder};padding:12px 16px;border-radius:4px;font-size:13px;color:${statusColor}">
      ${statusIcon} This is an automated informational copy for your records.
    </div>
  `);

  await Promise.all(
    recipients.map(r => send({
      to:      r.email,
      subject: `[YPJ KK Inventory] ${statusIcon} Request ${statusLabel} — ${requesterName}`,
      html,
    }).catch(e => console.error(`Principal decision notice to ${r.email} failed:`, e.message)))
  );
}

module.exports = {
  sendNewRequestAlert,
  sendRequestSubmitted,
  sendRequestApproved,
  sendRequestRejected,
  sendLowStockAlert,
  sendRequestForwarded,
  sendPrincipalSubmissionNotice,
  sendPrincipalDecisionNotice,
  sendCheckoutConfirmation,
  sendCheckinConfirmation,
};
