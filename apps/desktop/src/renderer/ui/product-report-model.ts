export type ProductDiagnosis = 'refund-risk' | 'high-traffic-low-conversion' | 'potential' | 'small-sample' | 'stable'

export interface ProductReportItem {
  key: string
  shopId: string
  shopName: string
  itemId: string
  title: string
  payAmt: number
  refundAmt: number | null
  payItemCount: number
  payBuyerCount: number
  payRate: number | null
  visitorCount: number
  pageViewCount: number
  cartBuyerCount: number
  favoriteBuyerCount: number
  diagnosis: ProductDiagnosis
}

export interface ProductReportShop {
  shopId: string
  shopName: string
  payAmt: number
  itemCount: number
  share: number
}

export interface ProductReportModel {
  items: ProductReportItem[]
  shops: ProductReportShop[]
  totals: {
    payAmt: number
    payItemCount: number
    payBuyerCount: number
    visitorCount: number
    refundAmt: number | null
    refundKnownCount: number
    topOneShare: number
  }
  diagnosisCounts: Record<ProductDiagnosis, number>
}

export function buildProductReportModel(
  rows: Array<Record<string, string | number | null>>,
  fallback: { shopId?: string; shopName?: string } = {}
): ProductReportModel {
  const items = rows.map((row, index): ProductReportItem => {
    const payAmt = numberValue(row['pay_amt'])
    const refundAmt = nullableNumber(row['refund_amt'])
    const visitorCount = numberValue(row['visitor_count'])
    const payBuyerCount = numberValue(row['pay_buyer_count'])
    const rawRate = nullableNumber(row['pay_rate'])
    const payRate = rawRate ?? (visitorCount > 0 ? payBuyerCount / visitorCount : null)
    const shopId = textValue(row['shop_id']) || fallback.shopId || 'unknown-shop'
    const shopName = textValue(row['shop_name']) || fallback.shopName || '未命名店铺'
    const itemId = textValue(row['item_id']) || `row-${index + 1}`
    return {
      key: `${shopId}:${itemId}:${index}`,
      shopId,
      shopName,
      itemId,
      title: textValue(row['item_title']) || `未命名商品 ${index + 1}`,
      payAmt,
      refundAmt,
      payItemCount: numberValue(row['pay_item_count']),
      payBuyerCount,
      payRate,
      visitorCount,
      pageViewCount: numberValue(row['page_view_count']),
      cartBuyerCount: numberValue(row['cart_buyer_count']),
      favoriteBuyerCount: numberValue(row['favorite_buyer_count']),
      diagnosis: diagnose({ payAmt, refundAmt, visitorCount, payRate })
    }
  }).sort((left, right) => right.payAmt - left.payAmt || right.visitorCount - left.visitorCount)

  const payAmt = sum(items.map((item) => item.payAmt))
  const refundValues = items.map((item) => item.refundAmt).filter((value): value is number => value !== null)
  const shopMap = new Map<string, ProductReportShop>()
  for (const item of items) {
    const current = shopMap.get(item.shopId) ?? { shopId: item.shopId, shopName: item.shopName, payAmt: 0, itemCount: 0, share: 0 }
    current.payAmt += item.payAmt
    current.itemCount += 1
    shopMap.set(item.shopId, current)
  }
  const shops = [...shopMap.values()]
    .map((shop) => ({ ...shop, share: payAmt > 0 ? shop.payAmt / payAmt : 0 }))
    .sort((left, right) => right.payAmt - left.payAmt)
  const diagnosisCounts = items.reduce<Record<ProductDiagnosis, number>>((counts, item) => {
    counts[item.diagnosis] += 1
    return counts
  }, { 'refund-risk': 0, 'high-traffic-low-conversion': 0, potential: 0, 'small-sample': 0, stable: 0 })

  return {
    items,
    shops,
    totals: {
      payAmt,
      payItemCount: sum(items.map((item) => item.payItemCount)),
      payBuyerCount: sum(items.map((item) => item.payBuyerCount)),
      visitorCount: sum(items.map((item) => item.visitorCount)),
      refundAmt: refundValues.length > 0 ? sum(refundValues) : null,
      refundKnownCount: refundValues.length,
      topOneShare: payAmt > 0 ? (items[0]?.payAmt ?? 0) / payAmt : 0
    },
    diagnosisCounts
  }
}

function diagnose(input: { payAmt: number; refundAmt: number | null; visitorCount: number; payRate: number | null }): ProductDiagnosis {
  if (input.refundAmt !== null && input.refundAmt > 0 && (input.refundAmt >= 100 || (input.payAmt > 0 && input.refundAmt / input.payAmt >= 0.1))) return 'refund-risk'
  if (input.visitorCount >= 50 && (input.payRate ?? 0) < 0.03) return 'high-traffic-low-conversion'
  if (input.visitorCount <= 3) return 'small-sample'
  if (input.visitorCount < 100 && (input.payRate ?? 0) >= 0.1) return 'potential'
  return 'stable'
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
