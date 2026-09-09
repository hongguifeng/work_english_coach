// T018 — 系统凭据存储后端
//
// 用 keytar（N-API 稳定 ABI，已在 Electron 33 实测可加载）读写 OS 凭据存储：
//   - Windows: DPAPI（随当前 Windows 用户加密，跨机器/跨用户不可解）
//   - macOS:   Keychain
//   - Linux:   Secret Service
//
// 设计要点：
// - 仅暴露最小接口（get/set/delete），把 keytar 的具体 API 隔离在实现内，
//   便于单元测试注入内存版 fake（tests/secretService.test.ts）。
// - keytar 用“动态 import”惰性加载：主进程启动时不加载原生模块，
//   直到第一次真正用到凭据存储才加载，避免把原生模块加载失败变成启动失败。

/** 凭据存储后端（可注入，便于测试）。 */
export interface SecretBackend {
  /** 读取；不存在时返回 null。 */
  get(account: string): Promise<string | null>;
  /** 写入（覆盖已有值）。 */
  set(account: string, secret: string): Promise<void>;
  /** 删除；成功返回 true。 */
  delete(account: string): Promise<boolean>;
}

/**
 * 基于 keytar 的后端。`service` 作为 keytar 的命名空间（应用名），
 * `account` 区分同一应用下的不同凭据。
 */
/** keytar 的 API 形态（避免依赖 CJS/ESM interop 的具体导出方式）。 */
interface KeytarApi {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export function createKeytarBackend(service: string): SecretBackend {
  let modulePromise: Promise<KeytarApi> | null = null;
  const load = (): Promise<KeytarApi> => {
    if (modulePromise === null) {
      modulePromise = import('keytar').then((mod) => {
        // keytar 是 CJS 模块。在 CJS 产物里用 ESM 风格的动态 import() 加载时，
        // 真正的 API 会被放在 `.default` 下（Node cjs-module-lexer 未必能把
        // 其命名导出提升到顶层）。这里同时兼容两种形态：
        //   - 有 .default  → 取 .default
        //   - 否则          → 命名导出已被提升，直接用命名空间本身
        const withDefault = mod as unknown as { default?: KeytarApi };
        return withDefault.default ?? (mod as unknown as KeytarApi);
      });
    }
    return modulePromise;
  };
  return {
    get: async (account) => (await load()).getPassword(service, account),
    set: async (account, secret) => {
      await (await load()).setPassword(service, account, secret);
    },
    delete: async (account) => (await load()).deletePassword(service, account),
  };
}
