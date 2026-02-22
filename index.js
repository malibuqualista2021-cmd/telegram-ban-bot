const { Telegraf } = require('telegraf');
require('dotenv').config();

if (!process.env.BOT_TOKEN) {
  console.error('HATA: .env dosyasında BOT_TOKEN tanımlanmamış!');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Chat ID'lerini listeye çevir ve temizle
const ALLOWED_CHATS = (process.env.CHANNEL_ID || '').split(',').map(id => id.trim());

// Beyaz liste (Whitelist)
const whitelist = new Set();

// Yardımcı fonksiyon: Chat ID yetkili mi?
function isAuthorizedChat(chatId) {
  return ALLOWED_CHATS.includes(chatId.toString());
}

// /izinver komutu - Sadece admin kullanabilir
bot.command('izinver', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const username = ctx.message.text.split(' ')[1];
  if (!username) {
    return ctx.reply('Lütfen bir kullanıcı adı girin. Örn: /izinver malibu');
  }

  const cleanUsername = username.replace('@', '').toLowerCase();
  whitelist.add(cleanUsername);
  ctx.reply(`✅ @${cleanUsername} beyaz listeye eklendi. Bu kişi kanallardan ayrılsa bile banlanmayacak.`);
});

// /listele komutu
bot.command('listele', (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
  if (whitelist.size === 0) return ctx.reply('Beyaz liste boş.');
  ctx.reply(`📋 Beyaz Liste:\n${Array.from(whitelist).map(u => `@${u}`).join('\n')}`);
});

// Mesajları dinle - İsim değişikliğini yakalamak için
bot.on('message', async (ctx) => {
  // Sadece listedeki chatlerde veya adminle özel mesajda çalış
  if (!isAuthorizedChat(ctx.chat.id) && ctx.chat.type !== 'private') return;

  const user = ctx.from;
  const adminId = process.env.ADMIN_ID;

  if (user.id.toString() !== adminId) {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();

    if (fullName.includes('malibu') || fullName.replace(/\s/g, '').includes('malibu')) {
      try {
        console.log(`[TAKLİT TESPİTİ] ${user.first_name} ismini Malibu olarak değiştirdi! Banlanıyor...`);
        await ctx.banChatMember(user.id);

        if (adminId) {
          await ctx.telegram.sendMessage(adminId, `🚨 <b>Taklit Girişimi Engellendi!</b>\n\n` +
            `Bir kullanıcı ismini <b>Malibu</b> yaparak mesaj attı ve otomatijk olarak yasaklandı.\n\n` +
            `👤 <b>Ad:</b> ${user.first_name} ${user.last_name || ''}\n` +
            `🆔 <b>ID:</b> <code>${user.id}</code>\n` +
            `📍 <b>Chat:</b> ${ctx.chat.title || ctx.chat.id}\n` +
            `🔗 <b>Username:</b> @${user.username || 'yok'}`, { parse_mode: 'HTML' });
        }
      } catch (error) {
        console.error('[HATA] Taklitçi banlanırken sorun oluştu:', error.message);
      }
      return;
    }
  }
});

// Chat member güncellemelerini dinle
bot.on('chat_member', async (ctx) => {
  // Sadece yetkili chatlerdeki ayrılmaları kontrol et
  if (!isAuthorizedChat(ctx.chat.id)) return;

  const { old_chat_member, new_chat_member } = ctx.update.chat_member;
  const user = new_chat_member.user;
  const chat = ctx.chat;

  if (new_chat_member.status === 'left') {
    const username = (user.username || '').toLowerCase();

    if (whitelist.has(username)) {
      console.log(`[BEYAZ LISTE] ${user.first_name} (@${username}) listede olduğu için banlanmadı.`);
      return;
    }

    try {
      console.log(`[AYRILMA] Kullanıcı ayrıldı: ${user.first_name} (@${user.username || 'yok'}) - ID: ${user.id} - Chat: ${chat.id}`);
      await ctx.banChatMember(user.id);

      const adminId = process.env.ADMIN_ID;
      if (adminId) {
        const message = `🚫 <b>Kullanıcı Yasaklandı</b>\n\n` +
          `👤 <b>Ad:</b> ${user.first_name}\n` +
          `🆔 <b>ID:</b> <code>${user.id}</code>\n` +
          `🔗 <b>Username:</b> @${user.username || 'yok'}\n` +
          `📍 <b>Kaynak:</b> ${chat.title || chat.id}`;

        await ctx.telegram.sendMessage(adminId, message, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error(`[HATA] İşlem başarısız (${user.id}):`, error.description || error.message);
    }
  }
});

// --- GÜNLÜK MESAJ AYARLARI ---
const DAILY_MESSAGE = `
📢 <b>Malibu İndikatör & Eğitim Linkleri</b>

💎 <b>Ücretli İndikatörler:</b> <a href="https://maliibuu.netlify.app/">maliibuu.netlify.app</a>
📊 <b>Trade Journali:</b> <a href="https://masterclassjournall.netlify.app/">masterclassjournall.netlify.app</a>
🎥 <b>YouTube Eğitimleri:</b> <a href="https://www.youtube.com/@malibuuuu">youtube.com/@malibuuuu</a>
🐦 <b>X (Twitter):</b> <a href="https://x.com/maliibu">x.com/maliibu</a>
📈 <b>Tüm İndikatörler:</b> <a href="https://tr.tradingview.com/u/malibuuu/#published-scripts">TradingView</a>
💬 <b>Chat Kanalı:</b> <a href="https://t.me/+V8IdRen7SaBiNWFk">Katılmak için tıkla</a>
`;

async function sendDailyMessage() {
  // İlk ID'yi (Ana Kanall) seçip mesaj gönderir
  const MAIN_CHANNEL = ALLOWED_CHATS[0];
  if (MAIN_CHANNEL) {
    try {
      await bot.telegram.sendMessage(MAIN_CHANNEL, DAILY_MESSAGE, { parse_mode: 'HTML' });
      console.log('[BİLGİ] Günlük mesaj ana kanala gönderildi.');
    } catch (error) {
      console.error('[HATA] Günlük mesaj gönderilemedi:', error.message);
    }
  }
}

// Zamanlayıcı ayarları (20:30)
function scheduleDailyMessage() {
  const TARGET_HOUR = 20;
  const TARGET_MINUTE = 30;

  const now = new Date();
  const trTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  let target = new Date(trTime);
  target.setHours(TARGET_HOUR, TARGET_MINUTE, 0, 0);

  if (trTime > target) target.setDate(target.getDate() + 1);

  const delay = target.getTime() - trTime.getTime();
  setTimeout(() => {
    sendDailyMessage();
    setInterval(sendDailyMessage, 24 * 60 * 60 * 1000);
  }, delay);
}

scheduleDailyMessage();

// Botu başlat
bot.launch({
  allowedUpdates: ['chat_member', 'message']
}).then(() => {
  console.log(`Bot başarıyla başlatıldı. Dinlenen chat sayısı: ${ALLOWED_CHATS.length}`);
});

bot.catch((err) => console.error('Bot hatası:', err));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
