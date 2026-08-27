/**
 * LLM 意图解析层
 * 职责：把自然语言问题解析为结构化查询参数（Function Calling 强制 schema）
 * 关键设计：LLM 只输出查询参数，不生成答案正文 —— 从架构上杜绝幻觉
 *
 * 降级模式：无 API key 时（公开部署版本），用关键词规则兜底解析，
 * 保证 demo 交互可用，且部署产物中不包含任何密钥。
 */

const KEY = import.meta.env.VITE_DEEPSEEK_API_KEY || ''
const ENDPOINT = 'https://api.deepseek.com/chat/completions'

export function hasLLM() {
  return !!KEY
}

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
 * 调用 DeepSeek，把自然语言解析为查询参数
 * @returns {object|null} 查询参数；无法解析/越界时返回 null
 */
export async function parseIntent(question) {
  if (!KEY) return null
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
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
 * 降级模式：关键词规则解析（无 key 时）
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

  // OTD / 交付 / 准时
  if (/otd|准时|按时|交付|延期|延误/.test(q)) {
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
  if (/tco|全生命周期|总成本|总拥有成本/.test(q)) {
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
