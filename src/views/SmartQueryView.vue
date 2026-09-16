<script setup>
import { ref, onMounted } from 'vue'
import { load } from '../data/store'
import {
  parseIntent, fallbackParse, hasLLM, loadLLMConfig,
  getKey, setKey, getBaseUrl, setBaseUrl, effectiveBaseUrl
} from '../utils/llm'
import { executeQuery } from '../utils/queryEngine'

const ready = ref(false)
const input = ref('')
const loading = ref(false)
const llmMode = ref(false)
const messages = ref([])

/** API 设置（BYOK：密钥由使用者自己提供，只存本机） */
const showSettings = ref(false)
const keyInput = ref('')
const baseInput = ref('')
const keySaved = ref(false)

const examples = [
  '上月 OTD 低于 80% 的供应商有哪些',
  '采购金额最大的 5 家供应商',
  '电子元器件品类谁占采购额最大',
  'TCO 最高的供应商是谁',
  '哪个品类价格涨得最快',
  '验收合格率最低的供应商'
]

onMounted(async () => {
  await load()
  await loadLLMConfig()
  keySaved.value = hasLLM()
  llmMode.value = keySaved.value
  baseInput.value = getBaseUrl()
  ready.value = true
})

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
  let mode = hasLLM() ? 'LLM 解析' : '规则解析'
  if (!intent) {
    intent = fallbackParse(q)
    mode = hasLLM() ? '规则解析（LLM 未返回有效参数）' : '规则解析'
  }

  const result = executeQuery(intent)
  push('bot', result.text, { mode, source: result.source })
  loading.value = false
}

function clear() { messages.value = [] }

function openSettings() {
  keyInput.value = getKey()
  baseInput.value = getBaseUrl()
  showSettings.value = !showSettings.value
}

function saveKey() {
  const k = keyInput.value.trim()
  setKey(k)
  setBaseUrl(baseInput.value.trim())
  keySaved.value = hasLLM()
  llmMode.value = keySaved.value
  showSettings.value = false
}

function removeKey() {
  setKey('')
  keyInput.value = ''
  keySaved.value = false
  llmMode.value = false
  showSettings.value = false
}
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
        <span class="tag" :class="llmMode ? 'tag-ok' : 'tag-warning'">{{ llmMode ? 'LLM 模式' : '规则解析模式' }}</span>
        <button class="btn btn-ghost" @click="openSettings">API 设置</button>
        <button class="btn btn-ghost" @click="clear">清空对话</button>
      </div>
    </div>

    <div v-if="showSettings" class="card settings">
      <div class="card-title">模型接入设置（自带密钥 · BYOK）</div>
      <div class="set-row">
        <label class="set-label">API Key</label>
        <input v-model="keyInput" type="password" class="set-input" placeholder="粘贴你自己的 API Key" autocomplete="off" />
      </div>
      <div class="set-row">
        <label class="set-label">接口地址</label>
        <input v-model="baseInput" type="text" class="set-input" :placeholder="effectiveBaseUrl() || '留空则使用默认配置'" />
      </div>
      <div class="set-note">
        密钥仅保存在<b>本机浏览器 localStorage</b>，不上传服务器、不写入构建产物；清除后自动回到规则解析模式。<br/>
        接口地址可改为你自己的代理服务，请求将由浏览器直连该地址。
      </div>
      <div class="set-actions">
        <button class="btn" @click="saveKey">保存</button>
        <button v-if="keySaved" class="btn btn-ghost danger" @click="removeKey">清除本机密钥</button>
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
        ④ 密钥由使用者自带（BYOK）：构建产物不含任何密钥，未配置时自动降级为关键词规则解析，功能不受影响。
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
.btn-ghost { background: #fff; color: var(--text-2); border: 1px solid var(--border); }
.btn-ghost:hover { border-color: var(--primary); color: var(--primary); }
.btn-ghost.danger:hover { border-color: var(--danger); color: var(--danger); }

.settings { margin-bottom: 16px; }
.set-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.set-label { width: 76px; font-size: 13px; color: var(--text-2); flex: none; }
.set-input { flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; outline: none; }
.set-input:focus { border-color: var(--primary); }
.set-note { font-size: 12px; color: var(--text-2); line-height: 1.7; background: var(--bg); border-radius: 8px; padding: 10px 12px; }
.set-note b { color: var(--text); }
.set-actions { display: flex; gap: 8px; margin-top: 12px; }
</style>
