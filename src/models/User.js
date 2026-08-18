const crypto = require('crypto');
const levelsData = require('../../../gamification/levels.json');

const JWT_SECRET = process.env.JWT_SECRET || 'injaz_gamified_secure_key_2026';

class UserModel {
  constructor(db) {
    this.db = db;
  }

  // Password hashing helper using SHA-256 & salt
  hashPassword(password) {
    const salt = 'injaz_salt_';
    return crypto.createHash('sha256').update(salt + password).digest('hex');
  }

  // Generate lightweight JWT-like token (Header.Payload.Signature)
  generateToken(user) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  // Verify lightweight JWT-like token
  verifyToken(token) {
    try {
      if (!token) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [header, payload, signature] = parts;
      const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
      if (signature !== expectedSig) return null;

      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
        return null; // Expired
      }
      return decoded;
    } catch (e) {
      return null;
    }
  }

  // Register a new user
  register({ name, email, password, avatar = '⚡' }) {
    return new Promise((resolve, reject) => {
      const db = this.db;
      const normalizedEmail = (email || '').trim().toLowerCase();
      const userName = (name || 'Injaz Hero').trim();
      const passwordHash = this.hashPassword(password || '123456');

      // Check if user with this email already exists
      db.get(`SELECT id FROM users WHERE LOWER(email) = ?`, [normalizedEmail], (checkErr, existing) => {
        if (checkErr) return reject(checkErr);
        if (existing) {
          return reject(new Error('Email already registered'));
        }

        const sql = `
          INSERT INTO users (name, email, password_hash, avatar, xp, level, streak)
          VALUES (?, ?, ?, ?, 0, 1, 1)
        `;

        db.run(sql, [userName, normalizedEmail, passwordHash, avatar], function (err) {
          if (err) return reject(err);

          const userId = this.lastID;
          // Initialize stats
          db.run(`INSERT OR IGNORE INTO user_stats (user_id, total_tasks_created, total_tasks_completed, total_xp_earned) VALUES (?, 0, 0, 0)`, [userId]);

          // Create default onboarding task
          const welcomeTaskSql = `
            INSERT INTO tasks (user_id, title, description, difficulty, xp_reward, due_date)
            VALUES (?, ?, ?, ?, ?, ?)
          `;
          db.run(welcomeTaskSql, [
            userId,
            `أهلاً بك في تطبيق إنجاز يا ${userName}! 🎯`,
            'أكمل أول مهمة لك وابدأ في جمع نقاط الـ XP والترقية في الرتب.',
            'easy',
            50,
            null
          ]);

          const userObj = {
            id: userId,
            name: userName,
            email: normalizedEmail,
            avatar,
            xp: 0,
            level: 1,
            streak: 1
          };

          const token = UserModel.prototype.generateToken(userObj);
          resolve({ user: userObj, token });
        });
      });
    });
  }

  // Authenticate user by email/username and password
  authenticate(emailOrUsername, password) {
    return new Promise((resolve, reject) => {
      const normalized = (emailOrUsername || '').trim().toLowerCase();
      const passwordHash = this.hashPassword(password || '');

      const sql = `
        SELECT * FROM users 
        WHERE (LOWER(email) = ? OR LOWER(name) = ?)
      `;

      this.db.get(sql, [normalized, normalized], async (err, row) => {
        if (err) return reject(err);
        if (!row) {
          return reject(new Error('User not found'));
        }

        if (row.password_hash && row.password_hash !== passwordHash) {
          return reject(new Error('Invalid password'));
        }

        try {
          const user = await this.getUser(row.id);
          const token = this.generateToken(user);
          resolve({ user, token });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // Get user profile & stats
  getUser(userId = 1) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT u.id, u.name, u.email, u.avatar, u.xp, u.level, u.streak, u.last_active, u.created_at,
               COALESCE(s.total_tasks_created, 0) as total_tasks_created, 
               COALESCE(s.total_tasks_completed, 0) as total_tasks_completed, 
               COALESCE(s.total_xp_earned, 0) as total_xp_earned
        FROM users u
        LEFT JOIN user_stats s ON u.id = s.user_id
        WHERE u.id = ?
      `;
      this.db.get(sql, [userId], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        
        // Calculate level details
        const levelInfo = this.calculateLevel(row.xp || 0);
        resolve({
          ...row,
          level: levelInfo.currentLevel.level,
          title: levelInfo.currentLevel.title,
          titleAr: levelInfo.currentLevel.titleAr,
          badge: levelInfo.currentLevel.badge,
          color: levelInfo.currentLevel.color,
          nextLevelXP: levelInfo.nextLevel ? levelInfo.nextLevel.minXP : row.xp,
          currentLevelMinXP: levelInfo.currentLevel.minXP,
          progress: levelInfo.progressPercentage
        });
      });
    });
  }

  // Add or deduct XP to user and update level/streak
  addXP(userId = 1, xpAmount) {
    return new Promise(async (resolve, reject) => {
      try {
        const user = await this.getUser(userId);
        if (!user) return reject(new Error('User not found'));

        const newXP = Math.max(0, user.xp + xpAmount);
        const levelInfo = this.calculateLevel(newXP);
        const newLevel = levelInfo.currentLevel.level;
        const leveledUp = newLevel > user.level;

        const sql = `
          UPDATE users 
          SET xp = ?, level = ?
          WHERE id = ?
        `;
        
        this.db.run(sql, [newXP, newLevel, userId], (err) => {
          if (err) return reject(err);

          // Update user_stats
          const statsSql = `
            UPDATE user_stats 
            SET total_xp_earned = MAX(0, total_xp_earned + ?),
                total_tasks_completed = MAX(0, total_tasks_completed + ?)
            WHERE user_id = ?
          `;
          const taskIncrement = xpAmount > 0 ? 1 : -1;
          this.db.run(statsSql, [xpAmount, taskIncrement, userId], (statsErr) => {
            if (statsErr) return reject(statsErr);

            resolve({
              xp: newXP,
              xpEarned: xpAmount,
              level: newLevel,
              leveledUp,
              levelInfo
            });
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Helper method to compute level from total XP
  calculateLevel(xp) {
    const levels = levelsData.levels;
    let currentLevel = levels[0];
    let nextLevel = levels[1] || null;

    for (let i = 0; i < levels.length; i++) {
      if (xp >= levels[i].minXP) {
        currentLevel = levels[i];
        nextLevel = levels[i + 1] || null;
      } else {
        break;
      }
    }

    let progressPercentage = 100;
    if (nextLevel) {
      const currentLevelRange = nextLevel.minXP - currentLevel.minXP;
      const userXPInCurrentRange = xp - currentLevel.minXP;
      progressPercentage = Math.min(
        100,
        Math.max(0, Math.floor((userXPInCurrentRange / currentLevelRange) * 100))
      );
    }

    return {
      currentLevel,
      nextLevel,
      progressPercentage
    };
  }
}

module.exports = UserModel;
