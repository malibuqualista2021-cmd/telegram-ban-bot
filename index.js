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

// Chat member güncellemelerini dinle
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
