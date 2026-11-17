// X-03：团期改价留痕——商户端（/m/supply price 与 batch）与 PC（entity 编辑器）共用同一份
// master_data_version 版本簿（kind=session）。快照含 来源端 source、操作人 operator、改前改后、关联团期。
// 历史只增不改（红线 6 同源约束）；同一 (kind, ref_id) 下 version_no 单调递增。
export async function recordVersion(c, { kind, refId, snapshot, changedBy, reason }) {
  const v = await c.one('SELECT COALESCE(MAX(version_no), 0) v FROM master_data_version WHERE kind = ? AND ref_id = ?', [kind, refId])
  await c.q('INSERT INTO master_data_version (kind, ref_id, version_no, snapshot, changed_by, reason) VALUES (?,?,?,?,?,?)',
    [kind, refId, Number(v.v) + 1, JSON.stringify(snapshot), changedBy, reason || null])
  return Number(v.v) + 1
}
