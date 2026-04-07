const { Telegraf } = require('telegraf');
require('dotenv').config();

// 1. GÜVENLİK DUVARI: Eksik Değişken Kontrolü
if (!process.env.BOT_TOKEN) {
  console.error('❌ KRİTİK HATA: BOT_TOKEN bulunamadı. Lütfen .env dosyasını kontrol edin veya ortam değişkenlerini ayarlayın.');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// 2. VERİ TİPİ KONTROLÜ: Konfigürasyonun "Zero-Trust" (Sıfır Güven) ile işlenmesi
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

// --- DUYURU MESAJI VE MANTIK ---
const DAILY_MESSAGE = `
💎 <b>MALIBU PRZ SUITE: GÜNLÜK BÜLTEN</b>

<i>"Finansal piyasalarda kurumsal ayak izlerini takip edin. Algoritmik hassasiyet, profesyonel sonuçlar."</i>

⚡️ <b>Hızlı Erişim Linkleri:</b>
Hizmetlerimize ve eğitimlerimize aşağıdaki butonlardan anında ulaşabilirsiniz.
`;

async function sendDailyMessage() {
  const MAIN_CHANNEL = ALLOWED_CHATS[0];
  if (!MAIN_CHANNEL) {
    console.warn('[UYARI] Kanal ID tanımlı olmadığı için duyuru yapılamadı. Lütfen CHANNEL_ID değişkenini kontrol edin.');
    return;
  }

  try {
    console.log(`[İŞLEM] Duyuru mesajı hazırlanıyor... Hedef: ${MAIN_CHANNEL}`);
    
    // ESKİ MESAJI SİL (Hata korumalı - Fail-safe)
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

    // Otomatik Sabitleme (Pin) - Hata korumalı
    try {
      await bot.telegram.pinChatMessage(MAIN_CHANNEL, sentMsg.message_id, { disable_notification: false });
      console.log('[BİLGİ] Duyuru sabitlendi.');
    } catch (e) {
      console.warn('[BİLGİ] Sabitleme yapılamadı (Bot yetkisi eksik olabilir).');
    }

    console.log('[BAŞARI] Günlük mesaj kanala iletildi.');
  } catch (error) {
    console.error('[CRITICAL HATA] Duyuru gönderilirken bir sorun çıktı:', error.message);
  }
}

// --- ZAMANLAYICI (SCHEDULER) ---
function scheduleDailyMessage() {
  try {
    const now = new Date();
    // Türkiye saati (UTC+3) hesabı
    const trTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));

    // Hedef saatler: 11:00 ve 23:00
    const targets = [11, 23];
    let nextTarget = null;

    for (const hour of targets) {
      let t = new Date(trTime);
      t.setHours(hour, 0, 0, 0);
      if (t > trTime) {
        nextTarget = t;
        break;
      }
    }

    // Eğer bugün başka hedef kalmadıysa yarın sabah 11'e kur
    if (!nextTarget) {
      nextTarget = new Date(trTime);
      nextTarget.setDate(nextTarget.getDate() + 1);
      nextTarget.setHours(targets[0], 0, 0, 0);
    }

    const delay = nextTarget.getTime() - trTime.getTime();
    console.log(`[BİLGİ] Bir sonraki mesaj ${nextTarget.toLocaleString('tr-TR')} zamanına kuruldu.`);

    setTimeout(() => {
      sendDailyMessage();
      // İlk mesajdan sonra her 12 saatte bir tekrarla
      setInterval(sendDailyMessage, 12 * 60 * 60 * 1000);
    }, delay);
  } catch (err) {
    console.error('[HATA] Scheduler başlatılırken hata oluştu:', err.message);
  }
}

// --- KOMUTLAR (ADMIN) ---

// /test_duyuru Komutu: Manuel tetikleme ve yetki bildirimi
bot.command('test_duyuru', async (ctx) => {
  const senderId = (ctx.from.id || '').toString();
  
  if (senderId !== ADMIN_ID) {
    console.warn(`[UYARI] Yetkisiz erişim denemesi! Gönderen ID: ${senderId}`);
    return ctx.reply(`⛔ Yetkisiz işlem. 
Sizin ID: ${senderId}
Sistemde Kayıtlı Admin ID: ${ADMIN_ID || 'TANIMLANMAMIŞ!'}`);
  }
  
  await sendDailyMessage();
  ctx.reply('✅ Test duyurusu başarıyla gönderildi.');
});

bot.command('izinver', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  const target = (ctx.message.text.split(' ')[1] || '').replace('@', '').toLowerCase();
  if (target) {
    whitelist.add(target);
    ctx.reply(`✅ @${target} beyaz listeye eklendi.`);
  }
});

// --- DİNLİYİCİLER (BAN MANTIGI) ---

bot.on('message', async (ctx) => {
  if (!isAuthorizedChat(ctx.chat.id) && ctx.chat.type !== 'private') return;
  const user = ctx.from;
  if (user.id.toString() !== ADMIN_ID) {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
    if (fullName.includes('malibu')) {
      try {
        await ctx.banChatMember(user.id);
        if (ADMIN_ID) {
          await ctx.telegram.sendMessage(ADMIN_ID, `🚨 <b>Taklit Engellendi:</b> ${fullName} (${user.id})`);
        }
      } catch (e) { console.error('Ban hatası:', e.message); }
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
        // Grup veda mesajı ve ID temizliği
        if (ctx.chat.id.toString() !== ALLOWED_CHATS[0]) {
           if (lastGroupMessageId) {
             try { await ctx.telegram.deleteMessage(ctx.chat.id, lastGroupMessageId); } catch (e) {}
           }
           const sent = await ctx.reply(`[ ${user.username || user.first_name} ] Ayrıldı ve yasaklandı.`);
           lastGroupMessageId = sent.message_id;
        }
      } catch (e) { console.error('Ayrılma ban hatası:', e.message); }
    }
  }
});

// --- BAŞLATMA ---

scheduleDailyMessage();

bot.launch({
  allowedUpdates: ['chat_member', 'message']
})
.then(() => {
  console.log('✅ Bot başarıyla hazır ve dinlemede!');
  console.log(`[BİLGİ] Yapılandırılmış Admin: ${ADMIN_ID || 'YOK'}`);
  console.log(`[BİLGİ] Hedef Kanal Sayısı: ${ALLOWED_CHATS.length}`);
})
.catch((err) => {
  if (err.description && err.description.includes('Conflict')) {
    console.error('🚨 409 CONFLICT: Bot başka bir sunucuda hali hazırda çalışıyor! Lütfen diğer tüm kopyaları kapatın veya Token yenileyin.');
  } else {
    console.error('❌ BAŞLATMA HATASI:', err.message);
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
