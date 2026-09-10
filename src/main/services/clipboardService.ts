import { err, ok, type Result } from '../../shared/types/app';

/** 剪贴板后端（生产环境用 Electron clipboard；测试注入 fake）。 */
export interface ClipboardBackend {
  writeText(text: string): void;
  readText(): string;
}

/**
 * 把文本写入系统剪贴板（T024）。
 * 成功返回 ok(true)，失败（Electron 内部异常）返回 err(storage)。
 */
export function writeClipboardText(
  backend: ClipboardBackend,
  text: string,
): Result<boolean> {
  try {
    backend.writeText(text);
    return ok(true);
  } catch {
    return err('storage', '复制到剪贴板失败');
  }
}

/**
 * 读取系统剪贴板文本。
 * 成功返回 ok(text)（剪贴板为空时是空字符串）；失败返回 err(storage)。
 */
export function readClipboardText(backend: ClipboardBackend): Result<string> {
  try {
    return ok(backend.readText());
  } catch {
    return err('storage', '读取剪贴板失败');
  }
}

let shared: Promise<ClipboardBackend> | null = null;

/** 懒加载 Electron clipboard（生产）；调用方用 await getSharedClipboardBackend()。 */
export function getSharedClipboardBackend(): Promise<ClipboardBackend> {
  if (!shared) {
    shared = import('electron').then((mod) => ({
      writeText: (text: string): void => mod.clipboard.writeText(text),
      readText: (): string => mod.clipboard.readText(),
    }));
  }
  return shared;
}
