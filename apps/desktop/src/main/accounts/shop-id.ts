const SHOP_ID_PREFIX_BY_PLATFORM: Readonly<Record<string, string>> = {
  tmall: 'T',
  taobao: 'T',
  taogongchang: 'T',
  tao_factory: 'T',
  taobao_factory: 'T',
  pinduoduo: 'P',
  jd: 'J',
  jingdong: 'J',
  '1688': 'A',
  alibaba1688: 'A',
  douyin: 'D',
  douyin_store: 'D',
  kuaishou: 'K',
  wechat_channels: 'Q',
  wechat_video: 'Q'
}

export function shopIdPrefix(platform: string): string {
  const prefix = SHOP_ID_PREFIX_BY_PLATFORM[platform]
  if (!prefix) throw new Error(`尚未配置平台 ${platform} 的店铺标识规则`)
  return prefix
}

export function allocateShopId(platform: string, existingShopIds: readonly string[]): string {
  const prefix = shopIdPrefix(platform)
  const pattern = new RegExp(`^${prefix}(\\d{1,4})$`)
  const largestSequence = existingShopIds.reduce((largest, shopId) => {
    const matched = pattern.exec(shopId)
    if (!matched) return largest
    return Math.max(largest, Number(matched[1]))
  }, 0)
  const nextSequence = largestSequence + 1
  if (nextSequence > 9999) throw new Error(`${prefix}XXXX 店铺标识已用尽`)
  return `${prefix}${String(nextSequence).padStart(4, '0')}`
}
