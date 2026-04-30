const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

// 1. 初始化数据库 (自动创建 projects.db 文件)
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

// 2. 初始化服务
const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 【关键修复】托管前端静态文件
// ==========================================
// 确保 index.html 能被访问
app.use(express.static(path.join(__dirname, '.')));

// 访问根路径 (https://你的域名/) 时直接返回 index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 工作量权重配置
const WORK_WEIGHT = {
  "方案": 1.0,
  "初步设计": 1.2,
  "施工图": 1.5
};

// 默认演示数据（主项目）
const defaultProjects = [
    { id: '1', projectName: '江东新区城市设计', leader: '张建国', designer: '李思思,王明远', startDate: '2025-01-10', endDate: '2025-04-20', actualEndDate: '', progressPercent: 65, remarks: '方案深化阶段，等待业主确认' },
    { id: '2', projectName: '滨江景观桥工程', leader: '陈敏华', designer: '赵一航', startDate: '2025-02-01', endDate: '2025-05-15', actualEndDate: '', progressPercent: 30, remarks: '初设阶段，地勘完成' },
    { id: '3', projectName: '科技园总部基地', leader: '刘子轩', designer: '李思思,周雅', startDate: '2024-12-01', endDate: '2025-03-01', actualEndDate: '2025-02-28', progressPercent: 100, remarks: '提前交付，验收通过' },
    { id: '4', projectName: '轨道交通枢纽改造', leader: '王宏', designer: '吴启航,林芳', startDate: '2024-10-10', endDate: '2025-02-10', actualEndDate: '', progressPercent: 85, remarks: '收尾阶段，超期风险注意' },
    { id: '5', projectName: '海绵城市示范区', leader: '陈敏华', designer: '郑秋怡', startDate: '2025-03-01', endDate: '2025-07-20', actualEndDate: '', progressPercent: 20, remarks: '初步设计' }
];
// 默认子项数据
const defaultPhases = [
    { id: 'p1-1', projectId: '1', phaseName: '方案阶段', phaseType: '方案', progress: 80, remarks: '已完成初稿，待评审' },
    { id: 'p1-2', projectId: '1', phaseName: '初步设计阶段', phaseType: '初步设计', progress: 60, remarks: '正在细化指标' },
    { id: 'p2-1', projectId: '2', phaseName: '初步设计阶段', phaseType: '初步设计', progress: 30, remarks: '地勘完成，正在出图' },
    { id: 'p2-2', projectId: '2', phaseName: '施工图-结构', phaseType: '施工图', progress: 0, remarks: '未开始' },
    { id: 'p2-3', projectId: '2', phaseName: '施工图-水', phaseType: '施工图', progress: 0, remarks: '未开始' },
    { id: 'p3-1', projectId: '3', phaseName: '方案阶段', phaseType: '方案', progress: 100, remarks: '验收通过' },
    { id: 'p3-2', projectId: '3', phaseName: '初步设计阶段', phaseType: '初步设计', progress: 100, remarks: '验收通过' },
    { id: 'p3-3', projectId: '3', phaseName: '施工图-结构', phaseType: '施工图', progress: 100, remarks: '验收通过' },
    { id: 'p3-4', projectId: '3', phaseName: '施工图-电', phaseType: '施工图', progress: 100, remarks: '验收通过' },
    { id: 'p3-5', projectId: '3', phaseName: '施工图-暖通', phaseType: '施工图', progress: 100, remarks: '验收通过' },
];

// 3. API 接口
// ------------------------------
// 原有接口：主项目相关
// ------------------------------
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects').all();
  res.json(projects);
});

app.get('/api/init', (req, res) => {
    const insertProject = db.prepare(`
        INSERT OR REPLACE INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    defaultProjects.forEach(p => {
        insertProject.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks);
    });

    const insertPhase = db.prepare(`
        INSERT OR REPLACE INTO project_phases (id, projectId, phaseName, phaseType, progress, remarks)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    defaultPhases.forEach(p => {
        insertPhase.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.remarks);
    });

    io.emit('data-updated');
    res.json({ success: true, message: "数据已重置为演示数据（含子项）" });
});

app.post('/api/projects/sync', (req, res) => {
  const { projects, phases } = req.body;
  db.prepare('DELETE FROM projects').run();
  db.prepare('DELETE FROM project_phases').run();
  
  if(projects && projects.length > 0) {
      const insertProject = db.prepare(`
        INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      projects.forEach(p => {
        insertProject.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks);
      });
  }
  
  if(phases && phases.length > 0) {
      const insertPhase = db.prepare(`
        INSERT INTO project_phases (id, projectId, phaseName, phaseType, progress, remarks)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      phases.forEach(p => {
        insertPhase.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.remarks);
      });
  }
  
  io.emit('data-updated');
  res.json({ success: true });
});

// ------------------------------
// 原有接口：子项相关
// ------------------------------
app.get('/api/projects/:projectId/phases', (req, res) => {
  const { projectId } = req.params;
  const phases = db.prepare('SELECT * FROM project_phases WHERE projectId = ?').all(projectId);
  res.json(phases);
});

app.get('/api/projects/all/phases', (req, res) => {
  const phases = db.prepare('SELECT * FROM project_phases').all();
  res.json(phases);
});

app.post('/api/phases/save', (req, res) => {
  const phase = req.body;
  const insertOrUpdate = db.prepare(`
    INSERT OR REPLACE INTO project_phases (id, projectId, phaseName, phaseType, progress, remarks)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertOrUpdate.run(
    phase.id, phase.projectId, phase.phaseName, 
    phase.phaseType, phase.progress, phase.remarks
  );
  io.emit('data-updated');
  res.json({ success: true });
});

app.delete('/api/phases/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM project_phases WHERE id = ?').run(id);
  io.emit('data-updated');
  res.json({ success: true });
});

// ------------------------------
// 新增接口：工作量统计相关
// ------------------------------
app.get('/api/stats/leader', (req, res) => {
  const stats = db.prepare(`
    SELECT 
      leader,
      COUNT(id) as totalProjects,
      SUM(CASE WHEN progressPercent = 100 THEN 1 ELSE 0 END) as completedProjects,
      SUM(CASE WHEN progressPercent > 0 AND progressPercent < 100 THEN 1 ELSE 0 END) as inProgressProjects,
      SUM(CASE WHEN progressPercent < 100 AND endDate < DATE('now') THEN 1 ELSE 0 END) as overdueProjects,
      ROUND(AVG(progressPercent), 2) as avgProgress,
      (SELECT COUNT(*) FROM project_phases WHERE project_phases.projectId = projects.id) as totalPhases
    FROM projects
    GROUP BY leader
    ORDER BY totalProjects DESC
  `).all();

  const result = stats.map(item => ({
    ...item,
    completeRate: item.totalProjects > 0 ? Math.round((item.completedProjects / item.totalProjects) * 100) : 0,
    overdueRate: item.totalProjects > 0 ? Math.round((item.overdueProjects / item.totalProjects) * 100) : 0
  }));

  res.json(result);
});

app.get('/api/stats/designer', (req, res) => {
  const designerStats = db.prepare(`
    WITH split_designers AS (
      SELECT 
        id as projectId,
        projectName,
        leader,
        TRIM(value) as designer,
        progressPercent,
        startDate,
        endDate
      FROM projects, json_each('["' || replace(designer, ',', '","') || '"]')
    )
    SELECT 
      designer,
      COUNT(DISTINCT projectId) as joinProjects,
      SUM(CASE WHEN progressPercent = 100 THEN 1 ELSE 0 END) as completedProjects,
      SUM(CASE WHEN progressPercent > 0 AND progressPercent < 100 THEN 1 ELSE 0 END) as inProgressProjects,
      SUM(CASE WHEN progressPercent < 100 AND endDate < DATE('now') THEN 1 ELSE 0 END) as overdueProjects,
      ROUND(AVG(progressPercent), 2) as avgProgress,
      (SELECT COUNT(*) FROM project_phases 
       JOIN projects p ON p.id = project_phases.projectId 
       WHERE p.designer LIKE '%' || split_designers.designer || '%') as totalPhases
    FROM split_designers
    WHERE designer != ''
    GROUP BY designer
    ORDER BY joinProjects DESC
  `).all();

  const result = designerStats.map(item => {
    const phaseStats = db.prepare(`
      SELECT phaseType, COUNT(*) as phaseCount
      FROM project_phases
      JOIN projects p ON p.id = project_phases.projectId
      WHERE p.designer LIKE ?
      GROUP BY phaseType
    `).all(`%${item.designer}%`);

    let workScore = 0;
    phaseStats.forEach(phase => {
      workScore += phase.phaseCount * (WORK_WEIGHT[phase.phaseType] || 1.0);
    });

    return {
      ...item,
      completeRate: item.joinProjects > 0 ? Math.round((item.completedProjects / item.joinProjects) * 100) : 0,
      overdueRate: item.joinProjects > 0 ? Math.round((item.overdueProjects / item.joinProjects) * 100) : 0,
      workScore: Math.round(workScore * 100) / 100,
      phaseDetail: phaseStats
    };
  });

  res.json(result);
});

app.get('/api/stats/designer/:name/phase', (req, res) => {
  const { name } = req.params;
  const phaseDetail = db.prepare(`
    SELECT 
      pp.phaseType,
      pp.phaseName,
      pp.progress,
      p.projectName,
      p.leader,
      p.endDate
    FROM project_phases pp
    JOIN projects p ON pp.projectId = p.id
    WHERE p.designer LIKE ?
    ORDER BY pp.phaseType, p.projectName
  `).all(`%${name}%`);

  res.json(phaseDetail);
});

app.get('/api/stats/summary', (req, res) => {
  const summary = db.prepare(`
    SELECT 
      COUNT(DISTINCT id) as totalProjects,
      SUM(CASE WHEN progressPercent = 100 THEN 1 ELSE 0 END) as totalCompleted,
      COUNT(DISTINCT leader) as totalLeaders,
      (SELECT COUNT(DISTINCT TRIM(value)) FROM projects, json_each('["' || replace(designer, ',', '","') || '"]') WHERE TRIM(value) != '') as totalDesigners,
      (SELECT COUNT(*) FROM project_phases) as totalPhases
    FROM projects
  `).get();

  res.json(summary);
});

// 4. 启动服务
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => { // 【优化】绑定 0.0.0.0 确保外部可访问
  console.log(`\n✅ 后端服务已启动`);
  console.log(`📡 本地地址: http://localhost:${PORT}`);
  console.log(`💡 首次使用请访问: http://localhost:${PORT}/api/init 初始化数据`);
  console.log(`📊 工作量统计接口已启用`);
});
