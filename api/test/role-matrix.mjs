// R-05 角色能力矩阵静态断言：矩阵与权限表不漂移——
//   PC 行 canView ⊆ effectiveModules(actor)；canDo ⊆ ADMIN_ACTIONS；mini 行描述非空。
// 矩阵改了、权限表没跟（或反之）→ npm test 红。
import assert from 'node:assert/strict'
import { ROLE_MATRIX, MERCHANT_ROLE_GUIDE } from '../src/domain/role-matrix.mjs'
import { ADMIN_ACTIONS } from '../src/domain/admin-capabilities.mjs'
import { effectiveModules } from '../src/domain/modules.mjs'

let passed = 0
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name) }

test('R-05 矩阵覆盖三端全部身份', () => {
  const actors = ROLE_MATRIX.map((r) => r.actor)
  for (const role of ['super', 'ops', 'finance', 'review', 'risk', 'city_partner', 'readonly', 'sre', 'dev', 'merchant_partner', 'scenic_partner']) {
    assert.ok(actors.includes(role), '缺 PC 角色 ' + role)
  }
  for (const a of ['mb-verify', 'mb-manager', 'mb-owner', 'ma-tourist', 'ma-promoter', 'ma-cooperator', 'ma-creator']) {
    assert.ok(actors.includes(a), '缺端侧身份 ' + a)
  }
})

test('PC 行 canView ⊆ effectiveModules（与权限表不漂移）', () => {
  for (const row of ROLE_MATRIX.filter((r) => r.side === 'PC')) {
    const valid = effectiveModules(row.actor)
    assert.ok(valid.length > 0, row.actor + ' 有效模块为空（未知角色？）')
    for (const m of row.canView) {
      assert.ok(valid.includes(m), `${row.actor}.canView 含未授权模块 ${m}（说明页与实际权限不一致）`)
    }
  }
})

test('PC 行 canDo ⊆ ADMIN_ACTIONS（能力点存在）', () => {
  for (const row of ROLE_MATRIX.filter((r) => r.side === 'PC')) {
    for (const a of row.canDo) {
      assert.ok(ADMIN_ACTIONS[a], `${row.actor}.canDo 引用了不存在的 ADMIN_ACTIONS.${a}`)
    }
  }
})

test('mini 行描述非空；商户岗位说明覆盖 1/2/3', () => {
  for (const row of ROLE_MATRIX.filter((r) => r.side !== 'PC')) {
    assert.ok(row.label && row.canView.length && row.canDo.length, row.actor + ' 描述缺失')
  }
  for (const k of [1, 2, 3]) assert.ok(MERCHANT_ROLE_GUIDE[k] && MERCHANT_ROLE_GUIDE[k].length > 10, '岗位说明缺 ' + k)
})

console.log('role-matrix: R-05 静态断言全部通过（' + passed + ' 组）')
