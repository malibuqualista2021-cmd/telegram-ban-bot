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

// Son gönderilen grup/ban mesajını takip etmek için (Hafızada tutulur)
let lastGroupMessageId = null;
// Son gönderilen GÜNLÜK duyuru mesajını takip etmek için
let lastDailyMessageId = null;

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

  // Sadece AKTİF bir üye (admin, üye, kısıtlı) çıkarsa banla. 
  // Banlı birinin banı kaldırılırsa (kicked -> left) işlem yapma.
  const wasActive = ['member', 'administrator', 'restricted'].includes(old_chat_member.status);

  if (new_chat_member.status === 'left' && wasActive) {
    const username = (user.username || '').toLowerCase();

    if (whitelist.has(username)) {
      console.log(`[BEYAZ LISTE] ${user.first_name} (@${username}) listede olduğu için banlanmadı.`);
      return;
    }

    try {
      console.log(`[AYRILMA] Kullanıcı ayrıldı: ${user.first_name} (@${user.username || 'yok'}) - ID: ${user.id} - Chat: ${chat.id}`);
      await ctx.banChatMember(user.id);

      // Admin'e bildirim
      const adminId = process.env.ADMIN_ID;
      if (adminId) {
        const message = `🚫 <b>Kullanıcı Yasaklandı</b>\n\n` +
          `👤 <b>Ad:</b> ${user.first_name}\n` +
          `🆔 <b>ID:</b> <code>${user.id}</code>\n` +
          `🔗 <b>Username:</b> @${user.username || 'yok'}\n` +
          `📍 <b>Kaynak:</b> ${chat.title || chat.id}`;

        await ctx.telegram.sendMessage(adminId, message, { parse_mode: 'HTML' });
      }

      // --- GRUP CHATİNE ÖZEL MESAJ ---
      // Eğer bu chat bir kanal değilse (yani grup ise) ve ALLOWED_CHATS içindeki 1. ID değilse
      if (chat.id.toString() !== ALLOWED_CHATS[0]) {

        // KANAL SENKRONİZASYON KONTROLÜ
        // Eğer kişi kanaldan da ayrılmışsa, gruba mesaj atma (zaten kanalda banlanmıştır)
        try {
          const channelMember = await ctx.telegram.getChatMember(ALLOWED_CHATS[0], user.id);
          if (channelMember.status === 'left' || channelMember.status === 'kicked') {
            console.log(`[BİLGİ] Kullanıcı kanaldan da ayrıldığı için gruba veda mesajı atılmadı.`);
            return;
          }
        } catch (e) {
          // Kanalda bulunamazsa veya hata olursa devam et
        }

        // ESKİ MESAJI SİL
        if (lastGroupMessageId) {
          try {
            await ctx.telegram.deleteMessage(chat.id, lastGroupMessageId);
            console.log(`[BİLGİ] Eski ban mesajı silindi.`);
          } catch (e) {
            // Mesaj çok eskiyse veya silinemezse hata verme
          }
        }

        const userDisplayName = user.username ? `@${user.username}` : user.first_name;
        const groupMessage = `[ ${userDisplayName} ] Çıktı. Biz de “ya geri gelirse” diye banladık. Kılıcımız keskin sevgimiz sonsuz 😂`;

        const sentMsg = await ctx.telegram.sendMessage(chat.id, groupMessage);
        lastGroupMessageId = sentMsg.message_id; // Yeni ID'yi kaydet
        console.log(`[BİLGİ] Grup chatine yeni ban mesajı gönderildi.`);
      }
      // ----------------------------

    } catch (error) {
      console.error(`[HATA] İşlem başarısız (${user.id}):`, error.description || error.message);
    }
  }
});

// --- OTOMATİK MESAJ AYARLARI ---
const DAILY_MESSAGE = `
💎 <b>MALIBU PRZ SUITE: GÜNLÜK BÜLTEN</b>

<i>"Finansal piyasalarda kurumsal ayak izlerini takip edin. Algoritmik hassasiyet, profesyonel sonuçlar."</i>

⚡️ <b>Hızlı Erişim Linkleri:</b>
Hizmetlerimize ve eğitimlerimize aşağıdaki butonlardan anında ulaşabilirsiniz.
`;

function scheduleDailyMessage() {
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
}

async function sendDailyMessage() {
  const MAIN_CHANNEL = ALLOWED_CHATS[0];
  if (MAIN_CHANNEL) {
    try {
      // EĞER ESKİ BİR MESAJ VARSA SİL
      if (lastDailyMessageId) {
        try {
          await bot.telegram.deleteMessage(MAIN_CHANNEL, lastDailyMessageId);
          console.log('[BİLGİ] Eski günlük mesaj temizlendi.');
        } catch (e) {
          console.log('[BİLGİ] Eski mesaj bulunamadı veya süresi dolmuş (silinemedi).');
        }
      }

      // YENİ DÜZENLİ BUTONLAR
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

      lastDailyMessageId = sentMsg.message_id; // Yeni mesajın ID'sini kaydet
      
      // Mesajı otomatik sabitle (Bildirim gitmesi için)
      try {
        await bot.telegram.pinChatMessage(MAIN_CHANNEL, sentMsg.message_id, { disable_notification: false });
        console.log('[BİLGİ] Yeni günlük mesaj sabitlendi.');
      } catch (pinError) {
        console.error('[HATA] Mesaj sabitlenemedi:', pinError.message);
      }

      console.log('[BİLGİ] Günlük mesaj ana kanala gönderildi.');
    } catch (error) {
      console.error('[HATA] Günlük mesaj gönderilemedi:', error.message);
    }
  }
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
