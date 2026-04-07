const { Telegraf } = require('telegraf');
require('dotenv').config();

// 1. GÜVENLİK VE YAPILANDIRMA
if (!process.env.BOT_TOKEN) {
  console.error('❌ KRİTİK HATA: BOT_TOKEN bulunamadı. Lütfen ortam değişkenlerini ayarlayın.');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

const rawChannelId = process.env.CHANNEL_ID || '';
const ALLOWED_CHATS = rawChannelId.split(',')
  .map(id => id.trim())
  .filter(id => id !== '');

const ADMIN_ID = (process.env.ADMIN_ID || '').toString();

// In-memory state (Hafıza Yönetimi)
const whitelist = new Set();
let lastGroupMessageId = null;
let lastDailyMessageId = null;

// Yardımcı fonksiyon: Chat ID yetkili mi?
function isAuthorizedChat(chatId) {
  return ALLOWED_CHATS.includes(chatId.toString());
}

// --- DUYURU MESAJI TASARIMI ---
const DAILY_MESSAGE = `
💎 <b>MALIBU PRZ SUITE: GÜNLÜK BÜLTEN</b>

<i>"Finansal piyasalarda kurumsal ayak izlerini takip edin. Algoritmik hassasiyet, profesyonel sonuçlar."</i>

⚡️ <b>Hızlı Erişim Linkleri:</b>
Hizmetlerimize ve eğitimlerimize aşağıdaki butonlardan anında ulaşabilirsiniz.
`;

async function sendDailyMessage() {
  const MAIN_CHANNEL = ALLOWED_CHATS[0];
  if (!MAIN_CHANNEL) {
    console.warn('[UYARI] CHANNEL_ID tanımlı olmadığı için duyuru atlandı.');
    return;
  }

  try {
    console.log(`[İŞLEM] Duyuru mesajı iletiliyor: ${MAIN_CHANNEL}`);
    
    // ESKİ MESAJI SİL (Hata korumalı)
    if (lastDailyMessageId) {
      try {
        await bot.telegram.deleteMessage(MAIN_CHANNEL, lastDailyMessageId);
        console.log('[BİLGİ] Eski mesaj temizlendi.');
      } catch (e) {
        console.log('[BİLGİ] Eski mesaj silinemedi (zaten yok veya çok eski).');
      }
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

    const sentMsg = await bot.telegram.sendMessage(MAIN_CHANNEL, DAILY_MESSAGE, { 
      parse_mode: 'HTML',
      reply_markup: keyboard
    });

    lastDailyMessageId = sentMsg.message_id;

    // Otomatik Sabitleme (Pin)
    try {
      await bot.telegram.pinChatMessage(MAIN_CHANNEL, sentMsg.message_id, { disable_notification: false });
      console.log('[BİLGİ] Duyuru sabitlendi.');
    } catch (e) {
      console.warn('[BİLGİ] Sabitleme yapılamadı (Bot yetkisi veya başka bir sorun).');
    }

    console.log('[BAŞARI] Günlük mesaj kanala iletildi.');
  } catch (error) {
    console.error('[HATA] Mesaj gönderilirken sorun çıktı:', error.message);
  }
}

// --- ZAMANLAYICI (SCHEDULER) ---
function scheduleDailyMessage() {
  try {
    const now = new Date();
    const trTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
    const targets = [11, 23];
    let nextTarget = null;

    for (const hour of targets) {
      let t = new Date(trTime);
      t.setHours(hour, 0, 0, 0);
      if (t > trTime) { nextTarget = t; break; }
    }

    if (!nextTarget) {
      nextTarget = new Date(trTime);
      nextTarget.setDate(nextTarget.getDate() + 1);
      nextTarget.setHours(targets[0], 0, 0, 0);
    }

    const delay = nextTarget.getTime() - trTime.getTime();
    console.log(`[BİLGİ] Zamanlayıcı aktif: Bir sonraki mesaj ${nextTarget.toLocaleString('tr-TR')}`);

    setTimeout(() => {
      sendDailyMessage();
      setInterval(sendDailyMessage, 12 * 60 * 60 * 1000);
    }, delay);
  } catch (err) {
    console.error('[HATA] Zamanlayıcı başlatılamadı:', err.message);
  }
}

// --- KOMUTLAR VE DİNLEYİCİLER ---

bot.command('test_duyuru', async (ctx) => {
  const senderId = (ctx.from.id || '').toString();
  if (senderId !== ADMIN_ID) {
    return ctx.reply(`⛔ Yetkisiz. Sizin ID: ${senderId}\nBeklenen: ${ADMIN_ID || 'YOK'}`);
  }
  await sendDailyMessage();
  ctx.reply('✅ Test duyurusu gönderildi.');
});

bot.command('izinver', (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  const target = (ctx.message.text.split(' ')[1] || '').replace('@', '').toLowerCase();
  if (target) { whitelist.add(target); ctx.reply(`✅ @${target} eklendi.`); }
});

bot.on('message', async (ctx) => {
  if (!isAuthorizedChat(ctx.chat.id) && ctx.chat.type !== 'private') return;
  const user = ctx.from;
  if (user.id.toString() !== ADMIN_ID) {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
    if (fullName.includes('malibu')) {
      try {
        await ctx.banChatMember(user.id);
        console.log(`[TAKLİT] Engellendi: ${fullName}`);
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

// --- BAŞLATMA SIRALAMASI ---

scheduleDailyMessage();

console.log('[BAĞLANTI] Telegram ile bağlantı kuruluyor...');

// dropPendingUpdates: bot açılırken eski mesaj birikmesini temizler
bot.launch({
  allowedUpdates: ['chat_member', 'message'],
  dropPendingUpdates: true
})
.then(() => {
  console.log('✅ [BAŞLATILDI] Bot başarıyla hazır ve dinlemede!');
  console.log(`[KONTROL] Admin: ${ADMIN_ID || 'YOK'}, Kanal: ${ALLOWED_CHATS[0] || 'YOK'}`);
  
  // İlk açılış testi (Hemen Gönderim)
  console.log('[İŞLEM] İlk açılış testi gönderiliyor...');
  sendDailyMessage();
})
.catch((err) => {
  if (err.description && err.description.includes('Conflict')) {
    console.error('🚨 ÇAKIŞMA HATASI (409): Bot başka bir sunucuda çalışıyor! Lütfen yeni TOKEN girdiğinizden ve diğer kopyaları kapattığınızdan emin olun.');
  } else {
    console.error('❌ BAŞLATMA HATASI:', err.message);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
