const express = require('express');
const { sendTelegram } = require('../telegram');

const router = express.Router();

// POST /api/telegram/webhook — Telegram sends updates here
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // always ack immediately

  try {
    const msg = req.body?.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    const text   = msg.text?.trim();

    if (text === '/start' || text?.startsWith('/start')) {
      await sendTelegram(chatId,
        `👋 <b>Welcome to YPJ KK Inventory Bot!</b>\n\n` +
        `Your Telegram Chat ID is:\n<code>${chatId}</code>\n\n` +
        `📋 Copy that number and paste it in your profile on the inventory app to receive notifications.\n\n` +
        `<i>Go to: kkinventory.ypj.sch.id → click your name → My Profile → Telegram Chat ID</i>`
      );
    }
  } catch (e) {
    console.error('[telegram] webhook handler error:', e.message);
  }
});

module.exports = router;
