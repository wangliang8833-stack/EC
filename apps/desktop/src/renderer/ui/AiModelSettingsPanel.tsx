import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Select, Space, Tag, message } from 'antd'
import type { AiModelSettings, AiProviderCode } from '@ecommerce/shared'

const PROVIDERS: Array<{ value: AiProviderCode; label: string; baseUrl: string }> = [
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { value: 'qwen', label: '通义千问（兼容接口）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'openai_compatible', label: '其他 OpenAI 兼容服务', baseUrl: '' }
]

export function AiModelSettingsPanel({ isPreview, settings, onChanged }: { isPreview: boolean; settings: AiModelSettings | null; onChanged: (settings: AiModelSettings) => void }): React.JSX.Element {
  const [provider, setProvider] = useState<AiProviderCode>('openai')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [modelsText, setModelsText] = useState('')
  const models = useMemo(() => [...new Set(modelsText.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean))], [modelsText])
  const [defaultModel, setDefaultModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [messageApi, context] = message.useMessage()

  useEffect(() => {
    if (!settings) return
    setProvider(settings.provider); setBaseUrl(settings.baseUrl); setModelsText(settings.models.join('\n')); setDefaultModel(settings.defaultModel ?? '')
  }, [settings])

  function changeProvider(value: AiProviderCode): void {
    setProvider(value)
    const preset = PROVIDERS.find((item) => item.value === value)
    if (preset?.baseUrl) setBaseUrl(preset.baseUrl)
  }

  async function save(): Promise<void> {
    if (isPreview || !window.desktopApi) { messageApi.info('浏览器预览不会保存密钥，请启动 Electron 主程序。'); return }
    if (models.length === 0 || !defaultModel) { messageApi.warning('请至少填写一个模型并选择默认模型。'); return }
    setSaving(true); setTestMessage(null)
    try {
      const updated = await window.desktopApi.ai.updateSettings({ provider, baseUrl, models, defaultModel, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      setApiKey(''); onChanged(updated); messageApi.success('大模型设置已安全保存。')
    } catch (reason) { messageApi.error(errorMessage(reason)) } finally { setSaving(false) }
  }

  async function test(): Promise<void> {
    if (isPreview || !window.desktopApi) { messageApi.info('浏览器预览无法连接模型服务。'); return }
    setTesting(true); setTestMessage(null)
    try {
      const result = await window.desktopApi.ai.testConnection(defaultModel || undefined)
      setTestMessage(`${result.message} · ${result.model}`); messageApi.success(result.message)
    } catch (reason) { setTestMessage(errorMessage(reason)); messageApi.error(errorMessage(reason)) } finally { setTesting(false) }
  }

  return <section className="settings-section ai-settings-section">
    {context}
    <div className="settings-section-heading"><div><h2>AI 大模型接入</h2><p>统一供 AI 选品、AI 自动运营和 AI 数据分析使用；API Key 通过系统安全存储加密保存。</p></div>{settings?.apiKeyConfigured && settings.models.length > 0 ? <Tag color="green">已接入</Tag> : <Tag color="red">未接入AI模型</Tag>}</div>
    <div className="ai-settings-form">
      <label><span>服务商</span><Select value={provider} options={PROVIDERS.map(({ value, label }) => ({ value, label }))} onChange={changeProvider} /></label>
      <label><span>接口地址</span><Input value={baseUrl} placeholder="https://api.example.com/v1" onChange={(event) => setBaseUrl(event.target.value)} /></label>
      <label className="ai-settings-models"><span>模型列表</span><Input.TextArea value={modelsText} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={'每行一个模型，例如：\ngpt-5.4'} onChange={(event) => setModelsText(event.target.value)} /></label>
      <label><span>默认模型</span><Select value={defaultModel || null} placeholder="请选择默认模型" options={models.map((value) => ({ value, label: value }))} onChange={setDefaultModel} /></label>
      <label><span>API Key</span><Input.Password value={apiKey} autoComplete="new-password" placeholder={settings?.apiKeyConfigured ? '已保存；留空表示不更换' : '请输入 API Key'} onChange={(event) => setApiKey(event.target.value)} /></label>
    </div>
    <div className="ai-settings-actions"><Space><Button type="primary" loading={saving} onClick={() => void save()}>保存设置</Button><Button loading={testing} disabled={!settings?.apiKeyConfigured} onClick={() => void test()}>测试连接</Button></Space><span>仅发送有限的标准化指标与证据，不发送 Cookie、登录凭据或完整网页。</span></div>
    {testMessage ? <Alert className="ai-settings-test" type={testMessage.includes('成功') ? 'success' : 'error'} showIcon title={testMessage} /> : null}
  </section>
}

function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
