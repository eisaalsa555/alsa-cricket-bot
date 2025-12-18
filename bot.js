// ==========================================
// Telegram Cricket Bot - Node.js Version
// ==========================================
// 
// INSTALLATION:
// 1. npm init -y
// 2. npm install node-telegram-bot-api @supabase/supabase-js
// 3. Update the SUPABASE CONFIG section below
// 4. node bot.js
//
// DEPLOYMENT (24/7):
// - Railway: railway.app
// - Render: render.com
// - Any VPS with Node.js
//
// NOTE: Bot Token, Admin ID, and Groups are fetched from
// the Settings page - no need to hardcode them here!
// ==========================================

const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// ================= SUPABASE CONFIG ===================
// Get these from your Lovable Cloud dashboard
const SUPABASE_URL = 'https://oosqevyslkfsiqrkqigf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vc3FldnlzbGtmc2lxcmtxaWdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNTU5NDEsImV4cCI6MjA4MTYzMTk0MX0.JAsXZBxISc-luB20BChf5XjxzODs2BYCLdH-Z4vyKRg';
// =====================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let bot = null;
let BOT_TOKEN = '';
let ADMIN_ID = 0;
let GROUP_IDS = [];

// Initialize bot with settings from database
async function initBot() {
  console.log('🔄 Loading settings from database...');
  
  const { data: settings, error } = await supabase
    .from('bot_settings')
    .select('*')
    .limit(1)
    .single();
  
  if (error || !settings?.bot_token) {
    console.error('❌ Error: Please configure bot settings in the dashboard first!');
    console.error('Go to Settings page and add your Bot Token, Admin ID, and Groups.');
    process.exit(1);
  }
  
  BOT_TOKEN = settings.bot_token;
  ADMIN_ID = settings.admin_telegram_id || 0;
  GROUP_IDS = settings.group_ids || [];
  
  console.log('✅ Settings loaded!');
  console.log('   Admin ID:', ADMIN_ID);
  console.log('   Groups:', GROUP_IDS.length);
  
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  setupHandlers();
  console.log('🤖 Bot is running...');
}

// Check if user joined all groups
async function isJoinedAll(userId) {
  if (GROUP_IDS.length === 0) return true;
  
  try {
    for (const groupId of GROUP_IDS) {
      const member = await bot.getChatMember(groupId, userId);
      if (['left', 'kicked'].includes(member.status)) {
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error('Error checking membership:', error.message);
    return false;
  }
}

// Save user to database
async function saveUser(user) {
  const { error } = await supabase
    .from('bot_users')
    .upsert({
      telegram_id: user.id,
      username: user.username || null,
      first_name: user.first_name || null,
      verified: false
    }, { onConflict: 'telegram_id' });
  
  if (error) console.error('Error saving user:', error.message);
}

function setupHandlers() {
  // /start command
  bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    
    // Check if user already exists and is verified
    const { data: existingUser } = await supabase
      .from('bot_users')
      .select('verified')
      .eq('telegram_id', userId)
      .maybeSingle();
    
    if (existingUser?.verified) {
      // Already verified member
      bot.sendMessage(userId, 
        '✅ <b>You Are Already A Member Of Our Alsa-Cricket Family!</b>\n\n' +
        'Please use /list command to watch your favorite matches. 🏏',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    // Save new user
    await saveUser(msg.from);

    // Show join groups message
    const keyboard = {
      inline_keyboard: [
        ...GROUP_IDS.map(group => ([{
          text: `Join ${group}`,
          url: `https://t.me/${group.replace('@', '')}`
        }])),
        [{ text: '✅ Verify', callback_data: 'verify_user' }]
      ]
    };

    bot.sendMessage(userId, 
      '❌ <b>Please join all these groups first:</b>\n\n' +
      'After joining all groups, click the ✅ Verify button below.',
      { reply_markup: keyboard, parse_mode: 'HTML' }
    );
  });

// Verify callback
bot.on('callback_query', async (query) => {
  if (query.data !== 'verify_user') return;
  
  const userId = query.from.id;
  
  if (await isJoinedAll(userId)) {
    await supabase
      .from('bot_users')
      .update({ verified: true })
      .eq('telegram_id', userId);
    
    bot.answerCallbackQuery(query.id, { text: '✅ You are verified!' });
    bot.sendMessage(userId, '🎉 You are now verified! Use /list to see matches.');
  } else {
    bot.answerCallbackQuery(query.id, { text: '❌ You haven\'t joined all groups yet!' });
    bot.sendMessage(userId, 'Please join all groups first before verifying.');
  }
});

// /list command
bot.onText(/\/list/, async (msg) => {
  const userId = msg.from.id;
  
  // Check if verified
  const { data: user } = await supabase
    .from('bot_users')
    .select('verified')
    .eq('telegram_id', userId)
    .single();
  
  if (!user?.verified) {
    return bot.sendMessage(msg.chat.id, '❌ You need to verify yourself first using the ✅ button.');
  }
  
  // Get matches
  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .eq('is_active', true);
  
  if (!matches?.length) {
    return bot.sendMessage(msg.chat.id, 'No matches available right now.');
  }
  
  let text = '<b>📌 Available Cricket Matches:</b>\n';
  for (const match of matches) {
    text += `\n<b>${escapeHtml(match.match_name)}</b>\n<a href="${escapeHtml(match.watch_link)}">Watch Here</a>\n`;
  }
  
  bot.sendMessage(msg.chat.id, text, { 
    parse_mode: 'HTML',
    disable_web_page_preview: true 
  });
});

// /stat command (admin only)
bot.onText(/\/stat/, async (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  
  const { data: users } = await supabase.from('bot_users').select('verified');
  const total = users?.length || 0;
  const verified = users?.filter(u => u.verified).length || 0;
  
  bot.sendMessage(ADMIN_ID, `Total users: ${total}\nVerified: ${verified}`);
});

// /send command (admin broadcast)
bot.onText(/\/send (.+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  
  const message = match[1];
  const { data: users } = await supabase.from('bot_users').select('telegram_id');
  
  let sent = 0;
  for (const user of users || []) {
    try {
      await bot.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
      sent++;
    } catch (error) {
      console.error(`Failed to send to ${user.telegram_id}`);
    }
  }
  
  // Log broadcast
  await supabase.from('broadcasts').insert({
    message,
    sent_to_count: sent
  });
  
  bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${sent} users!`);
});

// /edit command (update matches)
bot.onText(/\/edit ([\s\S]+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  
  const text = match[1].trim();
  const lines = text.split('\n');
  
  // Clear existing matches
  await supabase.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  // Add new matches
  for (const line of lines) {
    if (line.includes('-')) {
      const [name, link] = line.split('-').map(s => s.trim());
      if (name && link) {
        await supabase.from('matches').insert({
          match_name: name,
          watch_link: link
        });
      }
    }
  }
  
  bot.sendMessage(msg.chat.id, '✅ Match list updated!');
});

// Helper: escape HTML
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

}

// Start the bot
initBot().catch(console.error);
