// T034 — 录音页（渲染进程）
//
// 功能（docs/08 T034）：
// - 权限状态：挂载时探测麦克风（getUserMedia 后立即停止）；
//   denied 时显示清晰提示（不崩溃、可重试）。
// - 录音时长实时显示（MM:SS）。
// - 开始 / 停止录音（MediaRecorder，audio/webm）。
// - 录音列表 + 删除（删除会同时删除临时目录中的文件）。
// - 不默认永久保存：落盘需用户勾选“保存到磁盘”（7 天自动清理）；
//   未勾选时录音只保留在本次会话内存中（T035 转写可用）。
//
// 安全：renderer 不直接碰文件系统；文件写/删全部经最小化 IPC。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, List, Space, Spin, Tag, Typography } from 'antd';
import { AudioOutlined, DeleteOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { formatDurationMs } from '../../../shared/logic/recording';
import type { PermissionProbeResult, RecordingSavedView } from '../../../shared/types/recording';

type RecState =
  | { phase: 'idle' }
  | { phase: 'recording'; startedAt: number }
  | { phase: 'error'; message: string };

interface SessionRecording {
  /** 已落盘 = UUID；仅内存 = 'mem-' 前缀 */
  id: string;
  path?: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function RecordingPage() {
  const [permission, setPermission] = useState<PermissionProbeResult>({ state: 'unknown' });
  const [probing, setProbing] = useState(true);
  const [rec, setRec] = useState<RecState>({ phase: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [saveToDisk, setSaveToDisk] = useState(false);
  const [list, setList] = useState<SessionRecording[]>([]);
  const [saving, setSaving] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const refreshList = useCallback(async () => {
    const r = await window.desktopAPI?.listRecordings();
    if (r?.ok) {
      setList((prev) => {
        // 合并：磁盘录音（覆盖）+ 仅内存录音（保留）
        const disk: SessionRecording[] = r.data.map((d: RecordingSavedView) => ({
          id: d.id,
          path: d.path,
          sizeBytes: d.sizeBytes,
          mimeType: d.mimeType,
          createdAt: d.createdAt,
        }));
        const memOnly = prev.filter((p) => p.id.startsWith('mem-'));
        return [...disk, ...memOnly].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    }
  }, []);

  // 挂载：探测麦克风权限 + 加载已有录音
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermission({ state: 'unavailable', reason: '当前环境不支持媒体设备（navigator.mediaDevices 不存在）' });
        setProbing(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        if (!cancelled) setPermission({ state: 'granted' });
      } catch (e) {
        const name = e instanceof Error ? e.name : 'Error';
        if (!cancelled) {
          setPermission({
            state: 'denied',
            reason:
              name === 'NotAllowedError'
                ? '麦克风权限被拒绝。请检查系统设置（Windows 设置 → 隐私 → 麦克风 → 允许桌面应用访问麦克风），然后重试。'
                : `无法访问麦克风（${name}）。请确认已连接麦克风并检查系统权限设置。`,
          });
        }
      } finally {
        if (!cancelled) setProbing(false);
      }
    };
    void probe();
    void refreshList();
    return () => {
      cancelled = true;
      clearTimer();
      stopStream();
    };
  }, [clearTimer, refreshList, stopStream]);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setRec({ phase: 'error', message: '当前环境不支持录音（无媒体设备 API）' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const MIME =
        typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        setRec({ phase: 'error', message: '录音过程中发生错误，已自动停止。请重试。' });
        clearTimer();
        stopStream();
        recorderRef.current = null;
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const createdAt = new Date().toISOString();
        clearTimer();
        stopStream();
        recorderRef.current = null;
        if (blob.size === 0) {
          setRec({ phase: 'error', message: '未采集到音频数据（录音可能为空）。请确认麦克风可用后重试。' });
          return;
        }
        if (saveToDisk) {
          setSaving(true);
          try {
            const data = await blob.arrayBuffer();
            const r = await window.desktopAPI?.saveRecording(data, blob.type);
            if (r && r.ok) {
              setList((prev) => [{ id: r.data.id, path: r.data.path, sizeBytes: r.data.sizeBytes, mimeType: r.data.mimeType, createdAt }, ...prev]);
              setRec({ phase: 'idle' });
            } else {
              // 落盘失败：降级为仅内存并提示（不崩溃）
              setList((prev) => [{ id: `mem-${Date.now()}`, sizeBytes: blob.size, mimeType: blob.type, createdAt }, ...prev]);
              setRec({ phase: 'error', message: `保存到磁盘失败（${r?.error.message ?? '未知错误'}），本次录音仅保留在内存中。` });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setList((prev) => [{ id: `mem-${Date.now()}`, sizeBytes: blob.size, mimeType: blob.type, createdAt }, ...prev]);
            setRec({ phase: 'error', message: `保存录音异常（${msg}），本次录音仅保留在内存中。` });
          } finally {
            setSaving(false);
          }
        } else {
          setList((prev) => [{ id: `mem-${Date.now()}`, sizeBytes: blob.size, mimeType: blob.type, createdAt }, ...prev]);
          setRec({ phase: 'idle' });
        }
      };
      recorder.start(250);
      const startedAt = Date.now();
      setElapsedMs(0);
      setRec({ phase: 'recording', startedAt });
      timerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAt);
      }, 500);
    } catch (e) {
      const name = e instanceof Error ? e.name : 'Error';
      setRec({
        phase: 'error',
        message:
          name === 'NotAllowedError'
            ? '麦克风权限被拒绝，无法开始录音。请检查系统麦克风权限后重试。'
            : `无法启动录音（${name}）。请确认麦克风已连接且未被其他应用占用。`,
      });
      stopStream();
    }
  }, [clearTimer, saveToDisk, stopStream]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') {
      r.stop();
    }
  }, []);

  const remove = useCallback(
    async (item: SessionRecording) => {
      if (!item.id.startsWith('mem-')) {
        const r = await window.desktopAPI?.deleteRecording(item.id);
        if (!r?.ok) {
          // 删除失败不清除本地项，提示重试
          return;
        }
      }
      setList((prev) => prev.filter((p) => p.id !== item.id));
    },
    [],
  );

  const recording = rec.phase === 'recording';

  return (
    <div style={{ maxWidth: 720 }}>
      <Typography.Title level={4}>
        <AudioOutlined /> 录音
      </Typography.Title>

      {probing ? (
        <Spin tip="正在检测麦克风…" />
      ) : (
        <Alert
          style={{ marginBottom: 16 }}
          type={permission.state === 'granted' ? 'success' : 'error'}
          showIcon
          message={
            permission.state === 'granted'
              ? '麦克风可用'
              : permission.state === 'denied'
                ? '麦克风不可用'
                : '当前环境不支持录音'
          }
          description={permission.reason}
        />
      )}

      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Text style={{ fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>
          {formatDurationMs(elapsedMs)}
        </Typography.Text>
        {recording ? (
          <Button danger type="primary" icon={<PauseCircleOutlined />} onClick={stop}>
            停止录音
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<AudioOutlined />}
            disabled={permission.state !== 'granted' || probing}
            loading={saving}
            onClick={() => void start()}
          >
            开始录音
          </Button>
        )}
      </Space>

      {rec.phase === 'error' && (
        <Alert style={{ marginBottom: 16 }} type="warning" showIcon message={rec.message} closable onClose={() => setRec({ phase: 'idle' })} />
      )}

      <Checkbox checked={saveToDisk} onChange={(e) => setSaveToDisk(e.target.checked)} style={{ marginBottom: 16 }}>
        录音结束后保存到磁盘（临时目录，7 天后自动清理；不勾选则仅保留在本次会话）
      </Checkbox>

      {list.length === 0 ? (
        <Typography.Text type="secondary">本次会话还没有录音。</Typography.Text>
      ) : (
        <List
          dataSource={list}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button key="del" size="small" danger icon={<DeleteOutlined />} onClick={() => void remove(item)}>
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    {formatBytes(item.sizeBytes)}
                    <Tag>{item.mimeType || 'audio/webm'}</Tag>
                    {item.id.startsWith('mem-') ? <Tag color="orange">仅内存</Tag> : <Tag color="blue">已存盘</Tag>}
                  </Space>
                }
                description={new Date(item.createdAt).toLocaleString()}
              />
            </List.Item>
          )}
        />
      )}

      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16, fontSize: 12 }}>
        隐私说明：录音默认不永久保存。保存到磁盘的文件位于应用数据目录的临时录音文件夹，超过 7 天自动删除，也可随时手动删除。
      </Typography.Text>
    </div>
  );
}
