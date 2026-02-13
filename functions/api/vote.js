// CF Pages Function - 投票 API（D1）
// 一个 IP 对一个视频只能投一次（赞或踩），可切换，可取消

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    likes INTEGER DEFAULT 0,
    dislikes INTEGER DEFAULT 0
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_votes (
    ip TEXT NOT NULL,
    vid TEXT NOT NULL,
    type TEXT NOT NULL,
    PRIMARY KEY (ip, vid)
  )`).run();
}

function getIP(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '0.0.0.0';
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
    });
  }

  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const db = env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not bound' }), { status: 500, headers: H });

  try {
    await ensureTable(db);
    const ip = getIP(request);

    // GET: 查询投票数 + 当前用户的投票状态
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) return new Response(JSON.stringify({ error: 'missing id' }), { status: 400, headers: H });

      const row = await db.prepare('SELECT likes, dislikes FROM votes WHERE id = ?').bind(id).first();
      const uv = await db.prepare('SELECT type FROM user_votes WHERE ip = ? AND vid = ?').bind(ip, id).first();

      return new Response(JSON.stringify({
        likes: row ? row.likes : 0,
        dislikes: row ? row.dislikes : 0,
        my: uv ? uv.type : null
      }), { headers: H });
    }

    // POST: 投票
    if (request.method === 'POST') {
      const { id, type } = await request.json();
      if (!id || !type || (type !== 'like' && type !== 'dislike')) {
        return new Response(JSON.stringify({ error: 'bad params' }), { status: 400, headers: H });
      }

      await db.prepare('INSERT OR IGNORE INTO votes (id, likes, dislikes) VALUES (?, 0, 0)').bind(id).run();

      // 查当前用户对这个视频的投票
      const existing = await db.prepare('SELECT type FROM user_votes WHERE ip = ? AND vid = ?').bind(ip, id).first();

      if (existing) {
        if (existing.type === type) {
          // 取消投票（再点一次同样的 = 取消）
          await db.prepare('DELETE FROM user_votes WHERE ip = ? AND vid = ?').bind(ip, id).run();
          if (type === 'like') await db.prepare('UPDATE votes SET likes = MAX(0, likes - 1) WHERE id = ?').bind(id).run();
          else await db.prepare('UPDATE votes SET dislikes = MAX(0, dislikes - 1) WHERE id = ?').bind(id).run();
        } else {
          // 切换投票（赞→踩 或 踩→赞）
          await db.prepare('UPDATE user_votes SET type = ? WHERE ip = ? AND vid = ?').bind(type, ip, id).run();
          if (existing.type === 'like') await db.prepare('UPDATE votes SET likes = MAX(0, likes - 1) WHERE id = ?').bind(id).run();
          else await db.prepare('UPDATE votes SET dislikes = MAX(0, dislikes - 1) WHERE id = ?').bind(id).run();
          if (type === 'like') await db.prepare('UPDATE votes SET likes = likes + 1 WHERE id = ?').bind(id).run();
          else await db.prepare('UPDATE votes SET dislikes = dislikes + 1 WHERE id = ?').bind(id).run();
        }
      } else {
        // 新投票
        await db.prepare('INSERT INTO user_votes (ip, vid, type) VALUES (?, ?, ?)').bind(ip, id, type).run();
        if (type === 'like') await db.prepare('UPDATE votes SET likes = likes + 1 WHERE id = ?').bind(id).run();
        else await db.prepare('UPDATE votes SET dislikes = dislikes + 1 WHERE id = ?').bind(id).run();
      }

      const row = await db.prepare('SELECT likes, dislikes FROM votes WHERE id = ?').bind(id).first();
      const uv = await db.prepare('SELECT type FROM user_votes WHERE ip = ? AND vid = ?').bind(ip, id).first();

      return new Response(JSON.stringify({
        ok: true,
        likes: row.likes,
        dislikes: row.dislikes,
        my: uv ? uv.type : null
      }), { headers: H });
    }

    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: H });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: H });
  }
}
