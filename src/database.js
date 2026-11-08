const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * قاعدة بيانات بسيطة مبنية على ملفات JSON
 * تخزن بيانات المستخدمين، الجلسات، والسلاسل اليومية لكل خادم
 */
class Database {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    this.cache = new Map();
  }

  _getFilePath(guildId) {
    return path.join(DATA_DIR, `${guildId}.json`);
  }

  _load(guildId) {
    if (this.cache.has(guildId)) {
      return this.cache.get(guildId);
    }

    const filePath = this._getFilePath(guildId);
    let data = {};

    if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {
        console.error(`خطأ في قراءة ملف بيانات الخادم ${guildId}:`, e.message);
        data = {};
      }
    }

    // هيكل البيانات الافتراضي
    const defaultData = {
      users: {},        // userId -> { streak, lastSessionDate, totalFocusMinutes, badges, sessions }
      sessions: {},     // sessionId -> { channelId, members: [userId], status, startTime, endTime, type }
      settings: {
        focusMinutes: 25,
        breakMinutes: 5,
        focusRoleName: '🍅 Focused',
        notificationChannelId: null,
      },
    };

    data = { ...defaultData, ...data };
    this.cache.set(guildId, data);
    return data;
  }

  _save(guildId) {
    const data = this.cache.get(guildId);
    if (!data) return;

    const filePath = this._getFilePath(guildId);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`خطأ في حفظ بيانات الخادم ${guildId}:`, e.message);
    }
  }

  getUserData(guildId, userId) {
    const data = this._load(guildId);
    if (!data.users[userId]) {
      data.users[userId] = {
        streak: 0,
        lastSessionDate: null,
        totalFocusMinutes: 0,
        badges: [],
        sessions: 0,
      };
      this._save(guildId);
    }
    return data.users[userId];
  }

  saveUserData(guildId, userId, userData) {
    const data = this._load(guildId);
    data.users[userId] = userData;
    this._save(guildId);
  }

  getSession(guildId, sessionId) {
    const data = this._load(guildId);
    return data.sessions[sessionId] || null;
  }

  saveSession(guildId, sessionId, sessionData) {
    const data = this._load(guildId);
    data.sessions[sessionId] = sessionData;
    this._save(guildId);
  }

  deleteSession(guildId, sessionId) {
    const data = this._load(guildId);
    delete data.sessions[sessionId];
    this._save(guildId);
  }

  getAllSessions(guildId) {
    const data = this._load(guildId);
    return data.sessions || {};
  }

  getSettings(guildId) {
    const data = this._load(guildId);
    return data.settings || {};
  }

  saveSettings(guildId, settings) {
    const data = this._load(guildId);
    data.settings = { ...data.settings, ...settings };
    this._save(guildId);
  }

  getStats(guildId) {
    const data = this._load(guildId);
    const users = data.users || {};
    const sessions = data.sessions || {};

    let totalFocusMinutes = 0;
    let totalSessions = 0;
    let activeSessions = 0;

    for (const uid of Object.keys(users)) {
      totalFocusMinutes += users[uid].totalFocusMinutes || 0;
      totalSessions += users[uid].sessions || 0;
    }

    for (const sid of Object.keys(sessions)) {
      if (sessions[sid].status === 'active') {
        activeSessions++;
      }
    }

    return {
      totalUsers: Object.keys(users).length,
      totalFocusMinutes,
      totalSessions,
      activeSessions,
      totalFocusHours: (totalFocusMinutes / 60).toFixed(2),
    };
  }
}

module.exports = new Database();
