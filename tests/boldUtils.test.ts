// **...** 加粗标记解析（shared/utils/bold）测试
import { describe, it, expect } from 'vitest';
import { parseBoldSegments, stripBoldMarks } from '../src/shared/utils/bold';

describe('parseBoldSegments', () => {
  it('普通文本（无标记）返回单个非加粗片段', () => {
    expect(parseBoldSegments('plain text')).toEqual([{ text: 'plain text', bold: false }]);
  });

  it('成对 ** 标记切分为加粗片段', () => {
    expect(parseBoldSegments('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });

  it('多个加粗片段', () => {
    expect(parseBoldSegments('**a** and **b**')).toEqual([
      { text: '', bold: false },
      { text: 'a', bold: true },
      { text: ' and ', bold: false },
      { text: 'b', bold: true },
    ]);
  });

  it('以 ** 结尾（未闭合）时末段按普通文本处理', () => {
    expect(parseBoldSegments('a ** b')).toEqual([
      { text: 'a ', bold: false },
      { text: ' b', bold: false },
    ]);
  });

  it('以 ** 结束的已闭合标记（尾部空段被跳过）', () => {
    expect(parseBoldSegments('a **b**')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
    ]);
  });

  it('空字符串返回单个空片段', () => {
    expect(parseBoldSegments('')).toEqual([{ text: '', bold: false }]);
  });
});

describe('stripBoldMarks', () => {
  it('去掉成对标记', () => {
    expect(stripBoldMarks('a **b** c')).toBe('a b c');
  });

  it('无标记时原样返回', () => {
    expect(stripBoldMarks('plain text')).toBe('plain text');
  });

  it('渲染结果与去标记结果一致（片段拼接 = strip）', () => {
    const samples = [
      'plain',
      'a **b** c',
      '**a** and **b**',
      'a ** b',
      'a **b**',
      '',
    ];
    for (const s of samples) {
      const joined = parseBoldSegments(s)
        .map((seg) => seg.text)
        .join('');
      expect(joined).toBe(stripBoldMarks(s));
    }
  });
});
