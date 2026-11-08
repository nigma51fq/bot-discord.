const { EmbedBuilder } = require('discord.js');
const db = require('../database');

/**
 * مدير السلاسل اليومية (Streaks) والأوسمة (Badges)
 */
class StreakManager {
  constructor(client) {
    this.client = client;

    // تعريف الأوسمة بناءً على إجمالي ساعات التركيز
    this.badges = [
      { hours: 0, name: 'مبتدئ تركيز', emoji: '🌱', roleName: '🌱 مبتدئ تركيز' },
      { hours: 10, name: 'متركز ممارس', emoji: '📚', roleName: '📚 متركز ممارس' },
      { hours: 25, name: 'محترف تركيز', emoji: '🍅', roleName: '🍅 محترف تركيز' },
      { hours: 50, name: 'خبير انضباط', emoji: '🏆', roleName: '🏆 خبير انضباط' },
      { hours: 100, name: 'أسطورة الانضباط', emoji: '👑', roleName: '👑 أسطورة الانضباط' },
      { hours: 200, name: 'إمبراطور التركيز', emoji: '👑⚡', roleName: '👑⚡ إمبراطور التركيز' },
    ];
  }

  /**
   * تسجيل إكمال جلسة تركيز لمستخدم وتحديث السلسلة اليومية
   */
  async recordSession(guildId, userId, minutes) {
    const userData = db.getUserData(guildId, userId);
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

    // تحديث السلسلة اليومية
    if (userData.lastSessionDate === today) {
      // déjà session today - streak unchanged
    } else if (userData.lastSessionDate === yesterday) {
      // streak continues
      userData.streak += 1;
    } else {
      // streak reset
      userData.streak = 1;
    }

    userData.lastSessionDate = today;
    userData.totalFocusMinutes += minutes;

    // تحديد الوسام الجديد بناءً على الساعات
    const totalHours = userData.totalFocusMinutes / 60;
    const newBadge = this._getBadgeForHours(totalHours);

    if (newBadge && !userData.badges.includes(newBadge.roleName)) {
      userData.badges.push(newBadge.roleName);
      await this._assignBadgeRole(guildId, userId, newBadge);
    }

    db.saveUserData(guildId, userId, userData);

    return {
      streak: userData.streak,
      totalMinutes: userData.totalFocusMinutes,
      totalHours: totalHours.toFixed(2),
      badge: newBadge,
      isNewBadge: !!newBadge && userData.badges.includes(newBadge.roleName) && userData.badges.length > 0,
    };
  }

  /**
   * الحصول على الوسام المناسب لعدد الساعات
   */
  _getBadgeForHours(hours) {
    let currentBadge = null;
    for (const badge of this.badges) {
      if (hours >= badge.hours) {
        currentBadge = badge;
      } else {
        break;
      }
    }
    return currentBadge;
  }

  /**
   * تعيين دور الوسام للعضو
   */
  async _assignBadgeRole(guildId, userId, badge) {
    try {
      const guild = await this.client.guilds.fetch(guildId);

      // البحث عن الدور أو إنشاؤه
      let role = guild.roles.cache.find(r => r.name === badge.roleName);
      if (!role) {
        role = await guild.roles.create({
          name: badge.roleName,
          color: this._getBadgeColor(badge.emoji),
          hoist: true,
          mentionable: true,
          reason: `وسام 집중: ${badge.name}`,
        });
      }

      const member = await guild.members.fetch(userId);
      await member.roles.add(role, `حصل على وسام: ${badge.name}`);
    } catch (e) {
      console.error(`خطأ في تعيين دور الوسام ${badge.roleName} للعضو ${userId}:`, e.message);
    }
  }

  _getBadgeColor(emoji) {
    const colors = {
      '🌱': '#8bc34a',
      '📚': '#3f51b5',
      '🍅': '#ff6b6b',
      '🏆': '#ffd700',
      '👑': '#9b59b6',
      '👑⚡': '#e74c3c',
    };
    return colors[emoji] || '#95a5a6';
  }

  /**
   * الحصول على ملف تعريف المستخدم مع معلومات السلسلة والوسامات
   */
  getUserProfile(guildId, userId) {
    const userData = db.getUserData(guildId, userId);
    const totalHours = (userData.totalFocusMinutes || 0) / 60;
    const currentBadge = this._getBadgeForHours(totalHours);

    return {
      streak: userData.streak || 0,
      lastSessionDate: userData.lastSessionDate,
      totalFocusMinutes: userData.totalFocusMinutes || 0,
      totalHours: totalHours.toFixed(2),
      badges: userData.badges || [],
      sessions: userData.sessions || 0,
      currentBadge,
      nextBadge: this._getNextBadge(totalHours),
    };
  }

  _getNextBadge(currentHours) {
    for (const badge of this.badges) {
      if (currentHours < badge.hours) {
        return badge;
      }
    }
    return null;
  }

  /**
   * الحصول على إحصائيات الخادم الإجمالية
   */
  getServerStats(guildId) {
    const stats = db.getStats(guildId);
    const users = db._load(guildId).users || {};

    let totalStreak = 0;
    let maxStreak = 0;
    let topStreakUser = null;
    let topFocusUser = null;

    for (const [uid, data] of Object.entries(users)) {
      totalStreak += data.streak || 0;
      if ((data.streak || 0) > (maxStreak || 0)) {
        maxStreak = data.streak || 0;
        topStreakUser = uid;
      }
      if ((data.totalFocusMinutes || 0) > (topFocusUser ? users[topFocusUser].totalFocusMinutes || 0 : 0)) {
        topFocusUser = uid;
      }
    }

    return {
      ...stats,
      averageStreak: users.length > 0 ? (totalStreak / Object.keys(users).length).toFixed(1) : 0,
      maxStreak,
      topStreakUser,
      topFocusUser,
    };
  }

  /**
   * إنشاء نافذة معلومات المستخدم (embed)
   */
  createProfileEmbed(user, profile, guild) {
    const streakStatus = profile.streak >= 7 ? '🔥' : profile.streak >= 3 ? '⚡' : '📅';
    const badgeText = profile.badges.length > 0
      ? profile.badges.join('\n')
      : 'لا يوجد أوسمة بعد';

    const nextBadgeText = profile.nextBadge
      ? `التالي: ${profile.nextBadge.emoji} ${profile.nextBadge.name} (يحتاج ${(profile.nextBadge.hours - parseFloat(profile.totalHours)).toFixed(2)} ساعة إضافية)`
      : 'لقد حصلت على جميع الأوسمة! 🎉';

    return new EmbedBuilder()
      .setColor('#7289da')
      .setTitle(`${streakStatus} ملف التركيز - ${user.displayName}`)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: '🔥 السلسلة اليومية', value: `${profile.streak} يوم`, inline: true },
        { name: '⏱️ إجمالي الساعات', value: `${profile.totalHours} ساعة`, inline: true },
        { name: '🍅 عدد الجلسات', value: profile.sessions.toString(), inline: true },
        { name: '🏅 الوسامات الحالية', value: badgeText, inline: false },
        { name: '🎯 الوسام التالي', value: nextBadgeText, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'بوت بومودورو الدراسي', iconURL: guild.iconURL() });
  }
}

module.exports = StreakManager;
