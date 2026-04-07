const { Telegraf } = require('telegraf');
require('dotenv').config();

// 1. TEMEL YAPILANDIRMA
if (!process.env.BOT_TOKEN) {
  console.error('❌ HATA: BOT_TOKEN tanımlanmamış!');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

const rawChannelId = process.env.CHANNEL_ID || '';
const ALLOWED_CHATS = rawChannelId.split(',').map(id => id.trim()).filter(id => id !== '');
const ADMIN_ID = (process.env.ADMIN_ID || '').toString();

// Hafıza (In-memory)
let lastDailyMessageId = null;
let lastGroupMessageId = null;
const whitelist = new Set();

const isAuthorizedChat = (id) => ALLOWED_CHATS.includes(id.toString());

// --- DUYURU MANTIGI ---

const DAILY_MESSAGE = `
💎 <b>MALIBU PRZ SUITE: GÜNLÜK BÜLTEN</b>

<i>"Finansal piyasalarda kurumsal ayak izlerini takip edin. Algoritmik hassasiyet, profesyonel sonuçlar."</i>

⚡️ <b>Hızlı Erişim Linkleri:</b>
Hizmetlerimize ve eğitimlerimize aşağıdaki butonlardan anında ulaşabilirsiniz.
`;

async function sendDailyMessage() {
  const MAIN_CHANNEL = ALLOWED_CHATS[0];
  if (!MAIN_CHANNEL) return console.log('[UYARI] CHANNEL_ID eksik, duyuru atlanıyor.');

  try {
    console.log(`[DUYURU] Gönderiliyor: ${MAIN_CHANNEL}`);
    
    // Eski mesajı silmeyi dene
    if (lastDailyMessageId) {
      try { await bot.telegram.deleteMessage(MAIN_CHANNEL, lastDailyMessageId); } catch (e) {}
    }

    const keyboard = {
      inline_keyboard: [
        [{ text: "💎 Malibu Web Sitesi", url: "https://malibuta.com/" }],
        [{ text: "💼 İndirimli Prop Kayıt", url: "https://checkout.bemfunding.com/?ref=MALIBU" }],
        [{ text: "🎥 YouTube Eğitimleri", url: "https://www.youtube.com/@malibuuuu" }],
        [{ text: "📊 TradingView Profili", url: "https://tr.tradingview.com/u/malibuuu/#published-scripts" }],
        [{ text: "💬 Chat Kanalı", url: "https://t.me/+V8IdRen7SaBiNWFk" }]
      ]
    };

    const sent = await bot.telegram.sendMessage(MAIN_CHANNEL, DAILY_MESSAGE, { 
      parse_mode: 'HTML', 
      reply_markup: keyboard 
    });

    lastDailyMessageId = sent.message_id;

    // Sabitle
    try { await bot.telegram.pinChatMessage(MAIN_CHANNEL, sent.message_id); } catch (e) {}
    
    console.log('[BAŞARI] Günlük mesaj kanala iletildi.');
  } catch (err) {
    console.error('[HATA] Mesaj gönderilemedi:', err.message);
  }
}

function scheduleDailyMessage() {
  const now = new Date();
  const trTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  const targets = [11, 23];
  let nextTarget = null;

  for (const h of targets) {
    let t = new Date(trTime);
    t.setHours(h, 0, 0, 0);
    if (t > trTime) { nextTarget = t; break; }
  }

  if (!nextTarget) {
    nextTarget = new Date(trTime);
    nextTarget.setDate(nextTarget.getDate() + 1);
    nextTarget.setHours(targets[0], 0, 0, 0);
  }

  const delay = nextTarget.getTime() - trTime.getTime();
  console.log(`[BİLGİ] Otomatik duyuru kuruldu: ${nextTarget.toLocaleString('tr-TR')}`);

  setTimeout(() => {
    sendDailyMessage();
    setInterval(sendDailyMessage, 12 * 60 * 60 * 1000);
  }, delay);
}

// --- KOMUTLAR ---

bot.command('test_duyuru', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply(`⛔ Yetkisiz. Sizin ID: ${ctx.from.id}, Beklenen: ${ADMIN_ID}`);
  }
  await sendDailyMessage();
  ctx.reply('✅ Duyuru gönderildi.');
});

bot.command('izinver', (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  const user = (ctx.message.text.split(' ')[1] || '').replace('@', '').toLowerCase();
  if (user) { whitelist.add(user); ctx.reply(`✅ @${user} eklendi.`); }
});

// --- DINLEYICILER ---

bot.on('message', async (ctx) => {
  if (!isAuthorizedChat(ctx.chat.id) && ctx.chat.type !== 'private') return;
  const user = ctx.from;
  if (user.id.toString() !== ADMIN_ID) {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
    if (fullName.includes('malibu')) {
      try { 
        await ctx.banChatMember(user.id);
        console.log(`[BAN] Taklit engellendi: ${fullName}`);
      } catch (e) {}
    }
  }
});

bot.on('chat_member', async (ctx) => {
  if (!isAuthorizedChat(ctx.chat.id)) return;
  const { old_chat_member, new_chat_member } = ctx.update.chat_member;
  if (new_chat_member.status === 'left' && ['member', 'administrator', 'restricted'].includes(old_chat_member.status)) {
    const user = new_chat_member.user;
    if (!whitelist.has((user.username || '').toLowerCase())) {
      try {
        await ctx.banChatMember(user.id);
        if (ctx.chat.id.toString() !== ALLOWED_CHATS[0]) {
          if (lastGroupMessageId) {
             try { await ctx.telegram.deleteMessage(ctx.chat.id, lastGroupMessageId); } catch (e) {}
          }
          const sent = await ctx.reply(`[ ${user.username || user.first_name} ] Ayrıldı, peşinden banladık.`);
          lastGroupMessageId = sent.message_id;
        }
      } catch (e) {}
    }
  }
});

// --- BASLATMA SIRALAMASI ---

console.log('[BAĞLANTI] Telegram ile bağlantı kuruluyor...');

bot.launch({
  allowedUpdates: ['chat_member', 'message']
})
.then(() => {
  console.log('✅ [BAŞLATILDI] Bot aktif ve dinlemede!');
  console.log(`[KONTROL] Admin: ${ADMIN_ID || 'YOK'}, Kanal: ${ALLOWED_CHATS[0] || 'YOK'}`);
  
  // Başarılı açılış sonrası zamanlayıcıları kur
  scheduleDailyMessage();
  
  // İLK AÇILIŞ TESTİ (Anında Gönderim)
  console.log('[BİLGİ] İlk açılış duyurusu gönderiliyor...');
  sendDailyMessage();
})
.catch((err) => {
  console.error('❌ [HATA] Bot başlatılamadı:', err.message);
  if (err.description && err.description.includes('Conflict')) {
    console.error('>> ÖNERİ: Başka bir bot kopyasını kapatın veya token yenileyin.');
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
