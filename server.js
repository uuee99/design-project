const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

// 兼容Railway可写目录
const dbPath = process.env.NODE_ENV === 'production' 
  ? '/tmp/projects.db' 
  : './projects.db';

// 数据库初始化
let db;
try {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  console.log('✅ 数据库连接成功');
} catch (err) {
  console.error('❌ 数据库初始化失败:', err);
  process.exit(1);
}

// 数据库表结构（新增extraModification字段）
try {
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

  // 项目子项表（新增extraModification字段）
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_phases (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      phaseName TEXT,
      phaseType TEXT,
      progress INTEGER DEFAULT 0,
      designer TEXT,
      extraModification TEXT, -- 【新增】额外修改内容
      remarks TEXT,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  // 兼容旧数据库，新增字段
  const columns = db.prepare("PRAGMA table_info(project_phases)").all();
  const hasDesigner = columns.some(col => col.name === 'designer');
  const hasExtraMod = columns.some(col => col.name === 'extraModification');
  
  if (!hasDesigner) {
    db.exec(`ALTER TABLE project_phases ADD COLUMN designer TEXT`);
    console.log('✅ 新增designer字段成功');
  }
  if (!hasExtraMod) {
    db.exec(`ALTER TABLE project_phases ADD COLUMN extraModification TEXT`);
    console.log('✅ 新增extraModification字段成功');
  }

  console.log('✅ 数据库表结构初始化完成');
} catch (err) {
  console.error('❌ 表结构初始化失败:', err);
  process.exit(1);
}

// 初始化服务
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// 托管前端页面
app.use(express.static(path.join(__dirname, '.')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000
});

// 设计行业工作量权重
const WORK_WEIGHT = {
  "方案": 1.0,
  "初步设计": 1.2,
  "施工图": 1.5
};

// 默认演示数据（含额外修改示例）
const defaultProjects = [
    { id: '1', projectName: '江东新区城市设计', leader: '张建国', designer: '李思思,王明远', startDate: '2025-01-10', endDate: '2025-04-20', actualEndDate: '', progressPercent: 65, remarks: '方案深化阶段，等待业主确认' },
    { id: '2', projectName: '滨江景观桥工程', leader: '陈敏华', designer: '赵一航', startDate: '2025-02-01', endDate: '2025-05-15', actualEndDate: '', progressPercent: 30, remarks: '初设阶段，地勘完成' },
    { id: '3', projectName: '科技园总部基地', leader: '刘子轩', designer: '李思思,周雅', startDate: '2024-12-01', endDate: '2025-03-01', actualEndDate: '2025-02-28', progressPercent: 100, remarks: '提前交付，验收通过' }
];

const defaultPhases = [
    { id: 'p1-1', projectId: '1', phaseName: '方案阶段-总平图', phaseType: '方案', progress: 100, designer: '李思思', extraModification: '', remarks: '已完成初稿，待评审' },
    { id: 'p1-2', projectId: '1', phaseName: '方案阶段-效果图', phaseType: '方案', progress: 60, designer: '王明远', extraModification: '业主反馈需调整建筑高度', remarks: '正在渲染' },
    { id: 'p1-3', projectId: '1', phaseName: '初步设计-建筑专业', phaseType: '初步设计', progress: 40, designer: '李思思', extraModification: '', remarks: '正在细化指标' },
    { id: 'p2-1', projectId: '2', phaseName: '初步设计-地勘报告', phaseType: '初步设计', progress: 100, designer: '赵一航', extraModification: '', remarks: '地勘完成' },
    { id: 'p2-2', projectId: '2', phaseName: '初步设计-结构计算', phaseType: '初步设计', progress: 30, designer: '赵一航', extraModification: '需补充抗震验算', remarks: '正在出图' },
    { id: 'p3-1', projectId: '3', phaseName: '方案阶段', phaseType: '方案', progress: 100, designer: '李思思', extraModification: '', remarks: '验收通过' },
    { id: 'p3-2', projectId: '3', phaseName: '初步设计阶段', phaseType: '初步设计', progress: 100, designer: '李思思', extraModification: '', remarks: '验收通过' },
    { id: 'p3-3', projectId: '3', phaseName: '施工图-结构', phaseType: '施工图', progress: 100, designer: '李思思', extraModification: '', remarks: '验收通过' }
];

// 初始化数据接口
app.get('/api/init', (req, res) => {
  try {
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM project_phases').run();

    const insertProject = db.prepare(`
        INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    defaultProjects.forEach(p => insertProject.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks));

    const insertPhase = db.prepare(`
        INSERT INTO project_phases (id, projectId, phaseName, phaseType, progress, designer, extraModification, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    defaultPhases.forEach(p => insertPhase.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.designer, p.extraModification, p.remarks));

    io.emit('data-updated');
    res.json({ success: true, message: "初始化完成" });
  } catch (err) {
    console.error('初始化失败:', err);
    res.status(500).json({ error: '初始化失败' });
  }
});

// 获取所有项目
app.get('/api/projects', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM projects').all());
  } catch (err) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 获取单个项目详情
app.get('/api/projects/:id', (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const phases = db.prepare('SELECT * FROM project_phases WHERE projectId = ?').all(req.params.id);
    res.json({ ...project, phases });
  } catch (err) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 同步项目与子项
app.post('/api/projects/sync', (req, res) => {
  try {
    const { projects, phases } = req.body;
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM project_phases').run();

    const pStmt = db.prepare(`INSERT INTO projects (id, projectName, leader, designer, startDate, endDate, actualEndDate, progressPercent, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const phStmt = db.prepare(`INSERT INTO project_phases (id, projectId, phaseName, phaseType, progress, designer, extraModification, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    if (projects) projects.forEach(p => pStmt.run(p.id, p.projectName, p.leader, p.designer, p.startDate, p.endDate, p.actualEndDate, p.progressPercent, p.remarks));
    if (phases) phases.forEach(p => phStmt.run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.designer, p.extraModification, p.remarks));

    io.emit('data-updated');
    res.json({ success: true });
  } catch (err) {
    console.error('同步失败:', err);
    res.status(500).json({ error: '同步失败' });
  }
});

// 子项相关接口
app.get('/api/projects/:projectId/phases', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM project_phases WHERE projectId = ?').all(req.params.projectId));
  } catch (err) {
    res.status(500).json({ error: '查询失败' });
  }
});

app.get('/api/projects/all/phases', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM project_phases').all());
  } catch (err) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 保存子项（含额外修改）
app.post('/api/phases/save', (req, res) => {
  try {
    const p = req.body;
    db.prepare(`
      INSERT OR REPLACE INTO project_phases (id, projectId, phaseName, phaseType, progress, designer, extraModification, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(p.id, p.projectId, p.phaseName, p.phaseType, p.progress, p.designer, p.extraModification, p.remarks);
    io.emit('data-updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '保存失败' });
  }
});

// 删除子项
app.delete('/api/phases/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM project_phases WHERE id = ?').run(req.params.id);
    io.emit('data-updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// 负责人统计接口
app.get('/api/stats/leader', (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: '统计失败' });
  }
});

// 设计师统计接口
app.get('/api/stats/designer', (req, res) => {
  try {
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
        COUNT(DISTINCT projectId) as joinProjects,
        COUNT(phaseId) as totalPhases,
        SUM(CASE WHEN progress = 100 THEN 1 ELSE 0 END) as completedPhases,
        SUM(CASE WHEN progress > 0 AND progress < 100 THEN 1 ELSE 0 END) as inProgressPhases,
        ROUND(AVG(progress), 2) as avgPhaseProgress,
        SUM(CASE WHEN progress < 100 AND (SELECT endDate FROM projects WHERE id=projectId) < DATE('now') THEN 1 ELSE 0 END) as overduePhases
      FROM designer_phases
      GROUP BY designer
      ORDER BY totalPhases DESC
    `).all();

    const result = designerBaseStats.map(item => {
      const phaseDetail = db.prepare(`
        SELECT phaseType, COUNT(*) as phaseCount, ROUND(AVG(progress),2) as avgProgress
        FROM project_phases
        WHERE TRIM(designer) = ?
        GROUP BY phaseType
      `).all(item.designer);

      let workScore = 0;
      phaseDetail.forEach(phase => {
        workScore += phase.phaseCount * WORK_WEIGHT[phase.phaseType] * (phase.avgProgress / 100);
      });

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
  } catch (err) {
    console.error('设计师统计失败:', err);
    res.status(500).json({ error: '统计失败' });
  }
});

// 设计师子项明细接口
app.get('/api/stats/designer/:name/phase', (req, res) => {
  try {
    const { name } = req.params;
    const phaseDetail = db.prepare(`
      SELECT 
        pp.phaseType,
        pp.phaseName,
        pp.progress,
        pp.designer,
        pp.extraModification,
        p.projectName,
        p.leader,
        p.endDate
      FROM project_phases pp
      JOIN projects p ON pp.projectId = p.id
      WHERE TRIM(pp.designer) = ?
      ORDER BY p.projectName, pp.phaseType
    `).all(name.trim());

    res.json(phaseDetail);
  } catch (err) {
    res.status(500).json({ error: '查询失败' });
  }
});

// 全局汇总统计接口
app.get('/api/stats/summary', (req, res) => {
  try {
    res.json(db.prepare(`
      SELECT COUNT(*) as totalProjects,
      SUM(CASE WHEN progressPercent=100 THEN 1 ELSE 0 END) as totalCompleted,
      COUNT(DISTINCT leader) as totalLeaders,
      (SELECT COUNT(DISTINCT TRIM(designer)) FROM project_phases WHERE designer IS NOT NULL AND designer != '') as totalDesigners,
      (SELECT COUNT(*) FROM project_phases) as totalPhases
      FROM projects
    `).get());
  } catch (err) {
    res.status(500).json({ error: '统计失败' });
  }
});

// 404处理
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: '接口不存在' });
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// 全局错误捕获
app.use((err, req, res, next) => {
  console.error('服务错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 启动服务
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`✅ 后端服务已启动`);
  console.log(`📡 监听地址: ${HOST}:${PORT}`);
  console.log(`💡 首次使用请访问 /api/init 初始化演示数据`);
});

// 未捕获异常处理
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('未处理的Promise拒绝:', err);
});
