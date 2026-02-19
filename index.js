const { Telegraf } = require('telegraf');
require('dotenv').config();

if (!process.env.BOT_TOKEN) {
  console.error('HATA: .env dosyasında BOT_TOKEN tanımlanmamış!');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Beyaz liste (Whitelist) - Kullanıcı adlarını tutar
// Not: Basitlik adına bellekte tutulur, bot yeniden başlarsa sıfırlanır.
const whitelist = new Set();

// /izinver komutu - Sadece admin kullanabilir
bot.command('izinver', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const username = ctx.message.text.split(' ')[1];
  if (!username) {
    return ctx.reply('Lütfen bir kullanıcı adı girin. Örn: /izinver malibu');
  }

  const cleanUsername = username.replace('@', '').toLowerCase();
  whitelist.add(cleanUsername);
  ctx.reply(`✅ @${cleanUsername} beyaz listeye eklendi. Bu kişi kanaldan ayrılsa bile banlanmayacak.`);
});

// /listele komutu - Beyaz listeyi görürsünüz
bot.command('listele', (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
  if (whitelist.size === 0) return ctx.reply('Beyaz liste boş.');
  ctx.reply(`📋 Beyaz Liste:\n${Array.from(whitelist).map(u => `@${u}`).join('\n')}`);
});

// Mesajları dinle - İsim değişikliğini yakalamak için
bot.on('message', async (ctx) => {
  const user = ctx.from;
  const adminId = process.env.ADMIN_ID;

  // Eğer gerçek admin değilse ismini kontrol et
  if (user.id.toString() !== adminId) {
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();

    // "malibu" kelimesini kontrol et (harf arası boşlukları da yakalar)
    if (fullName.includes('malibu') || fullName.replace(/\s/g, '').includes('malibu')) {
      try {
        console.log(`[TAKLİT TESPİTİ] ${user.first_name} ismini Malibu olarak değiştirdi! Banlanıyor...`);

        await ctx.banChatMember(user.id);

        if (adminId) {
          await ctx.telegram.sendMessage(adminId, `🚨 <b>Taklit Girişimi Engellendi!</b>\n\n` +
            `Bir kullanıcı ismini <b>Malibu</b> yaparak mesaj attı ve otomatik olarak banlandı.\n\n` +
            `👤 <b>Ad:</b> ${user.first_name} ${user.last_name || ''}\n` +
            `🆔 <b>ID:</b> <code>${user.id}</code>\n` +
            `🔗 <b>Username:</b> @${user.username || 'yok'}`, { parse_mode: 'HTML' });
        }
      } catch (error) {
        console.error('[HATA] Taklitçi banlanırken sorun oluştu:', error.message);
      }
      return; // Banlandığı için başka işlem yapmaya gerek yok
    }
  }
});

// Chat member güncellemelerini dinle (Katılma anı için)
bot.on('chat_member', async (ctx) => {
  const { old_chat_member, new_chat_member } = ctx.update.chat_member;
  const user = new_chat_member.user;
  const chat = ctx.chat;

  // Kullanıcı durumunu kontrol et: Eğer durum 'left' (ayrıldı) ise banla
  if (new_chat_member.status === 'left') {
    const username = (user.username || '').toLowerCase();

    // Beyaz liste kontrolü
    if (whitelist.has(username)) {
      console.log(`[BEYAZ LISTE] ${user.first_name} (@${username}) listede olduğu için banlanmadı.`);
      return;
    }

    try {
      console.log(`[AYRILMA] Kullanıcı ayrıldı: ${user.first_name} (@${user.username || 'yok'}) - ID: ${user.id}`);

      // Kullanıcıyı banla (Böylece tekrar giremez)
      await ctx.banChatMember(user.id);
      console.log(`[BAN] Kullanıcı kalıcı olarak yasaklandı: ${user.id}`);

      // Admin'e bildirim gönder
      const adminId = process.env.ADMIN_ID;
      if (adminId) {
        const message = `🚫 <b>Kullanıcı Yasaklandı</b>\n\n` +
          `👤 <b>Ad:</b> ${user.first_name}\n` +
          `🆔 <b>ID:</b> <code>${user.id}</code>\n` +
          `🔗 <b>Username:</b> @${user.username || 'yok'}\n` +
          `📍 <b>Kanal:</b> ${chat.title || chat.id}`;

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

<i>Her gün saat 20:30'da otomatik bilgilendirme.</i>
`;
const TARGET_HOUR = 20; // Saat (20:30 için 20)
const TARGET_MINUTE = 30; // Dakika

function scheduleDailyMessage() {
  const now = new Date();
  // Türkiye saati (UTC+3) hesabı
  const trTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));

  let target = new Date(trTime);
  target.setHours(TARGET_HOUR, TARGET_MINUTE, 0, 0);

  // Eğer saat geçtiyse yarına kur
  if (trTime > target) {
    target.setDate(target.getDate() + 1);
  }

  const delay = target.getTime() - trTime.getTime();
  console.log(`[BİLGİ] Bir sonraki mesaj ${target.toLocaleString('tr-TR')} zamanına kuruldu.`);

  setTimeout(() => {
    sendDailyMessage();
    // İlk mesajdan sonra her 24 saatte bir tekrarla
    setInterval(sendDailyMessage, 24 * 60 * 60 * 1000);
  }, delay);
}

async function sendDailyMessage() {
  const CHANNEL_ID = process.env.CHANNEL_ID || '-1002358799473';
  if (CHANNEL_ID) {
    try {
      await bot.telegram.sendMessage(CHANNEL_ID, DAILY_MESSAGE, { parse_mode: 'HTML' });
      console.log('[BİLGİ] Günlük mesaj kanala başarıyla gönderildi.');
    } catch (error) {
      console.error('[HATA] Günlük mesaj gönderilemedi:', error.message);
    }
  }
}

// Zamanlayıcıyı başlat
scheduleDailyMessage();
// ----------------------------

// Botu başlatırken chat_member güncellemelerini almasını sağla
bot.launch({
  allowedUpdates: ['chat_member', 'message']
}).then(() => {
  console.log('Bot başarıyla başlatıldı. Ayrılan kullanıcılar yasaklanacak.');
});

// Hataları yakala
bot.catch((err) => {
  console.error('Bot hatası:', err);
});

// Güvenli kapatma
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
