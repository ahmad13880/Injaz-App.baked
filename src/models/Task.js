const levelsData = require('../../../gamification/levels.json');

class TaskModel {
  constructor(db) {
    this.db = db;
  }

  // Get all tasks for a user
  getAll(userId = 1) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM tasks WHERE user_id = ? ORDER BY completed ASC, created_at DESC`;
      this.db.all(sql, [userId], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  // Get single task by ID
  getById(id, userId = 1) {
    return new Promise((resolve, reject) => {
      const sql = `SELECT * FROM tasks WHERE id = ? AND user_id = ?`;
      this.db.get(sql, [id, userId], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  // Create new task
  create(taskData, userId = 1) {
    return new Promise((resolve, reject) => {
      const db = this.db;
      const { title, description = '', difficulty = 'medium', due_date = null, subtasks = '[]' } = taskData;
      
      // Calculate XP reward based on difficulty
      const diffConfig = levelsData.difficulties[difficulty] || levelsData.difficulties.medium;
      const xp_reward = diffConfig.xp;
      const subtasksString = typeof subtasks === 'string' ? subtasks : JSON.stringify(subtasks || []);

      const sql = `
        INSERT INTO tasks (user_id, title, description, difficulty, xp_reward, due_date, subtasks)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      db.run(sql, [userId, title, description, difficulty, xp_reward, due_date, subtasksString], function (err) {
        if (err) return reject(err);

        const taskId = this.lastID;
        
        // Update user stats total tasks created
        const statsSql = `UPDATE user_stats SET total_tasks_created = total_tasks_created + 1 WHERE user_id = ?`;
        db.run(statsSql, [userId]);

        resolve({
          id: taskId,
          user_id: userId,
          title,
          description,
          difficulty,
          xp_reward,
          completed: 0,
          due_date,
          subtasks: subtasksString,
          created_at: new Date().toISOString()
        });
      });
    });
  }

  // Toggle completion status of a task
  toggleComplete(id, userId = 1) {
    return new Promise(async (resolve, reject) => {
      try {
        const task = await this.getById(id, userId);
        if (!task) return reject(new Error('Task not found'));

        const newStatus = task.completed === 1 ? 0 : 1;
        const completedAt = newStatus === 1 ? new Date().toISOString() : null;

        const sql = `UPDATE tasks SET completed = ?, completed_at = ? WHERE id = ? AND user_id = ?`;
        this.db.run(sql, [newStatus, completedAt, id, userId], (err) => {
          if (err) return reject(err);
          resolve({
            ...task,
            completed: newStatus,
            completed_at: completedAt
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Update subtasks of a task
  updateSubtasks(id, subtasks, userId = 1) {
    return new Promise((resolve, reject) => {
      const subtasksString = typeof subtasks === 'string' ? subtasks : JSON.stringify(subtasks || []);
      const sql = `UPDATE tasks SET subtasks = ? WHERE id = ? AND user_id = ?`;
      this.db.run(sql, [subtasksString, id, userId], function (err) {
        if (err) return reject(err);
        resolve({ success: this.changes > 0, subtasks: subtasksString });
      });
    });
  }

  // Delete a task
  delete(id, userId = 1) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM tasks WHERE id = ? AND user_id = ?`;
      this.db.run(sql, [id, userId], function (err) {
        if (err) return reject(err);
        resolve({ success: this.changes > 0 });
      });
    });
  }

  // Delete all tasks for a user
  deleteAll(userId = 1) {
    return new Promise((resolve, reject) => {
      const sql = `DELETE FROM tasks WHERE user_id = ?`;
      this.db.run(sql, [userId], function (err) {
        if (err) return reject(err);
        resolve({ success: true, count: this.changes });
      });
    });
  }
}

module.exports = TaskModel;
