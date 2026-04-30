const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

// 初始化数据库
const db = new Database('./projects.db');

// 主项目表（兼容原有结构）
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

// 【核心修复】项目子项表，新增designer字段，绑定子项负责人，和项目管理强关联
db.exec(`
  CREATE TABLE IF NOT EXISTS project_phases (
    id TEXT PRIMARY KEY,
    projectId TEXT,
    phaseName TEXT,
    phaseType TEXT,
    progress INTEGER DEFAULT 0,
    designer TEXT, -- 子项负责设计师，和项目管理强关联
    remarks TEXT,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  )
`);
// 兼容已有数据库，新增字段（不影响原有数据）
db.exec(`ALTER TABLE project_phases ADD COLUMN IF NOT EXISTS designer TEXT`);

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

// 设计行业工作量权重（施工图>初设>方案，贴合实际工作量）
const WORK_WEIGHT = {
  "方案": 1.0,
  "初步设计": 1.2,
  "施工图": 1.5
};

// 默认演示数据（子项已绑定对应设计师，和项目内设计师完全匹配）
const defaultProjects = [
    { id: '1', projectName: '江东新区城市设计', leader: '张建国', designer: '李思思,王明远', startDate: '2025-01-10', endDate: '2025-04-20', actualEndDate: '', progressPercent: 65, remarks: '方案深化阶段，等待业主确认' },
    { id: '2', projectName: '滨江景观桥工程', leader: '陈敏华', designer: '赵一航', startDate: '2025-02-01', endDate: '2025-05-15', actualEndDate: '', progressPercent: 30, remarks: '初设阶段，地勘完成' },
    { id: '3', projectName: '科技园总部基地', leader: '刘子轩', designer: '李思思,周雅', startDate: '2024-12-01', endDate: '2025-03-01', actualEndDate: '2025-02-28', progressPercent: 100, remarks: '提前交付，验收通过' },
    { id: '4', projectName: '轨道交通枢纽改造', leader: '王宏', designer: '吴启航,林芳', startDate: '2024-10-10', endDate: '2025-02-10', actualEndDate: '', progressPercent: 85, remarks: '收尾阶段，超期风险注意' },
    { id: '5', projectName: '海绵城市示范区', leader: '陈敏华', designer: '郑秋怡', startDate: '2025-03-01', endDate: '2025-07-20', actualEndDate: '', progressPercent: 20, remarks: '初步设计' }
];

const defaultPhases = [
    // 项目1子项，绑定对应设计师
    { id: 'p1-1', projectId: '1', phaseName: '方案阶段-总平图', phaseType: '方案', progress: 100, designer: '李思思', remarks: '已完成初稿，待评审' },
    { id: 'p1-2', projectId: '1', phaseName: '方案阶段-效果图', phaseType: '方案', progress: 60, designer: '王明远', remarks: '正在渲染' },
    { id: 'p1-3', projectId: '1', phaseName: '初步设计-建筑专业', phaseType: '初步设计', progress: 40, designer: '李思思', remarks: '正在细化指标' },
    // 项目2子项，绑定对应设计师
    { id: 'p2-1', projectId: '2', phaseName: '初步设计-地勘报告', phaseType: '初步设计', progress: 100, designer: '赵一航', remarks: '地勘完成' },
    { id: 'p2-2', projectId: '2', phaseName: '初步设计-结构计算', phaseType: '初步设计', progress: 30, designer: '赵一航', remarks: '正在出图' },
    { id: 'p2-3', projectId: '2', phaseName: '施工图-结构', phaseType: '施工图', progress: 0, designer: '赵一航', remarks: '未开始' },
    { id: 'p2-4', projectId: '2', phaseName: '施工图-水', phaseType: '施工图', progress: 0, designer: '赵一航', remarks: '未开始' },
    // 项目3子项，绑定对应设计师
    { id: 'p3-1', projectId: '3', phaseName: '方案阶段', phaseType: '方案', progress: 100, designer: '李思思', remarks: '验收通过' },
    { id: 'p3-2', projectId: '3', phaseName: '初步设计阶段', phaseType: '初步设计', progress: 100, designer: '李思思', remarks: '验收通过' },
    { id: 'p3-3', projectId: '3', phaseName: '施工图-结构', phaseType: '施工图', progress: 100, designer: '李思思', remarks: '验收通过' },
    { id: 'p3-4', projectId: '3', phaseName: '施工图-电', phaseType: '施工图', progress: 100, designer: '周雅', remarks: '验收通过' },
    { id: 'p3-5', projectId: '3', phaseName: '施工图-暖通', phaseType: '施工图', progress: 100, designer: '周雅', remarks: '验收通过' },
];

// 初始化数据接口
app.get('/api/init', (req, res) => {
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM project_phases').run();

    // 插入主项目
    const insertProject = db.prepare(`
        INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    defaultProjects.forEach(p => insertProject.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks));

    // 插入子项（含设计师）
    const insertPhase = db.prepare(`
        INSERT INTO project_phases (id, projectId, phaseName, phaseType, progress, designer, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    defaultPhases.forEach(p => insertPhase.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.designer, p.remarks));

    io.emit('data-updated');
    res.json({ success: true, message: "初始化完成，子项已绑定对应设计师" });
});

// 获取所有项目
app.get('/api/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects').all());
});

// 获取单个项目详情（含子项）
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
  const phStmt = db.prepare(`INSERT INTO project_phases (id, projectId, phaseName, phaseType, progress, designer, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  if (projects) projects.forEach(p => pStmt.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks));
  if (phases) phases.forEach(p => phStmt.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.designer, p.remarks));

  io.emit('data-updated');
  res.json({ success: true });
});

// 子项相关接口（新增designer字段支持）
app.get('/api/projects/:projectId/phases', (req, res) => {
  res.json(db.prepare('SELECT * FROM project_phases WHERE projectId = ?').all(req.params.projectId));
});

app.get('/api/projects/all/phases', (req, res) => {
  res.json(db.prepare('SELECT * FROM project_phases').all());
});

// 保存子项（含设计师）
app.post('/api/phases/save', (req, res) => {
  const p = req.body;
  db.prepare(`
    INSERT OR REPLACE INTO project_phases (id, projectId, phaseName, phaseType, progress, designer, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.designer, p.remarks);
  io.emit('data-updated');
  res.json({ success: true });
});

// 删除子项
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

// 【核心修复】设计师统计接口，完全和项目子项强关联
app.get('/api/stats/designer', (req, res) => {
  // 1. 从子项表精准统计每个设计师的工作量，完全来自项目内的分配
  const designerBaseStats = db.prepare(`
    WITH designer_phases AS (
      SELECT 
        TRIM(designer) as designer,
        id as phaseId,
        projectId,
        phaseType,
        progress,
        (SELECT projectName FROM projects WHERE id=project_phases.projectId) as projectName
      FROM project_phases
      WHERE designer IS NOT NULL AND designer != ''
    )
    SELECT 
      designer,
      COUNT(DISTINCT projectId) as joinProjects, -- 参与项目数，来自实际负责子项的项目
      COUNT(phaseId) as totalPhases, -- 负责子项总数，完全来自项目内分配
      SUM(CASE WHEN progress = 100 THEN 1 ELSE 0 END) as completedPhases, -- 已完成子项数
      SUM(CASE WHEN progress > 0 AND progress < 100 THEN 1 ELSE 0 END) as inProgressPhases, -- 进行中子项数
      ROUND(AVG(progress), 2) as avgPhaseProgress, -- 子项平均进度
      SUM(CASE WHEN progress < 100 AND (SELECT endDate FROM projects WHERE id=projectId) < DATE('now') THEN 1 ELSE 0 END) as overduePhases -- 逾期子项数
    FROM designer_phases
    GROUP BY designer
    ORDER BY totalPhases DESC
  `).all();

  // 2. 计算权重化工作量得分，完全基于项目内子项的阶段和进度
  const result = designerBaseStats.map(item => {
    // 获取该设计师所有子项的阶段明细
    const phaseDetail = db.prepare(`
      SELECT phaseType, COUNT(*) as phaseCount, ROUND(AVG(progress),2) as avgProgress
      FROM project_phases
      WHERE TRIM(designer) = ?
      GROUP BY phaseType
    `).all(item.designer);

    // 计算工作量得分（阶段权重*进度占比）
    let workScore = 0;
    phaseDetail.forEach(phase => {
      workScore += phase.phaseCount * WORK_WEIGHT[phase.phaseType] * (phase.avgProgress / 100);
    });

    // 补充项目完成率
    const completedProjects = db.prepare(`
      SELECT COUNT(DISTINCT projectId) as count
      FROM project_phases pp
      JOIN projects p ON pp.projectId = p.id
      WHERE TRIM(pp.designer) = ? AND p.progressPercent = 100
    `).get(item.designer).count;

    return {
      ...item,
      completedProjects,
      completeRate: item.joinProjects > 0 ? Math.round((completedProjects / item.joinProjects) * 100) : 0,
      overdueRate: item.totalPhases > 0 ? Math.round((item.overduePhases / item.totalPhases) * 100) : 0,
      workScore: Math.round(workScore * 100) / 100,
      phaseDetail
    };
  });

  res.json(result);
});

// 设计师子项明细接口（完全来自项目内分配的子项）
app.get('/api/stats/designer/:name/phase', (req, res) => {
  const { name } = req.params;
  const phaseDetail = db.prepare(`
    SELECT 
      pp.phaseType,
      pp.phaseName,
      pp.progress,
      pp.designer,
      p.projectName,
      p.leader,
      p.endDate
    FROM project_phases pp
    JOIN projects p ON pp.projectId = p.id
    WHERE TRIM(pp.designer) = ?
    ORDER BY p.projectName, pp.phaseType
  `).all(name.trim());

  res.json(phaseDetail);
});

// 全局汇总统计接口
app.get('/api/stats/summary', (req, res) => {
  res.json(db.prepare(`
    SELECT COUNT(*) as totalProjects,
    SUM(CASE WHEN progressPercent=100 THEN 1 ELSE 0 END) as totalCompleted,
    COUNT(DISTINCT leader) as totalLeaders,
    (SELECT COUNT(DISTINCT TRIM(designer)) FROM project_phases WHERE designer IS NOT NULL AND designer != '') as totalDesigners,
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
