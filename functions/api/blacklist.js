export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const db = env.DB;
  if (!db) return new Response(JSON.stringify({ error: 'D1 not bound' }), { status: 500, headers });
  try {
    const url = new URL(request.url);
    const threshold = parseInt(url.searchParams.get('min') || '10');
    const rows = await db.prepare('SELECT id, likes, dislikes FROM votes WHERE dislikes >= ? ORDER BY dislikes DESC').bind(threshold).all();
    return new Response(JSON.stringify({ count: rows.results.length, videos: rows.results }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
