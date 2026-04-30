const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

// 初始化数据库
const db = new Database('./projects.db');

// 主项目表
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

// 项目子项表
db.exec(`
  CREATE TABLE IF NOT EXISTS project_phases (
    id TEXT PRIMARY KEY,
    projectId TEXT,
    phaseName TEXT,
    phaseType TEXT,
    progress INTEGER DEFAULT 0,
    remarks TEXT,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  )
`);

// 初始化服务
const app = express();
app.use(cors());
app.use(express.json());

// 托管前端页面，解决线上Cannot GET问题
app.use(express.static(path.join(__dirname, '.')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// 工作量权重（贴合设计行业，施工图权重更高）
const WORK_WEIGHT = {
  "方案": 1.0,
  "初步设计": 1.2,
  "施工图": 1.5
};

// 默认演示数据
const defaultProjects = [
    { id: '1', projectName: '江东新区城市设计', leader: '张建国', designer: '李思思,王明远', startDate: '2025-01-10', endDate: '2025-04-20', actualEndDate: '', progressPercent: 65, remarks: '方案深化阶段，等待业主确认' },
    { id: '2', projectName: '滨江景观桥工程', leader: '陈敏华', designer: '赵一航', startDate: '2025-02-01', endDate: '2025-05-15', actualEndDate: '', progressPercent: 30, remarks: '初设阶段，地勘完成' },
    { id: '3', projectName: '科技园总部基地', leader: '刘子轩', designer: '李思思,周雅', startDate: '2024-12-01', endDate: '2025-03-01', actualEndDate: '2025-02-28', progressPercent: 100, remarks: '提前交付，验收通过' },
    { id: '4', projectName: '轨道交通枢纽改造', leader: '王宏', designer: '吴启航,林芳', startDate: '2024-10-10', endDate: '2025-02-10', actualEndDate: '', progressPercent: 85, remarks: '收尾阶段，超期风险注意' },
    { id: '5', projectName: '海绵城市示范区', leader: '陈敏华', designer: '郑秋怡', startDate: '2025-03-01', endDate: '2025-07-20', actualEndDate: '', progressPercent: 20, remarks: '初步设计' }
];

const defaultPhases = [
    { id: 'p1-1', projectId: '1', phaseName: '方案阶段-总平图', phaseType: '方案', progress: 100, remarks: '已完成初稿，待评审' },
    { id: 'p1-2', projectId: '1', phaseName: '方案阶段-效果图', phaseType: '方案', progress: 60, remarks: '正在渲染' },
    { id: 'p1-3', projectId: '1', phaseName: '初步设计-建筑专业', phaseType: '初步设计', progress: 40, remarks: '正在细化指标' },
    { id: 'p2-1', projectId: '2', phaseName: '初步设计-地勘报告', phaseType: '初步设计', progress: 100, remarks: '地勘完成' },
    { id: 'p2-2', projectId: '2', phaseName: '初步设计-结构计算', phaseType: '初步设计', progress: 30, remarks: '正在出图' },
    { id: 'p2-3', projectId: '2', phaseName: '施工图-结构', phaseType: '施工图', progress: 0, remarks: '未开始' },
    { id: 'p2-4', projectId: '2', phaseName: '施工图-水', phaseType: '施工图', progress: 0, remarks: '未开始' },
    { id: 'p3-1', projectId: '3', phaseName: '方案阶段', phaseType: '方案', progress: 100, remarks: '验收通过' },
    { id: 'p3-2', projectId: '3', phaseName: '初步设计阶段', phaseType: '初步设计', progress: 100, remarks: '验收通过' },
    { id: 'p3-3', projectId: '3', phaseName: '施工图-结构', phaseType: '施工图', progress: 100, remarks: '验收通过' },
    { id: 'p3-4', projectId: '3', phaseName: '施工图-电', phaseType: '施工图', progress: 100, remarks: '验收通过' },
    { id: 'p3-5', projectId: '3', phaseName: '施工图-暖通', phaseType: '施工图', progress: 100, remarks: '验收通过' },
];

// 初始化数据接口
app.get('/api/init', (req, res) => {
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM project_phases').run();

    const insertProject = db.prepare(`
        INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    defaultProjects.forEach(p => insertProject.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks));

    const insertPhase = db.prepare(`
        INSERT INTO project_phases (id, projectId, phaseName, phaseType, progress, remarks)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    defaultPhases.forEach(p => insertPhase.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.remarks));

    io.emit('data-updated');
    res.json({ success: true, message: "初始化完成，含演示项目阶段数据" });
});

// 获取所有项目
app.get('/api/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects').all());
});

// 获取单个项目详情
app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const phases = db.prepare('SELECT * FROM project_phases WHERE projectId = ?').all(req.params.id);
  res.json({ ...project, phases });
});

// 同步项目与子项
app.post('/api/projects/sync', (req, res) => {
  const { projects, phases } = req.body;
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM project_phases').run();

  const pStmt = db.prepare(`INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const phStmt = db.prepare(`INSERT INTO project_phases (id, projectId, phaseName, phaseType, progress, remarks) VALUES (?, ?, ?, ?, ?, ?)`);

  if (projects) projects.forEach(p => pStmt.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks));
  if (phases) phases.forEach(p => phStmt.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.remarks));

  io.emit('data-updated');
  res.json({ success: true });
});

// 子项相关接口
app.get('/api/projects/:projectId/phases', (req, res) => {
  res.json(db.prepare('SELECT * FROM project_phases WHERE projectId = ?').all(req.params.projectId));
});

app.get('/api/projects/all/phases', (req, res) => {
  res.json(db.prepare('SELECT * FROM project_phases').all());
});

app.post('/api/phases/save', (req, res) => {
  const p = req.body;
  db.prepare(`INSERT OR REPLACE INTO project_phases (id, projectId, phaseName, phaseType, progress, remarks) VALUES (?, ?, ?, ?, ?, ?)`).run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.remarks);
  io.emit('data-updated');
  res.json({ success: true });
});

app.delete('/api/phases/:id', (req, res) => {
  db.prepare('DELETE FROM project_phases WHERE id = ?').run(req.params.id);
  io.emit('data-updated');
  res.json({ success: true });
});

// 负责人统计接口
app.get('/api/stats/leader', (req, res) => {
  const stats = db.prepare(`
    SELECT leader,
    COUNT(id) as totalProjects,
    SUM(CASE WHEN progressPercent=100 THEN 1 ELSE 0 END) as completedProjects,
    SUM(CASE WHEN progressPercent>0 AND progressPercent<100 THEN 1 ELSE 0 END) as inProgressProjects,
    SUM(CASE WHEN progressPercent<100 AND endDate < DATE('now') THEN 1 ELSE 0 END) as overdueProjects,
    ROUND(AVG(progressPercent),2) as avgProgress,
    (SELECT COUNT(*) FROM project_phases WHERE projectId=projects.id) as totalPhases
    FROM projects GROUP BY leader ORDER BY totalProjects DESC
  `).all();

  const result = stats.map(i => ({
    ...i,
    completeRate: i.totalProjects ? Math.round(i.completedProjects/i.totalProjects*100) : 0,
    overdueRate: i.totalProjects ? Math.round(i.overdueProjects/i.totalProjects*100) : 0
  }));
  res.json(result);
});

// 设计师统计接口
app.get('/api/stats/designer', (req, res) => {
  const list = db.prepare(`
    WITH split_designers AS (
      SELECT id as projectId, TRIM(value) as designer, progressPercent, endDate
      FROM projects, json_each('["'||replace(designer,',','","')||'"]')
    )
    SELECT designer,
    COUNT(DISTINCT projectId) as joinProjects,
    SUM(CASE WHEN progressPercent=100 THEN 1 ELSE 0 END) as completedProjects,
    SUM(CASE WHEN progressPercent>0 AND progressPercent<100 THEN 1 ELSE 0 END) as inProgressProjects,
    SUM(CASE WHEN progressPercent<100 AND endDate<DATE('now') THEN 1 ELSE 0 END) as overdueProjects,
    ROUND(AVG(progressPercent),2) as avgProgress
    FROM split_designers WHERE designer!='' GROUP BY designer
  `).all();

  const result = list.map(item => {
    const phases = db.prepare(`
      SELECT phaseType, COUNT(*) as cnt FROM project_phases
      JOIN projects p ON p.id=project_phases.projectId
      WHERE p.designer LIKE ? GROUP BY phaseType
    `).all(`%${item.designer}%`);

    let score = 0;
    phases.forEach(p => score += p.cnt * (WORK_WEIGHT[p.phaseType]||1));

    return {
      ...item,
      completeRate: item.joinProjects ? Math.round(item.completedProjects/item.joinProjects*100) : 0,
      overdueRate: item.joinProjects ? Math.round(item.overdueProjects/item.joinProjects*100) : 0,
      workScore: Math.round(score*100)/100,
      totalPhases: phases.reduce((s,p)=>s+p.cnt,0),
      phaseDetail: phases
    };
  });
  res.json(result);
});

// 设计师子项明细接口
app.get('/api/stats/designer/:name/phase', (req, res) => {
  res.json(db.prepare(`
    SELECT pp.*, p.projectName, p.leader FROM project_phases pp
    JOIN projects p ON pp.projectId=p.id
    WHERE p.designer LIKE ?
  `).all(`%${req.params.name}%`));
});

// 全局汇总统计接口
app.get('/api/stats/summary', (req, res) => {
  res.json(db.prepare(`
    SELECT COUNT(*) as totalProjects,
    SUM(CASE WHEN progressPercent=100 THEN 1 ELSE 0 END) as totalCompleted,
    COUNT(DISTINCT leader) as totalLeaders,
    (SELECT COUNT(DISTINCT TRIM(value)) FROM projects, json_each('["'||replace(designer,',','","')||'"]') WHERE TRIM(value)!='') as totalDesigners,
    (SELECT COUNT(*) FROM project_phases) as totalPhases
    FROM projects
  `).get());
});

// 启动服务
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log('服务已启动，端口：' + PORT);
  console.log('首次使用请访问 /api/init 初始化演示数据');
});
