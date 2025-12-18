const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');

// ================= SUPABASE CONFIG ===================
const SUPABASE_URL = 'https://oosqevyslkfsiqrkqigf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vc3FldnlzbGtmc2lxcmtxaWdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNTU5NDEsImV4cCI6MjA4MTYzMTk0MX0.JAsXZBxISc-luB20BChf5XjxzODs2BYCLdH-Z4vyKRg'; // env me rakhna best
// =====================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(bodyParser.json());

let bot;
let BOT_TOKEN = '';
let ADMIN_ID = 0;
let GROUP_IDS = [];

// ================= INIT BOT ===================
async function initBot() {
  console.log('🔄 Loading settings from database...');

  const { data: settings, error } = await supabase
    .from('bot_settings')
    .select('*')
    .limit(1)
    .single();

  if (error || !settings?.bot_token) {
    console.error('❌ Bot token missing in DB');
    process.exit(1);
  }

  BOT_TOKEN = settings.bot_token;
  ADMIN_ID = settings.admin_telegram_id || 0;
  GROUP_IDS = settings.group_ids || [];

  bot = new TelegramBot(BOT_TOKEN);
  setupHandlers();

  // 🔥 WEBHOOK SET
  const URL = process.env.RENDER_EXTERNAL_URL;
  await bot.setWebHook(`${URL}/bot${BOT_TOKEN}`);

  console.log('✅ Webhook set');
}

// ================= WEBHOOK ENDPOINT ===================
app.post(`/bot${process.env.BOT_TOKEN || ''}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================= PORT (MANDATORY) ===================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ================= HANDLERS ===================
function setupHandlers() {

  bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;

    const { data: existingUser } = await supabase
      .from('bot_users')
      .select('verified')
      .eq('telegram_id', userId)
      .maybeSingle();

    if (existingUser?.verified) {
      return bot.sendMessage(
        userId,
        '✅ You are already verified!',
        { parse_mode: 'HTML' }
      );
    }

    await saveUser(msg.from);

    const keyboard = {
      inline_keyboard: [
        ...GROUP_IDS.map(group => ([{
          text: `Join ${group}`,
          url: `https://t.me/${group.replace('@', '')}`
        }])),
        [{ text: '✅ Verify', callback_data: 'verify_user' }]
      ]
    };

    bot.sendMessage(
      userId,
      '❌ Join all groups first, then verify.',
      { reply_markup: keyboard, parse_mode: 'HTML' }
    );
  });

  bot.on('callback_query', async (query) => {
    if (query.data !== 'verify_user') return;

    const userId = query.from.id;

    if (await isJoinedAll(userId)) {
      await supabase
        .from('bot_users')
        .update({ verified: true })
        .eq('telegram_id', userId);

      bot.answerCallbackQuery(query.id, { text: '✅ Verified!' });
      bot.sendMessage(userId, '🎉 You are verified!');
    } else {
      bot.answerCallbackQuery(query.id, { text: '❌ Join all groups first!' });
    }
  });
}

// ================= HELPERS ===================
async function isJoinedAll(userId) {
  for (const groupId of GROUP_IDS) {
    const member = await bot.getChatMember(groupId, userId);
    if (['left', 'kicked'].includes(member.status)) return false;
  }
  return true;
}

async function saveUser(user) {
  await supabase.from('bot_users').upsert({
    telegram_id: user.id,
    username: user.username || null,
    first_name: user.first_name || null,
    verified: false
  }, { onConflict: 'telegram_id' });
}

// ================= START ===================
initBot().catch(console.error);
