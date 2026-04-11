import type { BehaviorContext, DisplayConfig, SkillHandler } from "../types.js";

interface YahooQuoteResult {
	regularMarketPrice: number;
	regularMarketChange: number;
	regularMarketChangePercent: number;
	regularMarketPreviousClose: number;
	regularMarketOpen: number;
	regularMarketDayHigh: number;
	regularMarketDayLow: number;
	regularMarketVolume: number;
	shortName: string;
	symbol: string;
	currency: string;
}

async function fetchQuote(symbol: string): Promise<YahooQuoteResult | null> {
	const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
	try {
		const res = await fetch(url, {
			headers: { "User-Agent": "Mozilla/5.0" },
			signal: AbortSignal.timeout(8000),
		});
		if (!res.ok) return null;
		const body = (await res.json()) as {
			chart?: {
				result?: Array<{
					meta?: {
						regularMarketPrice?: number;
						regularMarketChange?: number;
						regularMarketChangePercent?: number;
						previousClose?: number;
						regularMarketOpen?: number;
						regularMarketDayHigh?: number;
						regularMarketDayLow?: number;
						regularMarketVolume?: number;
						shortName?: string;
						symbol?: string;
						currency?: string;
					};
				}>;
			};
		};
		const meta = body?.chart?.result?.[0]?.meta;
		if (!meta) return null;
		return {
			regularMarketPrice: meta.regularMarketPrice ?? 0,
			regularMarketChange: meta.regularMarketChange ?? 0,
			regularMarketChangePercent: meta.regularMarketChangePercent ?? 0,
			regularMarketPreviousClose: meta.previousClose ?? 0,
			regularMarketOpen: meta.regularMarketOpen ?? 0,
			regularMarketDayHigh: meta.regularMarketDayHigh ?? 0,
			regularMarketDayLow: meta.regularMarketDayLow ?? 0,
			regularMarketVolume: meta.regularMarketVolume ?? 0,
			shortName: meta.shortName ?? symbol,
			symbol: meta.symbol ?? symbol,
			currency: meta.currency ?? "USD",
		};
	} catch {
		return null;
	}
}

function formatVolume(v: number): string {
	if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
	if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
	return String(v);
}

export const stockTickerSkill: SkillHandler = {
	name: "stock-ticker",
	description: "Show real-time stock quote data (price, change, OHLCV) for one or more ticker symbols.",
	configSchema: {
		symbols: {
			description: "Comma-separated list of ticker symbols, e.g. 'AAPL,TSLA,000001.SS'",
			required: true,
		},
		title: { description: "Panel title, e.g. '今日行情'", required: false },
	},
	async handle(ctx: BehaviorContext): Promise<DisplayConfig> {
		const raw = String(ctx.config.symbols ?? "");
		const title = ctx.config.title ? String(ctx.config.title) : "股市行情";
		if (!raw) {
			return { type: "markdown", content: "**配置错误:** symbols 字段缺失。", title: "错误" };
		}
		const symbols = raw
			.split(",")
			.map((s) => s.trim().toUpperCase())
			.filter(Boolean);

		const results = await Promise.all(symbols.map(fetchQuote));

		const headers = ["代码", "名称", "最新价", "涨跌", "涨跌幅", "开盘", "最高", "最低", "成交量"];
		const rows: string[][] = [];

		for (let i = 0; i < symbols.length; i++) {
			const q = results[i];
			if (!q) {
				rows.push([symbols[i], "-", "-", "-", "-", "-", "-", "-", "-"]);
				continue;
			}
			const sign = q.regularMarketChange >= 0 ? "+" : "";
			rows.push([
				q.symbol,
				q.shortName,
				`${q.regularMarketPrice.toFixed(2)} ${q.currency}`,
				`${sign}${q.regularMarketChange.toFixed(2)}`,
				`${sign}${q.regularMarketChangePercent.toFixed(2)}%`,
				q.regularMarketOpen.toFixed(2),
				q.regularMarketDayHigh.toFixed(2),
				q.regularMarketDayLow.toFixed(2),
				formatVolume(q.regularMarketVolume),
			]);
		}

		return { type: "table", headers, rows, title };
	},
};
