import { message } from 'antd';
import { useCallback, useState } from 'react';
import type { AnalyzeDraftResult } from '../../../shared/types/ai';
import { PageHeader } from '../components/PageHeader';
import { AnalysisResultCard } from './workspace/AnalysisResultCard';
import { DraftForm, type DraftFormSubmit } from './workspace/DraftForm';
import { mockAnalyze } from './workspace/mockAnalysis';

/**
 * 工作区（T008）：左侧表单 + 右侧结果区。
 * T022–T025 将替换 mockAnalyze 为真实 AI 调用，并把确认动作接入数据库。
 */
export default function WorkspacePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeDraftResult | null>(null);

  const handleSubmit = useCallback(async (submit: DraftFormSubmit) => {
    setLoading(true);
    try {
      const r = await mockAnalyze(submit.input);
      setResult(r);
    } catch {
      message.error('分析失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleConfirm = useCallback(() => {
    message.info(
      'mock 阶段：保存原文与生成复习任务将在 T022–T032 接入数据库后生效',
    );
  }, []);

  return (
    <div>
      <PageHeader
        title="工作区"
        description="记录中文原意和英文草稿，调用 AI 分析并查看修改结果"
      />
      <div className="wec-workspace-columns">
        <div className="wec-form-col">
          <div className="wec-panel">
            <DraftForm loading={loading} onSubmit={handleSubmit} />
          </div>
        </div>
        <div className="wec-result-col">
          <AnalysisResultCard
            loading={loading}
            result={result}
            onConfirm={handleConfirm}
          />
        </div>
      </div>
    </div>
  );
}
