<script setup>
import { ref, onMounted } from 'vue'
import { load } from '../data/store'
import { parseIntent, fallbackParse, hasLLM } from '../utils/llm'
import { executeQuery } from '../utils/queryEngine'

const ready = ref(false)
const input = ref('')
const loading = ref(false)
const llmMode = ref(hasLLM())
const messages = ref([])

const examples = [
  '上月 OTD 低于 80% 的供应商有哪些',
  '采购金额最大的 5 家供应商',
  '电子元器件品类谁占采购额最大',
  'TCO 最高的供应商是谁',
  '哪个品类价格涨得最快',
  '验收合格率最低的供应商'
]

onMounted(async () => { await load(); ready.value = true })

function push(role, content, meta) {
  messages.value.push({ role, content, meta, time: new Date().toLocaleTimeString() })
}

async function ask(question) {
  const q = (question || input.value).trim()
  if (!q || loading.value) return
  input.value = ''
  push('user', q)
  loading.value = true

  // 意图解析：优先 LLM，降级关键词
  let intent = await parseIntent(q)
  let mode = llmMode.value ? 'LLM 解析' : '规则解析'
  if (!intent) {
    intent = fallbackParse(q)
    mode = '规则解析（降级）'
  }

  const result = executeQuery(intent)
  push('bot', result.text, { mode, source: result.source })
  loading.value = false
}

function clear() { messages.value = [] }
</script>

<template>
  <div v-if="!ready" class="empty">数据加载中…</div>
  <div v-else>
    <div class="page-header">
      <div>
        <div class="page-title">智能问答</div>
        <div class="page-desc">用自然语言提问，Agent 解析意图并查询真实数据返回答案（答案可追溯，不生成内容）</div>
      </div>
      <div class="filters">
        <span class="tag" :class="llmMode ? 'tag-ok' : 'tag-warning'">{{ llmMode ? 'LLM 模式' : '演示模式（无 key 降级）' }}</span>
        <button class="btn" @click="clear">清空对话</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">示例问题（点击即可提问）</div>
      <div class="examples">
        <button v-for="e in examples" :key="e" class="example-btn" @click="ask(e)">{{ e }}</button>
      </div>
    </div>

    <div class="card chat-card">
      <div class="chat-body">
        <div v-if="!messages.length" class="empty">在上方点击示例问题，或输入你的问题，例如「上月 OTD 低于 80% 的供应商有哪些」</div>
        <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
          <div class="msg-role">{{ m.role === 'user' ? '你' : '看板助手' }}</div>
          <div class="msg-content">{{ m.content }}</div>
          <div v-if="m.meta" class="msg-meta">
            {{ m.meta.mode }}<span v-if="m.meta.source"> · {{ m.meta.source.time }} · 涉及 {{ m.meta.source.orders }} 条订单</span>
          </div>
        </div>
        <div v-if="loading" class="msg bot"><div class="msg-content">正在查询…</div></div>
      </div>
      <div class="chat-input">
        <input
          v-model="input"
          type="text"
          placeholder="输入你的问题，例如：上月 OTD 低于 80% 的供应商有哪些"
          @keyup.enter="ask()"
        />
        <button class="btn" @click="ask()" :disabled="loading">发送</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">设计说明</div>
      <div class="page-desc" style="line-height: 1.8">
        ① LLM 仅做意图解析（Function Calling 输出结构化查询参数），不生成答案正文；<br/>
        ② 答案全部来自确定性指标函数（metrics.js）计算，可追溯到具体订单数据；<br/>
        ③ 越界问题（闲聊、知识问答）会被明确拒绝而非编造答案；<br/>
        ④ 无 API key 时自动降级为关键词规则解析，公开部署版本不包含任何密钥。
      </div>
    </div>
  </div>
</template>

<style scoped>
.examples { display: flex; flex-wrap: wrap; gap: 8px; }
.example-btn { padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: #fff; font-size: 12px; cursor: pointer; color: var(--text-2); }
.example-btn:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-bg); }
.chat-card { display: flex; flex-direction: column; }
.chat-body { min-height: 260px; max-height: 480px; overflow-y: auto; margin-bottom: 12px; }
.msg { margin-bottom: 14px; max-width: 82%; }
.msg.user { margin-left: auto; }
.msg-role { font-size: 12px; color: var(--text-2); margin-bottom: 4px; }
.msg.user .msg-role { text-align: right; }
.msg-content { padding: 10px 14px; border-radius: 10px; font-size: 13px; line-height: 1.7; background: var(--bg); }
.msg.user .msg-content { background: var(--primary); color: #fff; }
.msg-meta { font-size: 11px; color: var(--text-2); margin-top: 4px; }
.chat-input { display: flex; gap: 8px; }
.chat-input input { flex: 1; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; outline: none; }
.chat-input input:focus { border-color: var(--primary); }
.btn { padding: 8px 16px; background: var(--primary); color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
