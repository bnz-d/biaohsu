const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findTechnicalDeviationTable,
  isTechnicalDeviationTableContext,
  normalizeTechnicalDeviationTableMode,
  resolveTechnicalDeviationTableContext,
} = require('./technicalDeviationTable.cjs');

test('识别 Markdown 技术偏离表', () => {
  const source = findTechnicalDeviationTable('## 技术偏离表\n\n| 序号 | 招标技术要求 | 投标响应 | 偏离情况 |\n| --- | --- | --- | --- |\n| 1 | CPU 不低于 8 核 | | |');
  assert.ok(source);
  assert.equal(source.type, 'markdown');
  assert.match(source.table, /偏离情况/);
});

test('识别 HTML 技术响应表', () => {
  const source = findTechnicalDeviationTable('附件：技术参数响应表<table><tr><th>技术参数</th><th>投标响应</th></tr></table>');
  assert.ok(source);
  assert.equal(source.type, 'html');
});

test('不把商务价格表误判为技术偏离表', () => {
  const source = findTechnicalDeviationTable('商务价格明细\n| 序号 | 商品 | 价格 |\n| --- | --- | --- |\n| 1 | 服务 | 100 |');
  assert.equal(source, null);
});

test('优先原表模式未找到原表时回退标准表', () => {
  const context = resolveTechnicalDeviationTableContext({ mode: 'source-first', tenderMarkdown: '无表格', techRequirements: '需求 A' });
  assert.equal(context.modeUsed, 'standard');
  assert.equal(context.fallback, true);
  assert.match(context.instruction, /招标文件条款号/);
});

test('标准模式不搜索原表', () => {
  const context = resolveTechnicalDeviationTableContext({ mode: 'standard', tenderMarkdown: '技术偏离表\n| A | B |\n| --- | --- |\n| 1 | 2 |' });
  assert.equal(context.modeUsed, 'standard');
  assert.equal(context.source, null);
  assert.equal(normalizeTechnicalDeviationTableMode('unexpected'), 'source-first');
});

test('默认全部满足并使用用户自定义响应开头', () => {
  const context = resolveTechnicalDeviationTableContext({
    mode: 'standard',
    techRequirements: 'CPU 不低于 8 核',
    responsePrefix: '满足，我司产品承诺',
  });
  assert.match(context.instruction, /每一行默认按完全满足响应/);
  assert.match(context.instruction, /满足，我司产品承诺/);
  assert.match(context.instruction, /紧扣该行招标技术要求/);
  assert.match(context.instruction, /“偏离情况”统一填写“无偏离”/);
});

test('根据当前或上级章节判断技术偏离表上下文', () => {
  assert.equal(isTechnicalDeviationTableContext({ title: '技术规格偏离表' }), true);
  assert.equal(isTechnicalDeviationTableContext({ title: '设备参数' }, [{ title: '技术响应表' }]), true);
  assert.equal(isTechnicalDeviationTableContext({ title: '实施方案' }), false);
});
