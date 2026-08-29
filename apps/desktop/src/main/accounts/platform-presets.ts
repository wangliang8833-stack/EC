import type { AccountPlatform } from '@ecommerce/shared'

export interface PlatformPreset {
  platform: AccountPlatform
  label: string
  loginUrl: string
  collectionProbeUrl: string
  allowedHosts: string[]
  authenticatedHosts: string[]
  credentialHosts: string[]
}

export const TMALL_PRESET: PlatformPreset = {
  platform: 'tmall',
  label: '天猫',
  loginUrl: 'https://myseller.taobao.com/home.htm',
  collectionProbeUrl: 'https://sycm.taobao.com/',
  allowedHosts: ['taobao.com', 'tmall.com', 'alibaba.com', 'alipay.com'],
  authenticatedHosts: ['myseller.taobao.com', 'sycm.taobao.com', 'qn.taobao.com'],
  credentialHosts: ['login.taobao.com', 'havanalogin.taobao.com', 'login.tmall.com', 'passport.alibaba.com']
}

const PLATFORM_PRESETS: Readonly<Record<AccountPlatform, PlatformPreset>> = {
  tmall: TMALL_PRESET,
  taobao: {
    platform: 'taobao', label: '淘宝', loginUrl: 'https://myseller.taobao.com/home.htm', collectionProbeUrl: 'https://myseller.taobao.com/home.htm',
    allowedHosts: ['taobao.com', 'tmall.com', 'alibaba.com', 'alipay.com'], authenticatedHosts: ['myseller.taobao.com', 'qn.taobao.com'], credentialHosts: ['login.taobao.com', 'havanalogin.taobao.com', 'passport.alibaba.com']
  },
  pinduoduo: {
    platform: 'pinduoduo', label: '拼多多', loginUrl: 'https://mms.pinduoduo.com/', collectionProbeUrl: 'https://mms.pinduoduo.com/',
    allowedHosts: ['pinduoduo.com'], authenticatedHosts: [], credentialHosts: []
  },
  jd: {
    platform: 'jd', label: '京东', loginUrl: 'https://login.shop.jd.com/', collectionProbeUrl: 'https://login.shop.jd.com/',
    allowedHosts: ['jd.com', 'jd.hk'], authenticatedHosts: [], credentialHosts: []
  },
  douyin: {
    platform: 'douyin', label: '抖店', loginUrl: 'https://fxg.jinritemai.com/', collectionProbeUrl: 'https://fxg.jinritemai.com/',
    allowedHosts: ['jinritemai.com'], authenticatedHosts: [], credentialHosts: []
  },
  kuaishou: {
    platform: 'kuaishou', label: '快手', loginUrl: 'https://s.kwaixiaodian.com/', collectionProbeUrl: 'https://s.kwaixiaodian.com/',
    allowedHosts: ['kwaixiaodian.com'], authenticatedHosts: [], credentialHosts: []
  },
  wechat_channels: {
    platform: 'wechat_channels', label: '视频号', loginUrl: 'https://channels.weixin.qq.com/shop', collectionProbeUrl: 'https://channels.weixin.qq.com/shop',
    allowedHosts: ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'], authenticatedHosts: [], credentialHosts: []
  },
  '1688': {
    platform: '1688', label: '1688', loginUrl: 'https://work.1688.com/', collectionProbeUrl: 'https://work.1688.com/',
    allowedHosts: ['1688.com', 'alibaba.com', 'alipay.com'], authenticatedHosts: [], credentialHosts: []
  }
}

export function getPlatformPreset(platform: string): PlatformPreset {
  const preset = PLATFORM_PRESETS[platform as AccountPlatform]
  if (preset) return preset
  throw new Error(`Unsupported platform preset: ${platform}`)
}
