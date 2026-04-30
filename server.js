const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

// 1. 初始化数据库 (自动创建 projects.db 文件)
const db = new Database('./projects.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    projectName TEXT,
    leader TEXT,
    designer TEXT,
    startDate TEXT,
    endDate TEXT,
    actualEndDate TEXT,
    progressPercent INTEGER,
    remarks TEXT
  )
`);

// 2. 初始化服务
const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 默认演示数据
const defaultProjects = [
    { id: '1', projectName: '江东新区城市设计', leader: '张建国', designer: '李思思,王明远', startDate: '2025-01-10', endDate: '2025-04-20', actualEndDate: '', progressPercent: 65, remarks: '方案深化阶段，等待业主确认' },
    { id: '2', projectName: '滨江景观桥工程', leader: '陈敏华', designer: '赵一航', startDate: '2025-02-01', endDate: '2025-05-15', actualEndDate: '', progressPercent: 30, remarks: '初设阶段，地勘完成' },
    { id: '3', projectName: '科技园总部基地', leader: '刘子轩', designer: '李思思,周雅', startDate: '2024-12-01', endDate: '2025-03-01', actualEndDate: '2025-02-28', progressPercent: 100, remarks: '提前交付，验收通过' },
    { id: '4', projectName: '轨道交通枢纽改造', leader: '王宏', designer: '吴启航,林芳', startDate: '2024-10-10', endDate: '2025-02-10', actualEndDate: '', progressPercent: 85, remarks: '收尾阶段，超期风险注意' },
    { id: '5', projectName: '海绵城市示范区', leader: '陈敏华', designer: '郑秋怡', startDate: '2025-03-01', endDate: '2025-07-20', actualEndDate: '', progressPercent: 20, remarks: '初步设计' }
];

// 3. API 接口
// 获取所有项目
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects').all();
  res.json(projects);
});

// 初始化数据接口（仅用于第一次运行）
app.get('/api/init', (req, res) => {
    const insert = db.prepare(`
        INSERT OR REPLACE INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    defaultProjects.forEach(p => {
        insert.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks);
    });
    io.emit('data-updated');
    res.json({ success: true, message: "数据已重置为演示数据" });
});

// 新增/更新项目 (覆盖式保存)
app.post('/api/projects/sync', (req, res) => {
  const projects = req.body;
  // 清空旧数据
  db.prepare('DELETE FROM projects').run();
  // 批量插入新数据
  if(projects && projects.length > 0) {
      const insert = db.prepare(`
        INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      projects.forEach(p => {
        insert.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks);
      });
  }
  // 通知所有客户端：数据更新了
  io.emit('data-updated');
  res.json({ success: true });
});

// 4. 启动服务
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n✅ 后端服务已启动`);
  console.log(`📡 本地地址: http://localhost:${PORT}`);
  console.log(`💡 首次使用请访问: http://localhost:${PORT}/api/init 初始化数据`);
});