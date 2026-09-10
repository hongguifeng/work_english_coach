/**
 * **...** 加粗标记解析（AI 最小修改版输出约定）。
 *
 * AI 在 minimalRevision 字段中用 **片段** 标记修改过的内容。
 * 这里提供纯函数解析，供渲染层（BoldText）和复制场景（去标记）共用。
 *
 * 容错：出现奇数个 **（未闭合）时，末尾片段按普通文本处理，
 * 保证渲染结果与 stripBoldMarks 的去标记结果一致。
 */
export interface BoldSegment {
  text: string;
  bold: boolean;
}

/** 把含 **...** 标记的文本切分为片段列表（奇数个 ** 时末尾按普通文本处理）。 */
export function parseBoldSegments(text: string): BoldSegment[] {
  const parts = text.split(/\*\*/);
  const hasUnmatched = parts.length % 2 === 0; // ** 个数为奇数 → 有一个未闭合
  const segments: BoldSegment[] = [];

  parts.forEach((part, i) => {
    // 文本以 ** 结尾时产生空尾段，跳过（前面的片段已覆盖全部内容）
    if (part === '' && i === parts.length - 1) return;
    const bold = i % 2 === 1 && !(hasUnmatched && i === parts.length - 1);
    segments.push({ text: part, bold });
  });

  if (segments.length === 0) {
    segments.push({ text, bold: false });
  }
  return segments;
}

/**
 * 去掉 ** 加粗标记（含未闭合的标记），用于复制纯文本。
 * 与 parseBoldSegments 的渲染结果保持一致（同一解析规则）。
 */
export function stripBoldMarks(text: string): string {
  return parseBoldSegments(text)
    .map((s) => s.text)
    .join('');
}
