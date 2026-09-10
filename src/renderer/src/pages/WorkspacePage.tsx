import { message } from 'antd';
import { useCallback, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { AnalysisResultCard } from './workspace/AnalysisResultCard';
import { DraftForm, type DraftFormSubmit } from './workspace/DraftForm';
import { useWorkspaceStore } from '../lib/workspaceStore';

/**
 * 将 main 返回的 code 映射为中文提示；message 为空时给兜底文案（T022）。
 * main 侧已尽量给出具体 message（如 Zod 细节），有则优先展示。
 */
function humanMessage(code: string, message: string | null): string {
  if (message && message.trim()) return message;
  switch (code) {
    case 'config':
      return '尚未配置 AI（请在「设置」中填写 AI 设置与 API Key）';
    case 'timeout':
      return 'AI 请求超时，请重试或检查网络';
    case 'canceled':
      return '已取消本次检查，可重新提交';
    case 'network':
      return '网络错误，请检查网络后重试';
    case 'parse':
      return 'AI 返回了无法解析的结果，请重试';
    case 'validation':
      return '输入不符合要求，请检查后重试';
    default:
      return '发生未知错误，请重试';
  }
}

/**
 * 工作区（T008 / T022 / T025）：左侧表单 + 右侧结果区。
 * 提交走 IPC `ai:analyze-draft`（主进程调 AI + Zod 校验）；支持取消与重试。
 * AI 分析成功后自动写入历史；「确认并保存」只负责补充学习数据和可选表达。
 */
export default function WorkspacePage() {
  const [loading, setLoading] = useState(false);
  const result = useWorkspaceStore((state) => state.result);
  const setResult = useWorkspaceStore((state) => state.setResult);
  const lastSubmit = useWorkspaceStore((state) => state.lastSubmit);
  const setLastSubmit = useWorkspaceStore((state) => state.setLastSubmit);
  const draftValues = useWorkspaceStore((state) => state.draftValues);
  const setDraftValues = useWorkspaceStore((state) => state.setDraftValues);
  const [error, setError] = useState<string | null>(null);
  // T025：保存相关 UI 状态
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveExpression, setSaveExpression] = useState(true);
  const [historySampleId, setHistorySampleId] = useState<string | null>(null);

  // 仅用于取消/重试的内部状态；用 ref 避免额外 re-render。
  const requestIdRef = useRef<string>('');

  const handleSubmit = useCallback(async (submit: DraftFormSubmit) => {
    setLastSubmit(submit);
    const rid =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `req-${Date.now()}`;
    requestIdRef.current = rid;
    setLoading(true);
    setResult(null);
    setError(null);
    setSaved(false);
    setSaving(false);
    setSaveExpression(true);
    setHistorySampleId(null);
    const r = await window.desktopAPI.aiAnalyzeDraft(submit.input, rid);
    if (r.ok) {
      setResult(r.data);
      const history = await window.desktopAPI.saveAnalysisResult({
        input: submit.input,
        result: r.data,
        saveOriginal: submit.saveOriginal,
        saveExpression: false,
      });
      if (history.ok) setHistorySampleId(history.data.sampleId);
      else message.warning(`历史记录保存失败：${humanMessage(history.error.code, history.error.message)}`);
    } else {
      setError(humanMessage(r.error.code, r.error.message));
    }
    setLoading(false);
  }, [setLastSubmit, setResult]);

  const handleCancel = useCallback(() => {
    void window.desktopAPI.aiAnalyzeDraftCancel(requestIdRef.current);
  }, []);

  const handleRetry = useCallback(() => {
    const s = lastSubmit;
    if (s) void handleSubmit(s);
  }, [handleSubmit, lastSubmit]);

  const handleConfirm = useCallback(async () => {
    const submit = lastSubmit;
    if (!submit || result === null || saved || saving) return;
    setSaving(true);
    const r = await window.desktopAPI.saveAnalysisResult({
      sampleId: historySampleId ?? undefined,
      input: submit.input,
      result,
      saveOriginal: submit.saveOriginal,
      saveExpression,
    });
    setSaving(false);
    if (r.ok) {
      setSaved(true);
      const parts = ['样本', `${r.data.issueCount} 个问题`, '重点知识点'];
      if (r.data.expressionId !== null) parts.push('表达');
      message.success(`已保存：${parts.join(' + ')}`);
    } else {
      message.error(humanMessage(r.error.code, r.error.message));
    }
  }, [result, saved, saving, saveExpression, historySampleId, lastSubmit]);

  return (
    <div>
      <PageHeader
        title="工作区"
        description="记录中文原意和英文草稿，调用 AI 分析并查看修改结果"
      />
      <div className="wec-workspace-columns">
        <div className="wec-form-col">
          <div className="wec-panel">
            <DraftForm
              loading={loading}
              initialValues={draftValues}
              onValuesChange={setDraftValues}
              onSubmit={handleSubmit}
            />
          </div>
        </div>
        <div className="wec-result-col">
          <AnalysisResultCard
            loading={loading}
            result={result}
            error={error}
            saved={saved}
            saving={saving}
            saveExpression={saveExpression}
            onConfirm={() => void handleConfirm()}
            onToggleSaveExpression={setSaveExpression}
            onCancel={loading ? handleCancel : undefined}
            onRetry={handleRetry}
          />
        </div>
      </div>
    </div>
  );
}
