// 配置读写：存放在 Electron userData 目录下的 config.json，API Key 尽量用系统钥匙串加密。
const fs = require('fs');
const path = require('path');

// 国内大模型预设，统一走 OpenAI 兼容接口。模型名可在设置页改。
const LLM_PRESETS = {
  qwen: { label: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  zhipu: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  kimi: { label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0905-preview', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  doubao: { label: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615', keyUrl: 'https://console.volcengine.com/ark' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '', keyUrl: '' },
};

const SEARCH_PRESETS = {
  bocha: { label: '博查 Web Search', keyUrl: 'https://open.bochaai.com' },
  zhipu: { label: '智谱 Web Search', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
};

const DEFAULTS = {
  llm: { provider: 'qwen', baseUrl: LLM_PRESETS.qwen.baseUrl, model: LLM_PRESETS.qwen.model, apiKey: '', temperature: 0.3 },
  search: { provider: 'bocha', apiKey: '', endpoint: '' },
  maxToolCalls: 30,
  theme: 'system',
  sidebarCollapsed: false,
};

const SECRET_FIELDS = [['llm', 'apiKey'], ['search', 'apiKey']];

function createStore(dir, safeStorage) {
  const file = path.join(dir, 'config.json');
  const canEncrypt = () => { try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; } };

  function load() {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    const cfg = {
      ...DEFAULTS, ...raw,
      llm: { ...DEFAULTS.llm, ...raw.llm },
      search: { ...DEFAULTS.search, ...raw.search },
    };
    for (const [sec, key] of SECRET_FIELDS) {
      const v = cfg[sec][key];
      if (typeof v === 'string' && v.startsWith('enc:')) {
        try { cfg[sec][key] = safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch { cfg[sec][key] = ''; }
      }
    }
    return cfg;
  }

  function save(cfg) {
    const out = JSON.parse(JSON.stringify(cfg));
    if (canEncrypt()) {
      for (const [sec, key] of SECRET_FIELDS) {
        if (out[sec][key]) out[sec][key] = 'enc:' + safeStorage.encryptString(out[sec][key]).toString('base64');
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    return load();
  }

  return { load, save };
}

module.exports = { LLM_PRESETS, SEARCH_PRESETS, DEFAULTS, createStore };
