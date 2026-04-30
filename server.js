const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');

// 1. 初始化服务
const app = express();
const PORT = process.env.PORT || 3001;

// 核心配置：跨域 + 解析JSON + 托管根目录所有文件（访问根路径自动打开index.html）
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static('./'));

// 创建HTTP服务 + Socket.io实时通信
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 2. 初始化数据库（兼容Railway的文件系统）
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

// 3. 默认演示数据
const defaultProjects = [
    { id: '1', projectName: '江东新区城市设计', leader: '张建国', designer: '李思思,王明远', startDate: '2025-01-10', endDate: '2025-04-20', actualEndDate: '', progressPercent: 65, remarks: '方案深化阶段，等待业主确认' },
    { id: '2', projectName: '滨江景观桥工程', leader: '陈敏华', designer: '赵一航', startDate: '2025-02-01', endDate: '2025-05-15', actualEndDate: '', progressPercent: 30, remarks: '初设阶段，地勘完成' },
    { id: '3', projectName: '科技园总部基地', leader: '刘子轩', designer: '李思思,周雅', startDate: '2024-12-01', endDate: '2025-03-01', actualEndDate: '2025-02-28', progressPercent: 100, remarks: '提前交付，验收通过' },
    { id: '4', projectName: '轨道交通枢纽改造', leader: '王宏', designer: '吴启航,林芳', startDate: '2024-10-10', endDate: '2025-02-10', actualEndDate: '', progressPercent: 85, remarks: '收尾阶段，超期风险注意' },
    { id: '5', projectName: '海绵城市示范区', leader: '陈敏华', designer: '郑秋怡', startDate: '2025-03-01', endDate: '2025-07-20', actualEndDate: '', progressPercent: 20, remarks: '初步设计' }
];

// 4. 接口配置
// 根路径：直接返回index.html（双重保险，彻底解决Cannot GET /）
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: './' });
});

// 获取所有项目
app.get('/api/projects', (req, res) => {
  try {
    const projects = db.prepare('SELECT * FROM projects').all();
    res.json(projects);
  } catch (e) {
    res.json([]);
  }
});

// 初始化演示数据
app.get('/api/init', (req, res) => {
  try {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    defaultProjects.forEach(p => {
      insert.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks);
    });
    io.emit('data-updated');
    res.json({ success: true, message: "✅ 数据初始化成功！返回上一页刷新即可使用系统" });
  } catch (e) {
    res.status(500).json({ success: false, message: "初始化失败", error: e.message });
  }
});

// 同步项目数据
app.post('/api/projects/sync', (req, res) => {
  try {
    const projects = req.body;
    db.prepare('DELETE FROM projects').run();
    if (projects && projects.length > 0) {
      const insert = db.prepare(`
        INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      projects.forEach(p => {
        insert.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks);
      });
    }
    io.emit('data-updated');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 5. 启动服务（兼容Railway的端口和IP绑定）
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 服务启动成功！运行端口：${PORT}`);
  console.log(`🌐 访问地址：http://localhost:${PORT}`);
});
