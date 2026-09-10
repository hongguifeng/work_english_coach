import { parseBoldSegments } from '../../../shared/utils/bold';

/**
 * 渲染含 **...** 加粗标记的文本（AI 最小修改版输出约定）。
 * 不含标记的文本原样渲染，兼容旧数据。
 */
export function BoldText({ text }: { text: string }) {
  return (
    <>
      {parseBoldSegments(text).map((seg, i) =>
        seg.bold ? (
          <strong key={i}>{seg.text}</strong>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
