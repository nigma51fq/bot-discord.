const { EmbedBuilder } = require('discord.js');
const db = require('../database');

/**
 * مدير جلسات بومودورو الجماعية
 */
class PomodoroManager {
  constructor(client) {
    this.client = client;
    this.timers = new Map(); // sessionId -> NodeJS.Timeout
  }

  /**
   * إنشاء جلسة بومودورو جديدة
   */
  createSession(guildId, channelId, creatorId, settings) {
    const sessionId = `pomodoro_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const session = {
      id: sessionId,
      guildId,
      channelId,
      creatorId,
      members: [creatorId],
      status: 'waiting', // waiting, focus, break, completed, cancelled
      currentPhase: null, // focus, break
      phaseStartTime: null,
      focusDuration: settings.focusMinutes || 25,
      breakDuration: settings.breakMinutes || 5,
      totalFocusMinutes: 0,
      createdAt: Date.now(),
    };

    db.saveSession(guildId, sessionId, session);
    return session;
  }

  /**
   * إضافة عضو إلى جلسة
   */
  joinSession(guildId, sessionId, userId) {
    const session = db.getSession(guildId, sessionId);
    if (!session) return { success: false, error: 'الجلسة غير موجودة' };

    if (session.status !== 'waiting' && session.status !== 'focus') {
      return { success: false, error: 'لا يمكن الانضمام إلى هذه الجلسة في حالتها الحالية' };
    }

    if (!session.members.includes(userId)) {
      session.members.push(userId);
    }

    db.saveSession(guildId, sessionId, session);
    return { success: true, session };
  }

  /**
   * بدء جلسة التركيز
   */
  async startFocus(guildId, sessionId) {
    const session = db.getSession(guildId, sessionId);
    if (!session) return { success: false, error: 'الجلسة غير موجودة' };

    if (session.status !== 'waiting') {
      return { success: false, error: 'الجلسة بدأت بالفعل أو انتهت' };
    }

    session.status = 'focus';
    session.currentPhase = 'focus';
    session.phaseStartTime = Date.now();
    db.saveSession(guildId, sessionId, session);

    // تعيين رتبة التركيز للأعضاء
    await this._applyFocusRoles(guildId, session.members, true);

    // إعداد مؤقت انتهاء وقت التركيز
    const focusMs = session.focusDuration * 60 * 1000;
    const timer = setTimeout(() => {
      this.handlePhaseEnd(guildId, sessionId, 'focus');
    }, focusMs);

    this.timers.set(sessionId, timer);

    const channel = await this.client.channels.fetch(session.channelId).catch(() => null);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor('#ff6b6b')
        .setTitle('⏱️ بدأ وقت التركيز!')
        .setDescription(
          `لقد بدأت جلسة التركيز الآن! duration: **${session.focusDuration} دقيقة**\n` +
          `الأعضاء المشاركون: ${session.members.map(m => `<@${m}>`).join(', ')}\n\n` +
          `لا تزعجوا الأعضاء المشاركين خلال هذه الفترة.`
        )
        .addFields(
          { name: '🍅 وقت التركيز', value: `${session.focusDuration} دقيقة`, inline: true },
          { name: '☕ وقت الاستراحة', value: `${session.breakDuration} دقيقة`, inline: true },
          { name: '👥 عدد الأعضاء', value: session.members.length.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: 'بوت بومودورو الدراسي' });

      await channel.send({
        content: session.members.map(m => `<@${m}>`).join(' '),
        embeds: [embed],
      });
    }

    return { success: true, session };
  }

  /**
   * معالجة نهاية مرحلة (تركيز أو استراحة)
   */
  async handlePhaseEnd(guildId, sessionId, phase) {
    const session = db.getSession(guildId, sessionId);
    if (!session) return;

    // إزالة مؤقت المرحلة الحالية
    if (this.timers.has(sessionId)) {
      clearTimeout(this.timers.get(sessionId));
      this.timers.delete(sessionId);
    }

    const channel = await this.client.channels.fetch(session.channelId).catch(() => null);

    if (phase === 'focus') {
      // انتهاء وقت التركيز - بداية الاستراحة
      session.status = 'break';
      session.currentPhase = 'break';
      session.phaseStartTime = Date.now();
      session.totalFocusMinutes += session.focusDuration;

      // تحديث إجمالي دقائق التركيز لكل عضو
      for (const memberId of session.members) {
        const userData = db.getUserData(guildId, memberId);
        userData.totalFocusMinutes += session.focusDuration;
        userData.sessions += 1;
        db.saveUserData(guildId, memberId, userData);
      }

      // إزالة رتبة التركيز وبدء الاستراحة
      await this._applyFocusRoles(guildId, session.members, false);

      db.saveSession(guildId, sessionId, session);

      if (channel) {
        const embed = new EmbedBuilder()
          .setColor('#4ecdc4')
          .setTitle('☕ وقت الاستراحة!')
          .setDescription(
            `انتهى وقت التركيز! يمكنكم الآن أخذ استراحة لمدة **${session.breakDuration} دقيقة**.\n` +
            `تم إضافة ${session.focusDuration} دقيقة إلى رصيد تركيز كل عضو.\n\n` +
            `سيعود وقت التركيز تلقائياً بعد انتهاء الاستراحة.`
          )
          .addFields(
            { name: '⏱️ مدة الاستراحة', value: `${session.breakDuration} دقيقة`, inline: true },
            { name: '🍅 إجمالي التركيز', value: `${session.totalFocusMinutes} دقيقة`, inline: true }
          )
          .setTimestamp()
          .setFooter({ text: 'بوت بومودورو الدراسي' });

        await channel.send({
          content: session.members.map(m => `<@${m}>`).join(' '),
          embeds: [embed],
        });
      }

      // إعداد مؤقت نهاية الاستراحة والعودة للتركيز (أو结束 الجلسة)
      const breakMs = session.breakDuration * 60 * 1000;
      const timer = setTimeout(() => {
        this.handlePhaseEnd(guildId, sessionId, 'break');
      }, breakMs);

      this.timers.set(sessionId, timer);
    } else if (phase === 'break') {
      // انتهاء الاستراحة - خيار العودة للتركيز أو إنهاء الجلسة
      session.status = 'waiting';
      session.currentPhase = null;
      session.phaseStartTime = null;

      // إزالة رتبة التركيز نهائياً
      await this._applyFocusRoles(guildId, session.members, false);

      db.saveSession(guildId, sessionId, session);

      if (channel) {
        const embed = new EmbedBuilder()
          .setColor('#95e1d3')
          .setTitle('✅ انتهت الجلسة')
          .setDescription(
            `لقد انتهت جلسة البومودورو!\n` +
            `إجمالي وقت التركيز: **${session.totalFocusMinutes} دقيقة**\n` +
            `عدد الجلسات المكتملة: ${Math.floor(session.totalFocusMinutes / session.focusDuration)}`
          )
          .addFields(
            { name: '👥 الأعضاء', value: session.members.map(m => `<@${m}>`).join(', '), inline: false }
          )
          .setTimestamp()
          .setFooter({ text: 'بوت بومودورو الدراسي' });

        await channel.send({ embeds: [embed] });
      }

      this.timers.delete(sessionId);
    }
  }

  /**
   * إلغاء جلسة
   */
  async cancelSession(guildId, sessionId) {
    const session = db.getSession(guildId, sessionId);
    if (!session) return { success: false, error: 'الجلسة غير موجودة' };

    if (this.timers.has(sessionId)) {
      clearTimeout(this.timers.get(sessionId));
      this.timers.delete(sessionId);
    }

    session.status = 'cancelled';
    await this._applyFocusRoles(guildId, session.members, false);
    db.saveSession(guildId, sessionId, session);

    const channel = await this.client.channels.fetch(session.channelId).catch(() => null);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor('#ff9ff3')
        .setTitle('❌ تم إلغاء الجلسة')
        .setDescription('تم إلغاء جلسة البومودورو من قبل المسؤول.');
      await channel.send({ embeds: [embed] });
    }

    return { success: true };
  }

  /**
   * تطبيق أو إزالة رتبة التركيز على الأعضاء
   */
  async _applyFocusRoles(guildId, userIds, apply) {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const settings = db.getSettings(guildId);
      const roleName = settings.focusRoleName || '🍅 Focused';

      let role = guild.roles.cache.find(r => r.name === roleName);
      if (!role && apply) {
        role = await guild.roles.create({
          name: roleName,
          color: '#ff6b6b',
          hoist: true,
          mentionable: true,
          reason: 'رتبة تركيز بومودورو',
        });
      }

      if (!role) return;

      for (const userId of userIds) {
        try {
          const member = await guild.members.fetch(userId);
          if (apply) {
            await member.roles.add(role, 'في جلسة تركيز بومودورو');
            // تغيير الاسم بإضافة رمز الطماطم
            if (member.nickname && !member.nickname.includes('🍅')) {
              await member.setNickname(`🍅 ${member.nickname}`, 'تحديد حالة التركيز');
            } else if (!member.nickname && !member.displayName.includes('🍅')) {
              await member.setNickname(`🍅 ${member.displayName}`, 'تحديد حالة التركيز');
            }
          } else {
            await member.roles.remove(role, 'انتهت جلسة التركيز');
            // إزالة رمز الطماطم من الاسم
            if (member.nickname && member.nickname.includes('🍅 ')) {
              await member.setNickname(member.nickname.replace('🍅 ', ''), 'انتهت فترة التركيز');
            }
          }
        } catch (e) {
          console.error(`خطأ في تحديث العضو ${userId}:`, e.message);
        }
      }
    } catch (e) {
      console.error('خطأ في تطبيق رتب التركيز:', e.message);
    }
  }

  /**
   * الحصول على جلسة نشطة في قناة معينة
   */
  getActiveSessionInChannel(guildId, channelId) {
    const sessions = db.getAllSessions(guildId);
    for (const sid of Object.keys(sessions)) {
      if (sessions[sid].channelId === channelId &&
          (sessions[sid].status === 'waiting' || sessions[sid].status === 'focus' || sessions[sid].status === 'break')) {
        return sessions[sid];
      }
    }
    return null;
  }

  /**
   * إيقاف جميع المؤقتات عند إغلاق البوت
   */
  stopAllTimers() {
    for (const [sessionId, timer] of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

module.exports = PomodoroManager;
