// 数据库层：连接池 + 事务助手（与 server/src V1~V3 迁移同一套库表）
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'wanderlust',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4_0900_ai_ci',
  dateStrings: true,
  namedPlaceholders: false,
})

export async function q(sql, params = []) {
  const [rows] = await pool.query(sql, params)
  return rows
}

/** 事务：body(conn)；异常自动回滚。conn 上可用 q/one/ins 三个助手 */
export async function tx(body) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const out = await body({
      q: async (sql, p = []) => (await conn.query(sql, p))[0],
      one: async (sql, p = []) => (await conn.query(sql, p))[0][0] || null,
      ins: async (sql, p = []) => { const [r] = await conn.query(sql, p); return r.insertId },
      upd: async (sql, p = []) => { const [r] = await conn.query(sql, p); return r.affectedRows },
    })
    await conn.commit()
    return out
  } catch (e) {
    try { await conn.rollback() } catch { /* ignore */ }
    throw e
  } finally {
    conn.release()
  }
}

export async function one(sql, params = []) {
  const rows = await q(sql, params)
  return rows[0] || null
}

export async function count(sql, params = []) {
  const r = await one(sql, params)
  return r ? Number(Object.values(r)[0]) : 0
}

export class BizError extends Error {
  constructor(code, msg) { super(msg); this.code = code }
}
