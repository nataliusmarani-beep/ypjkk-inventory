const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BASE   = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

// Send a single Telegram message (fire-and-forget)
async function sendTelegram(chatId, text) {
  if (!BASE || !chatId) return;
  try {
    await fetch(`${BASE}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('[telegram] send error:', e.message);
  }
}

// Send to multiple chat IDs in parallel
async function sendTelegramToMany(chatIds, text) {
  if (!BASE || !chatIds?.length) return;
  await Promise.all(chatIds.map(id => sendTelegram(id, text)));
}

// Register webhook with Telegram so /start commands are received
async function registerWebhook(baseUrl) {
  if (!BASE || !baseUrl) return;
  try {
    const url  = `${baseUrl}/api/telegram/webhook`;
    const res  = await fetch(`${BASE}/setWebhook`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url }),
    });
    const data = await res.json();
    console.log('[telegram] webhook:', data.description);
  } catch (e) {
    console.error('[telegram] webhook registration error:', e.message);
  }
}

module.exports = { sendTelegram, sendTelegramToMany, registerWebhook };
