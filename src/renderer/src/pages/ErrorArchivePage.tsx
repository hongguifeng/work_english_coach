import { Card } from 'antd';
import { PageHeader } from '../components/PageHeader';

export default function ErrorArchivePage() {
  return (
    <div>
      <PageHeader title="错误档案" description="按错误类别筛选和查看历史问题（T027 实现）" />
      <Card>错误列表与筛选将在 T027 实现。</Card>
    </div>
  );
}
