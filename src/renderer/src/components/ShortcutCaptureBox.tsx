// T038：快捷键「按键录制」输入组件（替代自由文本输入）。
// 点击「重新录制」后监听 window keydown（原生事件、捕获阶段）：
//   - 必须含至少一个修饰键（Ctrl/Alt/Win）+ 一个主键；
//   - Esc 取消；
//   - 成功时回调 onCapture(accelerator)，由父组件走既有保存流程（主进程立即重新注册）。
import { useEffect, useState } from 'react';
import { Button, Input, Space, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';

/** DOM 键位 → Electron accelerator 的主键段；无法映射时返回 null。 */
export function keyToAcceleratorPart(code: string, key: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const special: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
  };
  if (special[code]) return special[code];
  if (key.length === 1) return key.toUpperCase();
  return null;
}

type KeyEventLike = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'code' | 'key'>;

/** 按键事件 → Electron accelerator（固定顺序 CommandOrControl+Alt+Shift+主键）。
 *  无修饰键或仅修饰键（无主键）时返回 null。 */
export function buildAcceleratorFromEvent(e: KeyEventLike): string | null {
  const main = keyToAcceleratorPart(e.code, e.key);
  if (!main) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (parts.length === 0) return null;
  return [...parts, main].join('+');
}

export interface ShortcutCaptureBoxProps {
  /** 当前 accelerator（展示用） */
  value: string;
  saving?: boolean;
  onCapture: (accelerator: string) => void;
}

export function ShortcutCaptureBox({ value, saving, onCapture }: ShortcutCaptureBoxProps) {
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(false);
        setHint(null);
        return;
      }
      const acc = buildAcceleratorFromEvent(e);
      if (!acc) {
        setHint('需包含 Ctrl/Alt/Win 修饰键 + 一个主键（如 Ctrl+Shift+E），Esc 取消');
        return;
      }
      setCapturing(false);
      setHint(null);
      onCapture(acc);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, onCapture]);

  return (
    <Space size="middle" align="center" wrap>
      <Space>
        <Input
          readOnly
          style={{ width: 240 }}
          value={capturing ? '' : value}
          placeholder={capturing ? '请按快捷键组合（Esc 取消）' : value}
          status={capturing ? 'warning' : undefined}
          onClick={() => setCapturing(true)}
        />
        <Button
          icon={<EditOutlined />}
          loading={saving}
          onClick={() => {
            setHint(null);
            setCapturing(true);
          }}
        >
          重新录制
        </Button>
      </Space>
      {hint ? (
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          {hint}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
