const express = require('express');
const router = express.Router();
const levelsData = require('../../../gamification/levels.json');
const UserModel = require('../models/User');
const TaskModel = require('../models/Task');

module.exports = (db) => {
  const User = new UserModel(db);
  const Task = new TaskModel(db);

  // Authentication Middleware
  const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = User.verifyToken(token);
      if (decoded && decoded.id) {
        req.user = decoded;
        return next();
      }
    }

    // Optional query/header userId fallback or default guest/champion user ID
    const customUserId = req.headers['x-user-id'] || req.query.user_id;
    if (customUserId) {
      req.user = { id: parseInt(customUserId, 10) || 1 };
      return next();
    }

    // Default to user ID 1 for backward compatibility
    req.user = { id: 1 };
    next();
  };

  // 📝 POST /api/auth/register
  router.post('/auth/register', async (req, res) => {
    try {
      const { name, email, password, avatar } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
      }

      const result = await User.register({ name, email, password, avatar });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // 🔑 POST /api/auth/login
  router.post('/auth/login', async (req, res) => {
    try {
      const { email, username, password } = req.body;
      const identifier = email || username;
      if (!identifier || !password) {
        return res.status(400).json({ error: 'Email/Username and password are required' });
      }

      const result = await User.authenticate(identifier, password);
      res.json(result);
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  });

  // 👤 GET /api/auth/me (Current Authenticated User)
  router.get('/auth/me', authMiddleware, async (req, res) => {
    try {
      const user = await User.getUser(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 👤 GET /api/user (Legacy / Direct access)
  router.get('/user', authMiddleware, async (req, res) => {
    try {
      const user = await User.getUser(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 🎮 GET /api/levels
  router.get('/levels', (req, res) => {
    res.json(levelsData);
  });

  // 📋 GET /api/tasks
  router.get('/tasks', authMiddleware, async (req, res) => {
    try {
      const tasks = await Task.getAll(req.user.id);
      res.json(tasks);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ➕ POST /api/tasks
  router.post('/tasks', authMiddleware, async (req, res) => {
    try {
      const { title, description, difficulty, due_date, subtasks } = req.body;
      if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Task title is required' });
      }

      const newTask = await Task.create(
        { title: title.trim(), description, difficulty, due_date, subtasks },
        req.user.id
      );
      res.status(201).json(newTask);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ✅ PATCH /api/tasks/:id/complete
  router.patch('/tasks/:id/complete', authMiddleware, async (req, res) => {
    try {
      const taskId = req.params.id;
      const updatedTask = await Task.toggleComplete(taskId, req.user.id);

      let xpResult = null;
      if (updatedTask.completed === 1) {
        xpResult = await User.addXP(req.user.id, updatedTask.xp_reward);
      } else {
        // Deduct XP if task was uncompleted
        xpResult = await User.addXP(req.user.id, -updatedTask.xp_reward);
      }

      res.json({
        task: updatedTask,
        xpAwarded: updatedTask.completed === 1 ? updatedTask.xp_reward : -updatedTask.xp_reward,
        xpResult
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 📝 PATCH /api/tasks/:id/subtasks
  router.patch('/tasks/:id/subtasks', authMiddleware, async (req, res) => {
    try {
      const taskId = req.params.id;
      const { subtasks } = req.body;
      const result = await Task.updateSubtasks(taskId, subtasks, req.user.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 🗑️ DELETE /api/tasks/all
  router.delete('/tasks/all', authMiddleware, async (req, res) => {
    try {
      const result = await Task.deleteAll(req.user.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 🗑️ DELETE /api/tasks/:id
  router.delete('/tasks/:id', authMiddleware, async (req, res) => {
    try {
      const taskId = req.params.id;
      const result = await Task.delete(taskId, req.user.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
