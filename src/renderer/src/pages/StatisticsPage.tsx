// T033 — 基础学习统计页（渲染进程）
//
// 展示（docs/08 T033）：
// - 本周练习次数 / 独立完成次数 / 待复习任务数量（Statistic 卡片）
// - 高频错误（知识点 skillKey + 次数，Tag 列表）
// - 近七天练习趋势（纯 div 柱状，不引入图表库）
//
// 状态：loading=Spin；error=Alert+重试；空数据=Empty 引导（docs/08 T033 验收）。
// 原则：统计基于 review_attempts；AI 自动修改不算掌握；不显示等级分数。
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, Row, Spin, Statistic, Tag, Typography } from 'antd';
import type { Result } from '../../../shared/types/app';
import type { StudyStatsView } from '../../../shared/types/studyStats';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: StudyStatsView };

/** 近七天趋势柱状图（纯 div；最大计数归一化为 100% 高度）。 */
function TrendBars({ data }: { data: StudyStatsView }) {
  const max = Math.max(1, ...data.trend.map((p) => p.count));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, padding: '8px 4px' }}>
      {data.trend.map((p) => (
        <div key={p.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {p.count > 0 ? p.count : ''}
          </Typography.Text>
          <div
            style={{
              width: '100%',
              maxWidth: 32,
              height: `${Math.max(p.count > 0 ? 12 : 2, (p.count / max) * 80)}px`,
              background: p.count > 0 ? '#1677ff' : '#f0f0f0',
              borderRadius: 2,
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {p.date.slice(5)}
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}

export default function StatisticsPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const r: Result<StudyStatsView> | undefined = await window.desktopAPI?.studyStats();
    if (!r) {
      setState({ status: 'error', message: '内部 API 不可用（preload 未注入）' });
      return;
    }
    if (!r.ok) {
      setState({ status: 'error', message: r.error.message });
      return;
    }
    setState({ status: 'ready', data: r.data });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin tip="加载学习统计…" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <Alert
        type="error"
        showIcon
        message="统计加载失败"
        description={state.message}
        action={<Button size="small" onClick={() => void load()}>重试</Button>}
      />
    );
  }

  const { data } = state;

  if (!data.hasAnyData) {
    return (
      <Empty
        style={{ marginTop: 96 }}
        description={
          <span>
            还没有练习数据。去
            <Link to="/today">「今日训练」</Link>
            完成一次复习，这里就会显示你的统计。
          </span>
        }
      />
    );
  }

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card>
            <Statistic title="本周练习次数" value={data.weekPracticeCount} suffix="次" />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="本周独立完成" value={data.independentCount} suffix="次" />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="待复习任务" value={data.pendingTaskCount} suffix="个" />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card title="近七天练习趋势">
            <TrendBars data={data} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="高频错误（按知识点）">
            {data.topErrors.length === 0 ? (
              <Typography.Text type="secondary">暂无记录。</Typography.Text>
            ) : (
              <span>
                {data.topErrors.map((e) => (
                  <Tag key={e.key} color={e.count >= 5 ? 'red' : e.count >= 3 ? 'orange' : 'default'} style={{ marginBottom: 8 }}>
                    {e.key} × {e.count}
                  </Tag>
                ))}
              </span>
            )}
          </Card>
        </Col>
      </Row>

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16, fontSize: 12 }}>
        统计基于你的练习记录（review_attempts）；AI 自动修改不计入掌握，本应用不生成英语等级分数。
      </Typography.Text>
    </div>
  );
}
