const initSqlJs = require('sql.js');
const fs = require('fs');

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(String.raw`C:\Users\xf\AppData\Roaming\工作台\workbench.sqlite`));
  const dump = (sql) => {
    const r = db.exec(sql);
    return r.length ? r[0] : { columns: [], values: [] };
  };
  console.log('--- tasks (last 10) ---');
  const t = dump(
    'SELECT id, title, status, importance, urgency, start_date, due_date, project, created_at FROM tasks ORDER BY id DESC LIMIT 10'
  );
  console.log(t.columns.join(' | '));
  t.values.forEach((v) => console.log(v.join(' | ')));
  console.log('--- ai_messages (last 6) ---');
  const m = dump(
    'SELECT id, role, substr(content, 1, 200) AS content, created_at FROM ai_messages ORDER BY id DESC LIMIT 6'
  );
  console.log(m.columns.join(' | '));
  m.values.forEach((v) => console.log(v.join(' | ')));
})();
