// 兼容层：链能力已迁移到 src/infra/chain/（一套契约 · N 个适配器）
// 保留此文件是为了不打断已有 import（attest.mjs 等仍从 '../infra/chain.mjs' 取）
export * from './chain/index.mjs'
