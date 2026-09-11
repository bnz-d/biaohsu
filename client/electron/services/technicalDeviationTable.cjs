const SOURCE_CONTEXT_CHARS = 700;
const MAX_SOURCE_TABLE_CHARS = 60000;
const MAX_REFERENCE_CHARS = 12000;

const EXACT_TITLES = [
  '技术偏离表',
  '技术规格偏离表',
  '技术参数偏离表',
  '技术响应表',
  '技术规格响应表',
  '技术参数响应表',
];

function normalizeTechnicalDeviationTableMode(value) {
  return String(value || '').trim() === 'standard' ? 'standard' : 'source-first';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isTechnicalDeviationTableContext(chapter, parentChapters = []) {
  const titles = [chapter, ...(Array.isArray(parentChapters) ? parentChapters : [])]
    .map((item) => normalizeText(item?.title ?? item))
    .filter(Boolean);
  return titles.some((title) => (
    EXACT_TITLES.some((keyword) => title.includes(keyword))
    || (title.includes('技术') && title.includes('偏离'))
    || (title.includes('技术') && title.includes('响应') && title.includes('表'))
  ));
}

function splitLinesWithOffsets(text) {
  const lines = [];
  const pattern = /.*(?:\r\n|\n|\r|$)/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (!match[0]) break;
    const raw = match[0];
    const content = raw.replace(/[\r\n]+$/, '');
    lines.push({ text: content, start: match.index, end: match.index + content.length });
  }
  return lines;
}

function isMarkdownTableRow(line) {
  const text = String(line || '').trim();
  return text.includes('|') && text.replace(/\\\|/g, '').split('|').length >= 3;
}

function isMarkdownSeparator(line) {
  if (!isMarkdownTableRow(line)) return false;
  const cells = String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function extractMarkdownTables(text) {
  const lines = splitLinesWithOffsets(text);
  const tables = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!isMarkdownTableRow(lines[index].text) || !isMarkdownSeparator(lines[index + 1].text)) continue;
    let last = index + 1;
    while (last + 1 < lines.length && isMarkdownTableRow(lines[last + 1].text)) last += 1;
    tables.push({ type: 'markdown', start: lines[index].start, end: lines[last].end, text: text.slice(lines[index].start, lines[last].end) });
    index = last;
  }
  return tables;
}

function extractHtmlTables(text) {
  const tables = [];
  const pattern = /<table\b[\s\S]*?<\/table>/gi;
  let match;
  while ((match = pattern.exec(text))) {
    tables.push({ type: 'html', start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return tables;
}

function scoreCandidate(candidate) {
  const tableText = normalizeText(candidate.text.replace(/<[^>]+>/g, ' '));
  const context = normalizeText([candidate.before, tableText, candidate.after].join(' '));
  let score = 0;
  for (const title of EXACT_TITLES) {
    if (context.includes(title)) score += 100;
  }
  if (context.includes('技术') && context.includes('偏离')) score += 70;
  if (context.includes('技术') && context.includes('响应')) score += 35;
  if (tableText.includes('偏离情况')) score += 55;
  if (tableText.includes('偏离说明')) score += 45;
  if (tableText.includes('偏离')) score += 30;
  if (tableText.includes('投标响应')) score += 30;
  if (tableText.includes('招标要求')) score += 20;
  if (tableText.includes('技术要求') || tableText.includes('技术参数')) score += 20;
  if (tableText.includes('条款号')) score += 10;
  if (!context.includes('技术') && /(商务偏离|价格明细|开标一览)/.test(context)) score -= 100;
  return score;
}

function findTechnicalDeviationTable(tenderMarkdown) {
  const text = String(tenderMarkdown || '');
  if (!text.trim()) return null;
  const candidates = [...extractMarkdownTables(text), ...extractHtmlTables(text)]
    .map((table) => ({
      ...table,
      before: text.slice(Math.max(0, table.start - SOURCE_CONTEXT_CHARS), table.start),
      after: text.slice(table.end, Math.min(text.length, table.end + SOURCE_CONTEXT_CHARS)),
    }))
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate) }))
    .filter((candidate) => candidate.score >= 70)
    .sort((left, right) => right.score - left.score || left.start - right.start);
  if (!candidates.length) return null;
  const best = candidates[0];
  return {
    type: best.type,
    score: best.score,
    table: best.text.slice(0, MAX_SOURCE_TABLE_CHARS),
    before: best.before.trim(),
    after: best.after.trim(),
  };
}

function truncateReference(value) {
  const text = String(value || '').trim();
  return text.length > MAX_REFERENCE_CHARS ? text.slice(0, MAX_REFERENCE_CHARS) + '\n（参考内容过长，已截断）' : text;
}

function normalizeResponsePrefix(value) {
  return String(value || '').replace(/[\r\n|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || '满足，我司产品';
}

function buildResponseRules(responsePrefix) {
  const prefix = normalizeResponsePrefix(responsePrefix);
  return [
    `每一行默认按完全满足响应，“投标响应/响应内容”必须以“${prefix}”开头。`,
    '开头之后必须紧扣该行招标技术要求，逐项复述为我方承诺或说明；不得只写“满足”或使用与本行无关的通用话术。',
    '“偏离情况”统一填写“无偏离”；“偏离说明”统一填写“完全满足招标要求”。',
    '如果原表把响应和偏离合并在一列，则在该列依次写明响应内容和“无偏离”；不得遗漏任何已有行。',
  ];
}

function buildSourceInstruction(source, responseFileRequirements, responsePrefix) {
  return [
    '本章是技术偏离表，系统已从招标文件中识别到原表。',
    '',
    '必须遵守：',
    '1. 优先使用下方招标文件原表，不得改动表名含义、表头、列顺序和已有行顺序。',
    '2. 把招标技术要求原文保留在对应行，在“投标响应/响应内容”和“偏离情况/偏离说明”等可填列中逐项填写。',
    ...buildResponseRules(responsePrefix).map((rule, index) => `${index + 3}. ${rule}`),
    '7. 不得编造招标文件未要求的品牌、型号、参数或证书；需要具体值但资料未提供时，只承诺满足该项招标要求，不擅自增加数值。',
    '8. 输出 Markdown 表格，只输出表格本身；不输出章节标题、表前说明、表后总结。',
    '',
    '招标文件中识别的原表（' + (source.type === 'html' ? 'HTML 原表，请等价转为 Markdown 表格' : 'Markdown 原表') + '）：',
    source.table,
    '',
    '原表前后语境：',
    truncateReference([source.before, source.after].join('\n')) || '无',
    '',
    '响应文件格式要求摘要：',
    truncateReference(responseFileRequirements) || '未提供',
  ].join('\n');
}

function buildStandardInstruction(techRequirements, responseFileRequirements, responsePrefix) {
  return [
    '本章是技术偏离表。本次使用系统标准表格，表头必须严格为：',
    '| 序号 | 招标文件条款号 | 招标文件技术要求/参数 | 投标响应 | 偏离情况 | 偏离说明 |',
    '| --- | --- | --- | --- | --- | --- |',
    '',
    '必须遵守：',
    '1. 从下方技术要求中逐项拆分填行，保留条款号和要求原意，不得遗漏实质性要求。',
    ...buildResponseRules(responsePrefix).map((rule, index) => `${index + 2}. ${rule}`),
    '6. 不得编造招标文件未要求的品牌、型号、参数或证书；需要具体值但资料未提供时，只承诺满足该项招标要求，不擅自增加数值。',
    '7. 只输出一个 Markdown 表格，不输出章节标题、表前说明、表后总结。',
    '',
    '招标文件技术要求：',
    truncateReference(techRequirements) || '未提供，请保留一行【待填写】供用户补充',
    '',
    '响应文件格式要求摘要：',
    truncateReference(responseFileRequirements) || '未提供',
  ].join('\n');
}

function resolveTechnicalDeviationTableContext({ mode, tenderMarkdown, responseFileRequirements, techRequirements, responsePrefix }) {
  const requestedMode = normalizeTechnicalDeviationTableMode(mode);
  const source = requestedMode === 'source-first' ? findTechnicalDeviationTable(tenderMarkdown) : null;
  if (source) {
    return { requestedMode, modeUsed: 'source', source, instruction: buildSourceInstruction(source, responseFileRequirements, responsePrefix) };
  }
  return {
    requestedMode,
    modeUsed: 'standard',
    source: null,
    fallback: requestedMode === 'source-first',
    instruction: buildStandardInstruction(techRequirements, responseFileRequirements, responsePrefix),
  };
}

module.exports = {
  findTechnicalDeviationTable,
  isTechnicalDeviationTableContext,
  normalizeTechnicalDeviationTableMode,
  resolveTechnicalDeviationTableContext,
};
