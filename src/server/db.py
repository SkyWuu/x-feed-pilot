import json
import sqlite3
import sys
from pathlib import Path

db_path = Path(sys.argv[1])
db_path.parent.mkdir(parents=True, exist_ok=True)
req = json.load(sys.stdin)
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
conn.execute('PRAGMA journal_mode=WAL')
conn.executescript('''
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, state_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, url TEXT NOT NULL, author TEXT NOT NULL,
  body TEXT NOT NULL, has_video INTEGER NOT NULL, promoted INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS observations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  post_id TEXT NOT NULL, source TEXT NOT NULL, phase TEXT, query TEXT,
  label TEXT NOT NULL, snapshot_json TEXT, judgments_json TEXT, plan_json TEXT NOT NULL,
  ocr_text TEXT, seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_session ON observations(session_id, seq);
CREATE TABLE IF NOT EXISTS executed_actions (
  post_id TEXT NOT NULL, action TEXT NOT NULL, session_id TEXT NOT NULL,
  executed_at INTEGER NOT NULL, PRIMARY KEY (post_id, action)
);
CREATE TABLE IF NOT EXISTS action_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL,
  session_id TEXT NOT NULL, observation_seq INTEGER, action TEXT NOT NULL,
  success INTEGER NOT NULL, attempted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS exploration_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  observation_seq INTEGER NOT NULL, kind TEXT NOT NULL,
  url TEXT NOT NULL, final_url TEXT, evidence TEXT NOT NULL,
  success INTEGER NOT NULL, judgments_json TEXT, plan_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS exploration_steps_observation ON exploration_steps(observation_seq, id);
''')
columns = [row['name'] for row in conn.execute('PRAGMA table_info(observations)').fetchall()]
if 'phase' not in columns:
    conn.execute('ALTER TABLE observations ADD COLUMN phase TEXT')
if 'snapshot_json' not in columns:
    conn.execute('ALTER TABLE observations ADD COLUMN snapshot_json TEXT')
columns = [row['name'] for row in conn.execute('PRAGMA table_info(action_attempts)').fetchall()]
if 'observation_seq' not in columns:
    conn.execute('ALTER TABLE action_attempts ADD COLUMN observation_seq INTEGER')

op = req['op']
arg = req.get('arg', {})
result = None
if op == 'init':
    conn.execute("UPDATE sessions SET state_json = json_set(state_json, '$.status', 'stopped', '$.phase', 'stopped', '$.stopReason', 'service_restart') WHERE json_extract(state_json, '$.status') = 'active'")
elif op == 'save_session':
    s = arg['session']
    conn.execute('INSERT INTO sessions(id, started_at, state_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json', (s['id'], s['startedAt'], json.dumps(s)))
elif op == 'seen_in_session':
    row = conn.execute('SELECT 1 FROM observations WHERE session_id=? AND post_id=? LIMIT 1', (arg['sessionId'], arg['postId'])).fetchone()
    result = bool(row)
elif op == 'seen_in_phase':
    row = conn.execute('SELECT 1 FROM observations WHERE session_id=? AND post_id=? AND phase=? LIMIT 1', (arg['sessionId'], arg['postId'], arg['phase'])).fetchone()
    result = bool(row)
elif op == 'action_flags':
    rows = conn.execute('SELECT action FROM executed_actions WHERE post_id=?', (arg['postId'],)).fetchall()
    result = [row['action'] for row in rows]
elif op == 'add_observation':
    p = arg['post']
    conn.execute('INSERT INTO posts(id,url,author,body,has_video,promoted) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,author=excluded.author,body=excluded.body,has_video=excluded.has_video,promoted=excluded.promoted', (p['postId'], p['url'], p['author'], p['text'], int(p['hasVideo']), int(p['promoted'])))
    snapshot = {key: p[key] for key in ('url', 'author', 'text', 'hasVideo', 'promoted') if key in p}
    cur = conn.execute('INSERT INTO observations(session_id,post_id,source,phase,query,label,snapshot_json,judgments_json,plan_json,ocr_text,seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', (arg['sessionId'], p['postId'], p['source'], arg['phase'], p.get('query'), arg['label'], json.dumps(snapshot), json.dumps(arg.get('judgments')), json.dumps(arg['plan']), p.get('ocrText'), arg['now']))
    result = cur.lastrowid
elif op == 'record_action':
    cur = conn.execute('INSERT OR IGNORE INTO executed_actions(post_id,action,session_id,executed_at) VALUES(?,?,?,?)', (arg['postId'], arg['action'], arg['sessionId'], arg['now']))
    result = cur.rowcount == 1
elif op == 'record_attempt':
    conn.execute('INSERT INTO action_attempts(post_id,session_id,observation_seq,action,success,attempted_at) VALUES(?,?,?,?,?,?)', (arg['postId'], arg['sessionId'], arg.get('observationSeq'), arg['action'], int(arg['success']), arg['now']))
elif op == 'add_exploration_step':
    conn.execute('INSERT INTO exploration_steps(session_id,observation_seq,kind,url,final_url,evidence,success,judgments_json,plan_json,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?)', (arg['sessionId'], arg['observationSeq'], arg['kind'], arg['url'], arg.get('finalUrl'), arg.get('evidence', '')[:12000], int(arg['success']), json.dumps(arg.get('judgments')), json.dumps(arg['plan']), arg['now']))
elif op == 'update_observation_decision':
    cur = conn.execute('UPDATE observations SET label=?,judgments_json=?,plan_json=? WHERE seq=? AND session_id=?', (arg['label'], json.dumps(arg.get('judgments')), json.dumps(arg['plan']), arg['observationSeq'], arg['sessionId']))
    result = cur.rowcount == 1
elif op == 'feed':
    rows = conn.execute('''SELECT o.seq, o.session_id, o.source, o.query, o.label, o.snapshot_json, o.judgments_json,
      o.plan_json, o.ocr_text, o.seen_at, p.id AS post_id, p.url, p.author,
      p.body, p.has_video, p.promoted
      FROM observations o JOIN posts p ON o.post_id=p.id JOIN sessions s ON o.session_id=s.id
      WHERE (? IS NULL OR o.source=?) AND (? IS NULL OR o.label=?)
      ORDER BY s.started_at DESC, o.seq ASC LIMIT ? OFFSET ?''',
      (arg.get('source'), arg.get('source'), arg.get('label'), arg.get('label'), arg.get('limit', 100), arg.get('offset', 0))).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        if item['snapshot_json']:
            snapshot = json.loads(item['snapshot_json'])
            item['url'] = snapshot.get('url', item['url'])
            item['author'] = snapshot.get('author', item['author'])
            item['body'] = snapshot.get('text', item['body'])
            item['has_video'] = int(snapshot.get('hasVideo', item['has_video']))
            item['promoted'] = int(snapshot.get('promoted', item['promoted']))
        actions = conn.execute('SELECT action,success FROM action_attempts WHERE observation_seq=? ORDER BY id', (item['seq'],)).fetchall()
        item['actual_actions'] = [dict(action) for action in actions]
        steps = conn.execute('SELECT kind,url,final_url,evidence,success,judgments_json,plan_json,observed_at FROM exploration_steps WHERE observation_seq=? ORDER BY id', (item['seq'],)).fetchall()
        item['exploration_steps'] = [dict(step) for step in steps]
        result.append(item)
elif op == 'counts':
    rows = conn.execute('SELECT label,COUNT(*) AS count FROM observations GROUP BY label').fetchall()
    result = {row['label']: row['count'] for row in rows}
elif op == 'sessions':
    rows = conn.execute('SELECT state_json FROM sessions ORDER BY started_at DESC LIMIT 20').fetchall()
    result = [json.loads(row['state_json']) for row in rows]
else:
    raise ValueError(f'unknown operation: {op}')

conn.commit()
print(json.dumps({'result': result}))
