/**
 * LLM 意图解析层
 * 职责：把自然语言问题解析为结构化查询参数（Function Calling 强制 schema）
 * 关键设计：LLM 只输出查询参数，不生成答案正文 —— 从架构上杜绝幻觉
 *
 * 密钥策略（BYOK / 自带密钥）：
 *   构建产物中不含任何密钥。使用者在页面上自行填入自己的 API Key，
 *   密钥只写入本机 localStorage，请求由浏览器直连使用者自己选择的上游地址。
 *   未填密钥时自动降级为关键词规则解析 —— 演示功能不受影响。
 *
 * 上游地址放在 public/llm-config.json（运行时读取、可编辑），
 * 目的：JS 分包中不出现任何上游服务域名，且便于切换为自建代理。
 */

const KEY_STORE = 'pd.llm.key'
const BASE_STORE = 'pd.llm.base'

/** 运行时读取使用者自己的密钥（不参与构建，不会进入产物） */
export function getKey() {
  try { return localStorage.getItem(KEY_STORE) || '' } catch { return '' }
}
export function setKey(k) {
  try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE) } catch { /* 隐私模式下忽略 */ }
}
export function hasLLM() {
  return !!getKey()
}

/** 上游地址：使用者可覆盖，未设置时回落到 llm-config.json */
export function getBaseUrl() {
  try { return localStorage.getItem(BASE_STORE) || '' } catch { return '' }
}
export function setBaseUrl(u) {
  try { u ? localStorage.setItem(BASE_STORE, u) : localStorage.removeItem(BASE_STORE) } catch { /* 同上 */ }
}

let cfg = { baseUrl: '', model: '' }

/** 运行时拉取上游配置；失败时保持为空（LLM 模式不可用，走规则解析） */
export async function loadLLMConfig() {
  try {
    const res = await fetch('./llm-config.json')
    if (res.ok) cfg = { baseUrl: '', model: '', ...(await res.json()) }
  } catch { /* 无配置文件时静默降级 */ }
  return cfg
}
export function defaultBaseUrl() { return cfg.baseUrl }
export function defaultModel() { return cfg.model }
/** 当前生效的上游地址（使用者设置优先于默认配置） */
export function effectiveBaseUrl() { return getBaseUrl() || cfg.baseUrl }

/** 输出契约：LLM 只允许返回这个 schema 的参数 */
const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    target: { type: 'string', enum: ['supplier', 'category'] },
    metric: {
      type: 'string',
      enum: ['otd', 'spend', 'quality', 'tco', 'concentration', 'price_trend']
    },
    operator: { type: 'string', enum: ['<', '>', 'top_n'] },
    value: { type: 'number', description: '阈值；top_n 时为 N' },
    time: { type: 'string', enum: ['last_month', 'last_3_months', 'last_12_months', 'all'] }
  },
  required: ['target', 'metric', 'time']
}

const SYSTEM_PROMPT =
  '你是采购数据看板的查询意图解析器。把用户的问题解析成对 query_data 工具的调用参数。' +
  '只调用工具，不要输出任何其他文字。如果问题超出采购数据查询范围（如闲聊、知识问答），不要调用工具。'

/**
 * 调用上游大模型，把自然语言解析为查询参数
 * @returns {object|null} 查询参数；无密钥 / 解析失败 / 越界时返回 null
 */
export async function parseIntent(question) {
  const key = getKey()
  const base = effectiveBaseUrl()
  if (!key || !base) return null
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: cfg.model || undefined,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'query_data',
              description: '查询采购数据看板中的供应商、品类、订单指标',
              parameters: QUERY_SCHEMA
            }
          }
        ],
        tool_choice: 'auto',
        temperature: 0
      })
    })
    if (!res.ok) return null
    const data = await res.json()
    const call = data.choices?.[0]?.message?.tool_calls?.[0]
    if (!call || call.function?.name !== 'query_data') return null
    return JSON.parse(call.function.arguments)
  } catch (e) {
    console.warn('[llm] parseIntent failed:', e.message)
    return null
  }
}

/* ------------------------------------------------------------------
 * 降级模式：关键词规则解析（无密钥时）
 * ------------------------------------------------------------------ */

const CATEGORIES = ['电子元器件', '结构件', '包装材料', '化工原料', '五金标准件']

function matchTime(q) {
  if (/近3个月|最近三个月|近三个月/.test(q)) return 'last_3_months'
  if (/上月|上个月|最近一个月|近1个月/.test(q)) return 'last_month'
  if (/近12个月|近一年|全年|今年/.test(q)) return 'last_12_months'
  return 'all'
}

function matchCategory(q) {
  return CATEGORIES.find(c => q.includes(c)) || null
}

/** 关键词兜底解析，覆盖常见问法 */
export function fallbackParse(question) {
  const q = question.trim()
  const time = matchTime(q)
  const category = matchCategory(q)

  // 数字提取
  const numMatch = q.match(/(\d+(?:\.\d+)?)/)
  const num = numMatch ? parseFloat(numMatch[1]) : 0

  // OTD / 交付 / 准时（大小写不敏感：示例问题里写的是大写 OTD）
  if (/otd|准时|按时|交付|延期|延误/i.test(q)) {
    const op = /低于|不足|小于|差于|下降/.test(q) ? '<' : /高于|超过|大于/.test(q) ? '>' : 'top_n'
    return { target: 'supplier', metric: 'otd', operator: op, value: op === 'top_n' ? 5 : (num || 80), time }
  }
  // 采购额 / 金额 / 排名
  if (/采购额|金额|花费|采购量|top|前\d|排名|最大|最多/.test(q)) {
    const op = /top|前|排名|最大|最多/.test(q) ? 'top_n' : 'top_n'
    const n = num || 5
    if (category) {
      // 某品类的供应商金额
      return { target: 'supplier', metric: 'spend', operator: 'top_n', value: n, time }
    }
    return { target: 'supplier', metric: 'spend', operator: 'top_n', value: n, time }
  }
  // 集中度 / 依赖 / 占比
  if (/集中|依赖|占比|单一|垄断|谁最大|份额/.test(q)) {
    return { target: 'category', metric: 'concentration', operator: 'top_n', value: 1, time }
  }
  // TCO / 全生命周期成本
  if (/tco|全生命周期|总成本|总拥有成本/i.test(q)) {
    return { target: 'supplier', metric: 'tco', operator: 'top_n', value: 1, time }
  }
  // 价格趋势 / 涨幅
  if (/价格|单价|涨价|涨幅|涨得|趋势/.test(q)) {
    return { target: 'category', metric: 'price_trend', operator: 'top_n', value: 1, time }
  }
  // 质量 / 合格率
  if (/质量|合格率|合格/.test(q)) {
    return { target: 'supplier', metric: 'quality', operator: 'top_n', value: 1, time }
  }
  return null
}
