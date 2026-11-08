const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/**
 * أوامر بومودورو
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('pomodoro')
    .setDescription('إدارة جلسات بومودورو والتركيز الجماعي')
    .addSubcommand(sub =>
      sub.setName('start')
        .setDescription('بدء جلسة بومودورو جديدة')
        .addIntegerOption(opt =>
          opt.setName('focus')
            .setDescription('مدة التركيز بالدقائق (افتراضي 25)')
            .setMinValue(5)
            .setMaxValue(120)
        )
        .addIntegerOption(opt =>
          opt.setName('break')
            .setDescription('مدة الاستراحة بالدقائق (افتراضي 5)')
            .setMinValue(1)
            .setMaxValue(60)
        )
    )
    .addSubcommand(sub =>
      sub.setName('join')
        .setDescription('الانضمام إلى جلسة بومودورو نشطة')
    )
    .addSubcommand(sub =>
      sub.setName('leave')
        .setDescription('مغادرة الجلسة الحالية')
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('عرض حالة الجلسة الحالية')
    )
    .addSubcommand(sub =>
      sub.setName('cancel')
        .setDescription('إلغاء الجلسة الحالية (للمشرفين فقط)')
    )
    .addSubcommand(sub =>
      sub.setName('profile')
        .setDescription('عرض ملف التركيز الخاص بك أو لعضو آخر')
        .addUserOption(opt =>
          opt.setName('member')
            .setDescription('العضو الذي تريد عرض ملفه')
        )
    )
    .addSubcommand(sub =>
      sub.setName('stats')
        .setDescription('عرض إحصائيات الخادم الإجمالية')
    )
    .addSubcommand(sub =>
      sub.setName('settings')
        .setDescription('إعدادات جلسات البومودورو (للمشرفين فقط)')
        .addIntegerOption(opt =>
          opt.setName('focus')
            .setDescription('مدة التركيز الافتراضية بالدقائق')
        )
        .addIntegerOption(opt =>
          opt.setName('break')
            .setDescription('مدة الاستراحة الافتراضية بالدقائق')
        )
        .addStringOption(opt =>
          opt.setName('role')
            .setDescription('اسم رتبة التركيز المؤقتة')
        )
    ),

  async execute(interaction, pomodoroManager, streakManager, db) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    await interaction.deferReply({ ephemeral: false });

    try {
      switch (subcommand) {
        case 'start': {
          const focusMinutes = interaction.options.getInteger('focus') || 25;
          const breakMinutes = interaction.options.getInteger('break') || 5;

          // التحقق من وجود جلسة نشطة في القناة
          const existingSession = pomodoroManager.getActiveSessionInChannel(guildId, channelId);
          if (existingSession) {
            const embed = new EmbedBuilder()
              .setColor('#ff9ff3')
              .setTitle('⚠️ جلسة نشطة بالفعل')
              .setDescription(`يوجد جلسة بومودورو نشطة في هذه القناة. يمكنك الانضمام إليها باستخدام \`/pomodoro join\``);
            return interaction.editReply({ embeds: [embed] });
          }

          const settings = db.getSettings(guildId);
          const session = pomodoroManager.createSession(guildId, channelId, userId, {
            focusMinutes,
            breakMinutes,
            focusRoleName: settings.focusRoleName || '🍅 Focused',
          });

          const embed = new EmbedBuilder()
            .setColor('#ff6b6b')
            .setTitle('⏱️ جلسة بومودورو جديدة')
            .setDescription(
              `تم إنشاء جلسة تركيز جديدة!\n` +
              `منشئ الجلسة: <@${userId}>\n` +
              `مدة التركيز: **${focusMinutes} دقيقة**\n` +
              `مدة الاستراحة: **${breakMinutes} دقيقة**\n\n` +
              `انضم إلى الجلسة باستخدام الزر أدناه أو الأمر \`/pomodoro join\``
            )
            .addFields(
              { name: '👤 المنشئ', value: `<@${userId}>`, inline: true },
              { name: '👥 الأعضاء', value: '1', inline: true },
              { name: '📊 الحالة', value: 'في الانتظار للبدء', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'بوت بومودورو الدراسي' });

          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`pomodoro_join_${session.id}`)
                .setLabel('انضمام للجلسة')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🍅')
            );

          await interaction.editReply({ embeds: [embed], components: [row] });

          // تخزين معرف الجلسة في التفاعل للتعامل مع الزر في index.js
          // يتم تخزينه في الخريطة العامة
          break;
        }

        case 'join': {
          const session = pomodoroManager.getActiveSessionInChannel(guildId, channelId);
          if (!session) {
            const embed = new EmbedBuilder()
              .setColor('#ff9ff3')
              .setTitle('❌ لا توجد جلسة نشطة')
              .setDescription('لا توجد جلسة بومودورو نشطة في هذه القناة. يمكن إنشاء جلسة جديدة باستخدام \`/pomodoro start\``');
            return interaction.editReply({ embeds: [embed] });
          }

          const result = pomodoroManager.joinSession(guildId, session.id, userId);
          if (!result.success) {
            const embed = new EmbedBuilder()
              .setColor('#ff9ff3')
              .setTitle('❌ لا يمكن الانضمام')
              .setDescription(result.error);
            return interaction.editReply({ embeds: [embed] });
          }

          const embed = new EmbedBuilder()
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
          break;
        }

        case 'leave': {
          const session = pomodoroManager.getActiveSessionInChannel(guildId, channelId);
          if (!session) {
            return interaction.editReply({ content: 'لا توجد جلسة نشطة للمغادرة منها.', embeds: [] });
          }

          if (!session.members.includes(userId)) {
            return interaction.editReply({ content: 'أنت غير مشترك في هذه الجلسة.', embeds: [] });
          }

          session.members = session.members.filter(id => id !== userId);
          db.saveSession(guildId, session.id, session);

          const embed = new EmbedBuilder()
            .setColor('#ff9ff3')
            .setTitle('👋 تم مغادرة الجلسة')
            .setDescription(`لقد غادرت جلسة التركيز بنجاح.`);
          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'status': {
          const session = pomodoroManager.getActiveSessionInChannel(guildId, channelId);
          if (!session) {
            const embed = new EmbedBuilder()
              .setColor('#ff9ff3')
              .setTitle('ℹ️ حالة الجلسة')
              .setDescription('لا توجد جلسة بومودورو نشطة في هذه القناة.');
            return interaction.editReply({ embeds: [embed] });
          }

          let phaseText = '';
          let timeRemaining = 0;
          const now = Date.now();

          if (session.status === 'focus') {
            phaseText = '🍅 وقت التركيز';
            timeRemaining = Math.max(0, session.focusDuration * 60 * 1000 - (now - session.phaseStartTime));
          } else if (session.status === 'break') {
            phaseText = '☕ وقت الاستراحة';
            timeRemaining = Math.max(0, session.breakDuration * 60 * 1000 - (now - session.phaseStartTime));
          } else {
            phaseText = '⏳ في الانتظار للبدء';
          }

          const embed = new EmbedBuilder()
            .setColor(session.status === 'focus' ? '#ff6b6b' : session.status === 'break' ? '#4ecdc4' : '#95e1d3')
            .setTitle('📊 حالة جلسة البومودورو')
            .addFields(
              { name: '📋 الحالة', value: phaseText, inline: true },
              { name: '👥 الأعضاء', value: session.members.map(m => `<@${m}>`).join(', '), inline: false },
              { name: '⏱️ الوقت المتبقي', value: timeRemaining > 0 ? `${Math.ceil(timeRemaining / 60000)} دقيقة` : 'جاري الحساب...', inline: true },
              { name: '🍅 إجمالي التركيز', value: `${session.totalFocusMinutes} دقيقة`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'بوت بومودورو الدراسي' });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'cancel': {
          // فقط للمشرفين أو منشئ الجلسة
          const session = pomodoroManager.getActiveSessionInChannel(guildId, channelId);
          if (!session) {
            return interaction.editReply({ content: 'لا توجد جلسة نشطة لإلغائها.', embeds: [] });
          }

          const member = interaction.guild.members.cache.get(userId);
          const isAdmin = member.permissions.has('ManageGuild') || member.permissions.has('Administrator');
          const isCreator = session.creatorId === userId;

          if (!isAdmin && !isCreator) {
            return interaction.editReply({ content: 'ليس لديك صلاحية إلغاء هذه الجلسة. فقط المنشئ أو المشرفين يمكنهم الإلغاء.', embeds: [] });
          }

          await pomodoroManager.cancelSession(guildId, session.id);
          const embed = new EmbedBuilder()
            .setColor('#ff9ff3')
            .setTitle('❌ تم إلغاء الجلسة')
            .setDescription('تم إلغاء جلسة البومودورو بنجاح.');
          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'profile': {
          const targetUser = interaction.options.getUser('member') || interaction.user;
          const profile = streakManager.getUserProfile(guildId, targetUser.id);

          const embed = streakManager.createProfileEmbed(targetUser, profile, interaction.guild);
          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'stats': {
          const stats = streakManager.getServerStats(guildId);

          const embed = new EmbedBuilder()
            .setColor('#7289da')
            .setTitle('📈 إحصائيات الخادم الإجمالية')
            .addFields(
              { name: '👥 إجمالي المستخدمين', value: stats.totalUsers.toString(), inline: true },
              { name: '⏱️ إجمالي ساعات التركيز', value: stats.totalFocusHours.toString(), inline: true },
              { name: '🍅 إجمالي الجلسات', value: stats.totalSessions.toString(), inline: true },
              { name: '🔥 أعلى سلسلة يومية', value: `${stats.maxStreak} يوم`, inline: true },
              { name: '📅 متوسط السلاسل', value: stats.averageStreak.toString(), inline: true },
              { name: '⚡ الجلسات النشطة', value: stats.activeSessions.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'بوت بومودورو الدراسي', iconURL: interaction.guild.iconURL() });

          await interaction.editReply({ embeds: [embed] });
          break;
        }

        case 'settings': {
          const member = interaction.guild.members.cache.get(userId);
          if (!member.permissions.has('ManageGuild')) {
            return interaction.editReply({ content: 'هذا الأمر مخصص للمشرفين فقط.', embeds: [] });
          }

          const focus = interaction.options.getInteger('focus');
          const brk = interaction.options.getInteger('break');
          const roleName = interaction.options.getString('role');

          const updates = {};
          if (focus) updates.focusMinutes = focus;
          if (brk) updates.breakMinutes = brk;
          if (roleName) updates.focusRoleName = roleName;

          if (Object.keys(updates).length > 0) {
            db.saveSettings(guildId, updates);
          }

          const current = db.getSettings(guildId);
          const embed = new EmbedBuilder()
            .setColor('#7289da')
            .setTitle('⚙️ إعدادات البومودورو')
            .addFields(
              { name: '⏱️ مدة التركيز', value: `${current.focusMinutes || 25} دقيقة`, inline: true },
              { name: '☕ مدة الاستراحة', value: `${current.breakMinutes || 5} دقيقة`, inline: true },
              { name: '🏷️ رتبة التركيز', value: current.focusRoleName || '🍅 Focused', inline: true }
            )
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          break;
        }
      }
    } catch (error) {
      console.error('خطأ في تنفيذ أمر بومودورو:', error);
      await interaction.editReply({ content: 'حدث خطأ أثناء تنفيذ الأمر. يرجى المحاولة مرة أخرى.', embeds: [] });
    }
  },
};
