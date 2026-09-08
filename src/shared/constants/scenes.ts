/**
 * 场景 / 对象 / 语气选项（值域与 docs/04 契约、数据库枚举一致）。
 */
import type { Audience, SourceType, Tone } from '../types/ai';

/** antd Select/Segmented 的 options 需要可写数组，故不使用 readonly */
export const SOURCE_TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: 'email', label: '商务邮件' },
  { value: 'instant_message', label: '即时消息（IM）' },
  { value: 'meeting', label: '会议（书面/纪要）' },
  { value: 'report', label: '文档 / 报告' },
];

export const AUDIENCE_OPTIONS: { value: Audience; label: string }[] = [
  { value: 'colleague', label: '同事' },
  { value: 'manager', label: '上级 / 老板' },
  { value: 'client', label: '客户' },
  { value: 'supplier', label: '供应商 / 合作方' },
  { value: 'other', label: '其他' },
];

export const TONE_OPTIONS: { value: Tone; label: string }[] = [
  { value: 'neutral', label: '中性' },
  { value: 'formal', label: '正式' },
  { value: 'friendly', label: '友好' },
  { value: 'firm', label: '坚定' },
];
