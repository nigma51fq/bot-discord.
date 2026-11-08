require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Events, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');

const PomodoroManager = require('./utils/pomodoroManager');
const StreakManager = require('./utils/streakManager');
const pomodoroCmd = require('./commands/pomodoro');
const db = require('./database');

// التحقق من التوكن
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ لم يتم العثور على DISCORD_TOKEN في ملف .env');
  process.exit(1);
}

// إنشاء البوت مع الصلاحيات المطلوبة
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// مجموعات الأوامر والتimers
client.commands = new Collection();
client.pomodoroSessions = new Map(); // channelId -> sessionId

const pomodoroManager = new PomodoroManager(client);
const streakManager = new StreakManager(client);

// تسجيل الأمر
client.commands.set(pomodoroCmd.data.name, pomodoroCmd);

// عند تشغيل البوت
client.once(Events.ClientReady, async c => {
  console.log(`✅ البوت يعمل باسم: ${c.user.tag}`);
  console.log(`📡 متواجد في ${c.guilds.cache.size} خادم`);

  // تسجيل الأوامر - إذا كان هناك GUILD_ID يتم التسجيل على الخادم مباشرة (فوري)
  // وإلا يتم التسجيل عالمياً (قد يستغرق حتى ساعة للظهور)
  const guildId = process.env.GUILD_ID;

  try {
    if (guildId) {
      const guild = await c.guilds.fetch(guildId);
      await guild.commands.set([pomodoroCmd.data]);
      console.log(`✅ تم تسجيل الأوامر على الخادم: ${guild.name} (فوري)`);
    } else {
      await c.commands.register([pomodoroCmd.data]);
      console.log('✅ تم تسجيل الأوامر بشكل عام (قد يستغرق حتى ساعة للظهور)');
    }
  } catch (e) {
    console.error('❌ خطأ في تسجيل الأوامر:', e.message);
  }

  // استعادة الجلسات النشطة عند إعادة التشغيل
  pomodoroManager.stopAllTimers();
});

// معالجة التفاعلات (slash commands)
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, pomodoroManager, streakManager, db);
    } catch (e) {
      console.error('خطأ في تنفيذ الأمر:', e);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'حدث خطأ أثناء تنفيذ الأمر.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'حدث خطأ أثناء تنفيذ الأمر.', ephemeral: true });
      }
    }
  }

  // معالجة أزرار الانضمام للجلسات
  if (interaction.isButton()) {
    const customId = interaction.customId;
    if (customId.startsWith('pomodoro_join_')) {
      const sessionId = customId.replace('pomodoro_join_', '');
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const channelId = interaction.channelId;

      await interaction.deferReply({ ephemeral: false });

      const session = db.getSession(guildId, sessionId);
      if (!session || session.channelId !== channelId) {
        return interaction.editReply({ content: 'هذه الجلسة غير موجودة أو غير صالحة.', embeds: [] });
      }

      const result = pomodoroManager.joinSession(guildId, sessionId, userId);
      if (!result.success) {
        return interaction.editReply({ content: result.error, embeds: [] });
      }

      const embed = new (require('discord.js').EmbedBuilder)()
        .setColor('#4ecdc4')
        .setTitle('✅ تم الانضمام إلى الجلسة')
        .setDescription(
          `لقد انضممت بنجاح إلى جلسة التركيز!\n` +
          `عدد الأعضاء الحالي: ${result.session.members.length}`
        )
        .addFields(
          { name: '🍅 وقت التركيز', value: `${session.focusDuration} دقيقة`, inline: true },
          { name: '☕ وقت الاستراحة', value: `${session.breakDuration} دقيقة`, inline: true },
          { name: '📊 الحالة', value: session.status === 'focus' ? 'جاري التركيز' : 'في الانتظار', inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }
});

// بدء جلسة التركيز عند الضغط على رد (للبدء التلقائي)
// يمكن استخدام أمر /pomodoro start لبدء الجلسة

// مراقبة حالات القنوات الصوتية (Voice Focus Integration)
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guildId = newState.guild.id;
  const userId = newState.member ? newState.member.user.id : null;
  if (!userId) return;

  const settings = db.getSettings(guildId);
  const focusRoleName = settings.focusRoleName || '🍅 Focused';

  // إذا انضم member لقناة صوتية.Has session active
  if (newState.channelId && !oldState.channelId) {
    // البحث عن جلسة نشطة في القناة النصية المقابلة أو أي جلسة خاصة بالمستخدم
    const sessions = db.getAllSessions(guildId);
    const userSessionId = Object.keys(sessions).find(sid => {
      const s = sessions[sid];
      return s.members.includes(userId) &&
        (s.status === 'waiting' || s.status === 'focus' || s.status === 'break');
    });

    if (userSessionId) {
      const session = sessions[userSessionId];
      // تطبيق رتبة التركيز إذا كان المستخدم في جلسة نشطة
      try {
        const guild = await client.guilds.fetch(guildId);
        let role = guild.roles.cache.find(r => r.name === focusRoleName);
        if (!role) {
          role = await guild.roles.create({
            name: focusRoleName,
            color: '#ff6b6b',
            hoist: true,
            mentionable: true,
            reason: 'رتبة تركيز بومودورو',
          });
        }
        const member = await guild.members.fetch(userId);
        await member.roles.add(role, 'في جلسة تركيز بومودورو - صوت');
        if (member.nickname && !member.nickname.includes('🍅')) {
          await member.setNickname(`🍅 ${member.nickname}`, 'تحديد حالة التركيز');
        } else if (!member.nickname && !member.displayName.includes('🍅')) {
          await member.setNickname(`🍅 ${member.displayName}`, 'تحديد حالة التركيز');
        }
      } catch (e) {
        console.error('خطأ في تطبيق رتبة التركيز عند الانضمام للقناة الصوتية:', e.message);
      }
    }
  }

  // إذا غادر member القناة الصوتية
  if (!newState.channelId && oldState.channelId) {
    // إزالة رتبة التركيز (اختياري - يمكن الإبقاء عليها حتى نهاية الجلسة)
    // نتركها حتى نهاية الجلسة الرسمية
  }
});

// معالجة انتهاء الجلسة وتسجيل السلسلة اليومية
// يتم استدعاء هذه الدالة من pomodoroManager عند انتهاء مرحلة التركيز
client.on('pomodoroSessionCompleted', async (guildId, sessionId, memberId, minutes) => {
  await streakManager.recordSession(guildId, memberId, minutes);
});

// عند انضمام البوت لخادم جديد
client.on(Events.GuildCreate, guild => {
  console.log(`✅ انضمت البوت إلى خادم جديد: ${guild.name} (${guild.id})`);
  // إنشاء ملف بيانات افتراضي للخادم
  db._load(guild.id);
});

// معالجة الأخطاء
client.on(Events.Error, e => console.error('خطأ في البوت:', e));
client.on(Events.Warn, e => console.warn('تحذير:', e));

// معالجة الإغلاق الآمن
process.on('SIGINT', () => {
  pomodoroManager.stopAllTimers();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  pomodoroManager.stopAllTimers();
  client.destroy();
  process.exit(0);
});

// تسجيل الدخول
client.login(process.env.DISCORD_TOKEN);

module.exports = { client, pomodoroManager, streakManager, db };
