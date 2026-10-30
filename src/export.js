// 把报告（Markdown）导出为 Word、Excel、Markdown 文件。
const { marked } = require('marked');
const docx = require('docx');
const ExcelJS = require('exceljs');

// 把 marked 的行内 token 摊平成 [{text, bold, italic, code, link}]
function runs(tokens, style = {}) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'strong': out.push(...runs(t.tokens, { ...style, bold: true })); break;
      case 'em': out.push(...runs(t.tokens, { ...style, italic: true })); break;
      case 'codespan': out.push({ ...style, code: true, text: unescape(t.text) }); break;
      case 'link': out.push(...runs(t.tokens, { ...style, link: t.href })); break;
      case 'br': out.push({ ...style, text: '\n' }); break;
      case 'text':
        if (t.tokens) out.push(...runs(t.tokens, style));
        else out.push({ ...style, text: unescape(t.text) });
        break;
      default: out.push({ ...style, text: unescape(t.raw || t.text || '') });
    }
  }
  return out;
}

function unescape(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

const plain = (rs) => rs.map(r => r.text).join('');

// ---------- Word ----------
const FONT = 'Microsoft YaHei';

function docxRuns(rs, extra = {}) {
  return rs.map(r => {
    const run = new docx.TextRun({ text: r.text, bold: r.bold, italics: r.italic, font: r.code ? 'Consolas' : FONT, ...extra, ...(r.link ? { style: 'Hyperlink' } : {}) });
    return r.link ? new docx.ExternalHyperlink({ link: r.link, children: [run] }) : run;
  });
}

function docxBlocks(tokens, level = 0) {
  const out = [];
  for (const t of tokens) {
    if (t.type === 'heading') {
      const h = [docx.HeadingLevel.HEADING_1, docx.HeadingLevel.HEADING_2, docx.HeadingLevel.HEADING_3][Math.min(t.depth, 3) - 1];
      out.push(new docx.Paragraph({ heading: h, children: docxRuns(runs(t.tokens)) }));
    } else if (t.type === 'paragraph') {
      out.push(new docx.Paragraph({ children: docxRuns(runs(t.tokens)), spacing: { after: 120 } }));
    } else if (t.type === 'list') {
      t.items.forEach((item, i) => {
        const inline = item.tokens.filter(x => x.type === 'text' || x.type === 'paragraph');
        const prefix = t.ordered ? `${(t.start || 1) + i}. ` : '';
        out.push(new docx.Paragraph({
          bullet: t.ordered ? undefined : { level },
          indent: t.ordered ? { left: 360 * (level + 1) } : undefined,
          children: [new docx.TextRun({ text: prefix, font: FONT }), ...docxRuns(runs(inline.flatMap(x => x.tokens || [x])))],
        }));
        const nested = item.tokens.filter(x => x.type === 'list');
        out.push(...docxBlocks(nested, level + 1));
      });
    } else if (t.type === 'table') {
      const row = (cells, header) => new docx.TableRow({
        tableHeader: header,
        children: cells.map(c => new docx.TableCell({
          shading: header ? { fill: 'F0EDE6' } : undefined,
          children: [new docx.Paragraph({ children: docxRuns(runs(c.tokens), header ? { bold: true } : {}) })],
        })),
      });
      out.push(new docx.Table({
        width: { size: 100, type: docx.WidthType.PERCENTAGE },
        rows: [row(t.header, true), ...t.rows.map(r => row(r, false))],
      }));
      out.push(new docx.Paragraph({ text: '' }));
    } else if (t.type === 'code') {
      for (const line of t.text.split('\n')) out.push(new docx.Paragraph({ children: [new docx.TextRun({ text: line, font: 'Consolas', size: 18 })] }));
    } else if (t.type === 'blockquote') {
      out.push(...docxBlocks(t.tokens, level));
    }
  }
  return out;
}

async function toDocx(markdown, title) {
  const doc = new docx.Document({
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [{
      children: [
        new docx.Paragraph({ heading: docx.HeadingLevel.TITLE, children: [new docx.TextRun({ text: title, font: FONT })] }),
        ...docxBlocks(marked.lexer(markdown)),
      ],
    }],
  });
  return docx.Packer.toBuffer(doc);
}

// ---------- Excel ----------
async function toXlsx(markdown, title) {
  const tokens = marked.lexer(markdown);
  const tables = [];
  let heading = '';
  for (const t of tokens) {
    if (t.type === 'heading') heading = t.text;
    if (t.type === 'table') tables.push({ heading, t });
  }
  if (!tables.length) throw new Error('报告里没有表格可导出');
  // 6 列对比表放第一张
  tables.sort((a, b) => isCompare(b.t) - isCompare(a.t));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI 工具推荐助手';
  const used = new Set();
  tables.forEach(({ heading, t }, i) => {
    let name = (isCompare(t) ? '工具对比' : heading || `表${i + 1}`).replace(/[\\/?*[\]:]/g, '').slice(0, 28) || `表${i + 1}`;
    while (used.has(name)) name += '_';
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.addRow(t.header.map(c => plain(runs(c.tokens))));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EDE6' } };
    for (const r of t.rows) {
      const row = ws.addRow(r.map(c => plain(runs(c.tokens))));
      r.forEach((c, j) => {
        const link = runs(c.tokens).find(x => x.link)?.link;
        if (link) {
          const cell = row.getCell(j + 1);
          cell.value = { text: String(cell.value), hyperlink: link };
          cell.font = { color: { argb: 'FFB5532F' }, underline: true };
        }
      });
    }
    ws.columns.forEach((col, j) => {
      const max = Math.max(...[t.header[j], ...t.rows.map(r => r[j])].map(c => (c ? plain(runs(c.tokens)).length : 0)));
      col.width = Math.min(Math.max(max * 1.6, 10), 60);
      col.alignment = { wrapText: true, vertical: 'top' };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  });
  const meta = wb.addWorksheet('说明');
  meta.addRow(['需求', title]);
  meta.addRow(['导出时间', new Date().toLocaleString('zh-CN')]);
  meta.getColumn(1).width = 12;
  meta.getColumn(2).width = 80;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function isCompare(t) {
  return t.header.some(c => /工具\/?智能体/.test(c.text)) ? 1 : 0;
}

module.exports = { toDocx, toXlsx };
