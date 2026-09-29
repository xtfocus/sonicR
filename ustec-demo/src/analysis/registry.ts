/**
 * The analysis function registry — the single source of truth shared by
 * the CLI (`npm run analyze`), the HTTP server (`/api/analyze`,
 * `/api/functions`) and the docs.
 *
 * Each entry declares: an id, a category, bilingual summaries, typed
 * parameters with defaults, and a pure `run` handler. Executables only
 * *transport* arguments (CLI flags / query params → strings); this module
 * owns coercion, validation and the result envelope — so CLI, HTTP and any
 * future notebook/agent front-end behave identically by construction.
 *
 * Parameter values arrive as strings and are coerced per the declared
 * `type`; unknown names and failed coercions throw with the accepted
 * parameters in the message (same error style as the range-query API).
 */

import type { AnalysisContext, AnalysisResult } from './types';
import {
  classifyStructure,
  detectBos,
  detectChoch,
  findPivots,
  labelLegs,
  legEquilibriums,
} from './structure';
import {
  findFvgs,
  findOrderBlocks,
  findSupplyDemand,
  liquidityLevels,
  mergeZones,
} from './zones';
import { entrySignals, findPois, marketBias } from './signal';

export type ParamType = 'number' | 'boolean';

export type AnalyzeParam = {
  name: string;
  type: ParamType;
  default: number | boolean;
  desc: { en: string; vi: string };
};

export type AnalyzeFunction = {
  id: string;
  category: 'structure' | 'zones' | 'signal';
  summary: { en: string; vi: string };
  params: AnalyzeParam[];
  /** Only `signal` — declares that `ltfTimeframe` is accepted/required. */
  needsLtf?: boolean;
  run: (ctx: AnalysisContext, p: Record<string, number | boolean>) => unknown;
};

const K: AnalyzeParam = {
  name: 'k',
  type: 'number',
  default: 5,
  desc: {
    en: 'Pivot confirmation window in bars on each side; bigger = swing structure, smaller = internal structure',
    vi: 'Số nến xác nhận đỉnh/đáy mỗi bên; lớn = cấu trúc swing, nhỏ = cấu trúc internal',
  },
};

export const analyzeFunctions: AnalyzeFunction[] = [
  {
    id: 'pivots',
    category: 'structure',
    summary: {
      en: 'Confirmed swing pivots (the zigzag) with A→B→C leg labels — the Sonic R structural view.',
      vi: 'Các đỉnh/đáy swing đã xác nhận (zigzag) kèm nhãn chân A→B→C — khung nhìn cấu trúc Sonic R.',
    },
    params: [K],
    run: (ctx, p) => {
      const pivots = findPivots(ctx.bars, p.k as number);
      return { pivots, legs: labelLegs(pivots) };
    },
  },
  {
    id: 'structure',
    category: 'structure',
    summary: {
      en: 'Market structure classification (HH/HL uptrend, LH/LL downtrend, RANGE) over recent pivots.',
      vi: 'Phân loại cấu trúc thị trường (HH/HL tăng, LH/LL giảm, RANGE) trên các đỉnh/đáy gần nhất.',
    },
    params: [
      K,
      {
        name: 'lookback',
        type: 'number',
        default: 6,
        desc: {
          en: 'How many recent pivots the classification considers',
          vi: 'Số đỉnh/đáy gần nhất dùng để phân loại',
        },
      },
    ],
    run: (ctx, p) => {
      const pivots = findPivots(ctx.bars, p.k as number);
      return {
        structure: classifyStructure(pivots, p.lookback as number),
        recentLegs: labelLegs(pivots).slice(-(p.lookback as number)),
      };
    },
  },
  {
    id: 'bos',
    category: 'structure',
    summary: {
      en: 'Break-of-structure events: closes beyond the last confirmed swing — trend continuation.',
      vi: 'Sự kiện BOS (phá vỡ cấu trúc): nến đóng vượt đỉnh/đáy gần nhất — tiếp tục xu hướng.',
    },
    params: [K],
    run: (ctx, p) => ({ events: detectBos(ctx.bars, findPivots(ctx.bars, p.k as number)) }),
  },
  {
    id: 'choch',
    category: 'structure',
    summary: {
      en: 'Change-of-character events: the first close against the prevailing leg — reversal trigger.',
      vi: 'Sự kiện CHoCH (đổi tính chất): nến đóng ngược chân xu hướng — tín hiệu đảo chiều.',
    },
    params: [K],
    run: (ctx, p) => ({ events: detectChoch(ctx.bars, findPivots(ctx.bars, p.k as number)) }),
  },
  {
    id: 'equilibrium',
    category: 'structure',
    summary: {
      en: '50% equilibrium levels of the most recent zigzag legs (Sonic R midpoints).',
      vi: 'Mức cân bằng 50% của các chân zigzag gần nhất (điểm giữa Sonic R).',
    },
    params: [
      K,
      {
        name: 'count',
        type: 'number',
        default: 3,
        desc: {
          en: 'How many recent legs to report',
          vi: 'Số chân gần nhất được trả về',
        },
      },
    ],
    run: (ctx, p) => ({
      equilibriums: legEquilibriums(findPivots(ctx.bars, p.k as number), p.count as number),
    }),
  },
  {
    id: 'fvg',
    category: 'zones',
    summary: {
      en: 'Fair-value gaps (3-bar imbalances) with lifecycle state: fresh/touched/mitigated/broken.',
      vi: 'FVG (khoảng trống mất cân bằng 3 nến) kèm trạng thái: fresh/touched/mitigated/broken.',
    },
    params: [
      {
        name: 'minGap',
        type: 'number',
        default: 0,
        desc: {
          en: 'Minimum gap height in price points; smaller gaps ignored',
          vi: 'Chiều cao FVG tối thiểu (điểm giá); FVG nhỏ hơn bị bỏ qua',
        },
      },
    ],
    run: (ctx, p) => ({ zones: findFvgs(ctx.bars, { minGap: p.minGap as number }) }),
  },
  {
    id: 'order-blocks',
    category: 'zones',
    summary: {
      en: 'Order blocks anchored to breaks of structure: last opposite candle before the impulse.',
      vi: 'Order block neo vào BOS: nến ngược xu hướng cuối cùng trước cú đẩy.',
    },
    params: [
      K,
      {
        name: 'maxLookback',
        type: 'number',
        default: 10,
        desc: {
          en: 'Bars to walk back from each break hunting the OB candle',
          vi: 'Số nến lùi về từ mỗi lần phá vỡ để tìm nến OB',
        },
      },
      {
        name: 'bodyOnly',
        type: 'boolean',
        default: false,
        desc: {
          en: 'Use candle body only (open↔close) instead of full range',
          vi: 'Chỉ dùng thân nến (open↔close) thay vì toàn bộ râu nến',
        },
      },
    ],
    run: (ctx, p) => ({
      zones: findOrderBlocks(
        ctx.bars,
        findPivots(ctx.bars, p.k as number),
        p.maxLookback as number,
        p.bodyOnly as boolean
      ),
    }),
  },
  {
    id: 'supply-demand',
    category: 'zones',
    summary: {
      en: 'Supply/demand bases: consolidation ranges preceding confirmed pivot highs/lows.',
      vi: 'Vùng cung/cầu: dải tích lũy ngay trước các đỉnh/đáy swing đã xác nhận.',
    },
    params: [
      K,
      {
        name: 'baseBars',
        type: 'number',
        default: 3,
        desc: {
          en: 'Consolidation window size before each pivot, in bars',
          vi: 'Số nến tạo vùng tích lũy trước mỗi đỉnh/đáy',
        },
      },
    ],
    run: (ctx, p) => ({
      zones: findSupplyDemand(ctx.bars, findPivots(ctx.bars, p.k as number), p.baseBars as number),
    }),
  },
  {
    id: 'zones-merged',
    category: 'zones',
    summary: {
      en: 'All zone kinds merged into confluence POIs; provenance shows which logics overlap.',
      vi: 'Gộp mọi loại vùng thành POI cộng hưởng; provenance cho biết các logic nào chồng lấn.',
    },
    params: [
      K,
      {
        name: 'maxLookback',
        type: 'number',
        default: 10,
        desc: { en: 'Bars to walk back from each break hunting the OB candle', vi: 'Số nến lùi về từ mỗi lần phá vỡ để tìm nến OB' },
      },
      {
        name: 'baseBars',
        type: 'number',
        default: 3,
        desc: { en: 'Consolidation window size before each pivot, in bars', vi: 'Số nến tạo vùng tích lũy trước mỗi đỉnh/đáy' },
      },
      {
        name: 'minGap',
        type: 'number',
        default: 0,
        desc: { en: 'Minimum FVG height in price points; smaller gaps ignored', vi: 'Chiều cao FVG tối thiểu (điểm giá); FVG nhỏ hơn bị bỏ qua' },
      },
    ],
    run: (ctx, p) => {
      const pivots = findPivots(ctx.bars, p.k as number);
      return {
        zones: mergeZones([
          ...findFvgs(ctx.bars, { minGap: p.minGap as number }),
          ...findOrderBlocks(ctx.bars, pivots, p.maxLookback as number),
          ...findSupplyDemand(ctx.bars, pivots, p.baseBars as number),
        ]),
      };
    },
  },
  {
    id: 'liquidity',
    category: 'zones',
    summary: {
      en: 'Liquidity map: old extremes plus equal-high/low pools (draw-in targets).',
      vi: 'Bản đồ thanh khoản: cực trị cũ cùng các cụm đỉnh/đáy ngang (mục tiêu draw-in).',
    },
    params: [
      K,
      {
        name: 'tolerance',
        type: 'number',
        default: 0.001,
        desc: {
          en: 'Equal-high/low cluster tolerance as a fraction of price (0.001 = 0.1%)',
          vi: 'Dung sai cụm đỉnh/đáy ngang theo tỷ lệ giá (0.001 = 0.1%)',
        },
      },
    ],
    run: (ctx, p) => ({
      levels: liquidityLevels(ctx.bars, findPivots(ctx.bars, p.k as number), {
        tolerance: p.tolerance as number,
      }),
    }),
  },
  {
    id: 'bias',
    category: 'signal',
    summary: {
      en: 'Directional bias from structure: long_only / short_only / stand_aside (RANGE).',
      vi: 'Thiên hướng từ cấu trúc: long_only / short_only / stand_aside (RANGE).',
    },
    params: [K],
    run: (ctx, p) => marketBias(ctx.bars, p.k as number),
  },
  {
    id: 'signal',
    category: 'signal',
    summary: {
      en: 'Full composite: HTF bias ∧ POI arrival ∧ LTF CHoCH trigger ∧ R:R gate, with entry/stop/targets.',
      vi: 'Tín hiệu tổng hợp: bias HTF ∧ giá chạm POI ∧ CHoCH LTF ∧ lọc R:R, kèm entry/stop/targets.',
    },
    params: [
      {
        name: 'htfK',
        type: 'number',
        default: 5,
        desc: {
          en: 'Pivot window on the analysis (higher) timeframe',
          vi: 'Số nến xác nhận pivot trên khung cao (HTF)',
        },
      },
      {
        name: 'ltfK',
        type: 'number',
        default: 3,
        desc: {
          en: 'Pivot window on the trigger (lower) timeframe',
          vi: 'Số nến xác nhận pivot trên khung thấp (LTF)',
        },
      },
      {
        name: 'minRR',
        type: 'number',
        default: 2,
        desc: {
          en: 'Minimum reward:risk of the first target; lower-RR signals drop',
          vi: 'R:R tối thiểu so với mục tiêu đầu tiên; tín hiệu thấp hơn bị loại',
        },
      },
      {
        name: 'stopBuffer',
        type: 'number',
        default: 0.0005,
        desc: {
          en: 'Stop buffer beyond the POI far edge, as a fraction of price',
          vi: 'Đệm stop vượt mép xa của POI, theo tỷ lệ giá',
        },
      },
      {
        name: 'limit',
        type: 'number',
        default: 3,
        desc: {
          en: 'Max signals returned, most recent first',
          vi: 'Số tín hiệu tối đa trả về, mới nhất trước',
        },
      },
    ],
    needsLtf: true,
    run: (ctx, p) =>
      entrySignals(ctx.bars, ctx.ltfBars ?? ctx.bars, {
        htfK: p.htfK as number,
        ltfK: p.ltfK as number,
        minRR: p.minRR as number,
        stopBuffer: p.stopBuffer as number,
        limit: p.limit as number,
      }),
  },
  {
    id: 'pois',
    category: 'signal',
    summary: {
      en: 'Bias-filtered, still-tradeable confluence POIs nearest to current price.',
      vi: 'Các POI cộng hưởng đã lọc theo bias, chưa bị phá và gần giá hiện tại nhất.',
    },
    params: [
      K,
      {
        name: 'includeMitigated',
        type: 'boolean',
        default: false,
        desc: {
          en: 'Also include mitigated zones (default: fresh/touched only)',
          vi: 'Bao gồm cả vùng đã mitigated (mặc định: chỉ fresh/touched)',
        },
      },
      {
        name: 'limit',
        type: 'number',
        default: 5,
        desc: {
          en: 'Max POIs returned, nearest to price first',
          vi: 'Số POI tối đa trả về, gần giá nhất trước',
        },
      },
    ],
    run: (ctx, p) => {
      const bias = marketBias(ctx.bars, p.k as number);
      return {
        bias,
        pois: findPois(ctx.bars, bias.bias, {
          k: p.k as number,
          includeMitigated: p.includeMitigated as boolean,
          limit: p.limit as number,
        }),
      };
    },
  },
];

/** Registry lookup by function id. */
export function getAnalyzeFunction(id: string): AnalyzeFunction | undefined {
  return analyzeFunctions.find((f) => f.id === id);
}

/** Coerce one raw string per the declared param type; throw on garbage. */
function coerceParam(fn: AnalyzeFunction, raw: Record<string, string>): Record<string, number | boolean> {
  const known = fn.params.map((p) => p.name);
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) {
      throw new Error(
        `Unknown parameter '${key}' for '${fn.id}'. Accepted: ${known.join(', ') || '(none)'}.`
      );
    }
  }
  const out: Record<string, number | boolean> = {};
  for (const param of fn.params) {
    const value = raw[param.name];
    if (value == null) {
      out[param.name] = param.default;
      continue;
    }
    if (param.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        throw new Error(`Invalid ${param.name}='${value}' for '${fn.id}': expected a number.`);
      }
      out[param.name] = n;
    } else {
      // Bare flag (`--includeMitigated` / `?includeMitigated`) means true.
      if (value === '') {
        out[param.name] = true;
        continue;
      }
      if (!/^(true|false)$/i.test(value)) {
        throw new Error(`Invalid ${param.name}='${value}' for '${fn.id}': expected true or false.`);
      }
      out[param.name] = value.toLowerCase() === 'true';
    }
  }
  return out;
}

/**
 * Validate + run a registry function and wrap the payload in the common
 * result envelope (`fn`, `intervalSeconds`, `barCount`, `from`, `to`).
 *
 * This is the one entry point both the CLI and the HTTP server call.
 */
export function runAnalyze(
  id: string,
  ctx: AnalysisContext,
  rawParams: Record<string, string>
): AnalysisResult<unknown> {
  const fn = getAnalyzeFunction(id);
  if (!fn) {
    throw new Error(
      `Unknown function '${id}'. Available: ${analyzeFunctions.map((f) => f.id).join(', ')}.`
    );
  }
  const params = coerceParam(fn, rawParams);
  const first = ctx.bars[0]?.time ?? null;
  const last = ctx.bars.length > 0 ? ctx.bars[ctx.bars.length - 1]!.time : null;
  return {
    fn: fn.id,
    intervalSeconds: ctx.intervalSeconds,
    barCount: ctx.bars.length,
    from: first,
    to: last,
    data: fn.run(ctx, params),
  };
}

/**
 * Machine-readable catalogue for `/api/functions` (and CLI `--list`):
 * ids, categories, bilingual summaries and typed parameters.
 */
export function describeAnalyzeFunctions(lang: 'en' | 'vi' = 'en'): unknown {
  return analyzeFunctions.map((f) => ({
    id: f.id,
    category: f.category,
    needsLtf: f.needsLtf === true,
    summary: f.summary[lang],
    params: f.params.map((p) => ({
      name: p.name,
      type: p.type,
      default: p.default,
      desc: p.desc[lang],
    })),
  }));
}
