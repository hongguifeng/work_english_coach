// T038：快捷键「按键录制」——按键事件 → Electron accelerator 的纯函数映射测试
//（对应 src/renderer/src/components/ShortcutCaptureBox.tsx 的导出纯函数）。
import { describe, expect, it } from 'vitest';
import { buildAcceleratorFromEvent, keyToAcceleratorPart } from '../src/renderer/src/components/ShortcutCaptureBox';

const ev = (o: Partial<Parameters<typeof buildAcceleratorFromEvent>[0]>) =>
  ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: '', key: '', ...o });

describe('keyToAcceleratorPart', () => {
  it('字母键 KeyA → A', () => {
    expect(keyToAcceleratorPart('KeyA', 'a')).toBe('A');
    expect(keyToAcceleratorPart('KeyZ', 'z')).toBe('Z');
  });

  it('数字键 Digit1 → 1', () => {
    expect(keyToAcceleratorPart('Digit1', '1')).toBe('1');
    expect(keyToAcceleratorPart('Digit0', '0')).toBe('0');
  });

  it('功能键 F1-F24 原样', () => {
    expect(keyToAcceleratorPart('F5', 'F5')).toBe('F5');
    expect(keyToAcceleratorPart('F12', 'F12')).toBe('F12');
    expect(keyToAcceleratorPart('F24', 'F24')).toBe('F24');
  });

  it('特殊键（Space/Enter/Tab/方向键）映射', () => {
    expect(keyToAcceleratorPart('Space', ' ')).toBe('Space');
    expect(keyToAcceleratorPart('Enter', 'Enter')).toBe('Enter');
    expect(keyToAcceleratorPart('Tab', 'Tab')).toBe('Tab');
    expect(keyToAcceleratorPart('ArrowRight', 'ArrowRight')).toBe('ArrowRight');
  });

  it('Numpad 数字退回 key 单字符', () => {
    expect(keyToAcceleratorPart('Numpad1', '1')).toBe('1');
  });

  it('无法映射的键返回 null（含修饰键自身）', () => {
    expect(keyToAcceleratorPart('ShiftLeft', 'Shift')).toBeNull();
    expect(keyToAcceleratorPart('ControlLeft', 'Control')).toBeNull();
    expect(keyToAcceleratorPart('MetaLeft', 'Meta')).toBeNull();
    expect(keyToAcceleratorPart('F30', 'F30')).toBeNull();
  });
});

describe('buildAcceleratorFromEvent', () => {
  it('Ctrl+Shift+Space → CommandOrControl+Shift+Space', () => {
    expect(buildAcceleratorFromEvent(ev({ ctrlKey: true, shiftKey: true, code: 'Space', key: ' ' }))).toBe(
      'CommandOrControl+Shift+Space',
    );
  });

  it('Ctrl+Alt+E → CommandOrControl+Alt+E（顺序固定）', () => {
    expect(buildAcceleratorFromEvent(ev({ ctrlKey: true, altKey: true, code: 'KeyE', key: 'e' }))).toBe(
      'CommandOrControl+Alt+E',
    );
  });

  it('Win 键(meta) 也归入 CommandOrControl', () => {
    expect(buildAcceleratorFromEvent(ev({ metaKey: true, code: 'KeyQ', key: 'q' }))).toBe('CommandOrControl+Q');
  });

  it('无修饰键 → null（避免劫持单键）', () => {
    expect(buildAcceleratorFromEvent(ev({ code: 'KeyE', key: 'e' }))).toBeNull();
  });

  it('仅修饰键（无主键）→ null', () => {
    expect(buildAcceleratorFromEvent(ev({ ctrlKey: true, code: 'ShiftLeft', key: 'Shift' }))).toBeNull();
  });
});
