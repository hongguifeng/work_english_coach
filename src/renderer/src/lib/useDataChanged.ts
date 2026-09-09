import { useEffect, useRef } from 'react';

/**
 * 订阅主进程的 `data:changed` 广播（T017）。
 * 目前触发点为"删除全部数据"；各数据页用它在数据被清空后刷新自身状态。
 *
 * 用 ref 持有最新回调，避免把回调放进依赖数组导致重复订阅/退订。
 */
export function useDataChanged(callback: () => void): void {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    const off = window.desktopAPI.onDataChanged(() => {
      ref.current();
    });
    return off;
  }, []);
}
