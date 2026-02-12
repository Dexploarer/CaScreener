import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react";
import { z } from "zod";

export const catalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
      }),
      slots: ["default"],
      description: "Container card with optional title and description",
    },
    Button: {
      props: z.object({
        label: z.string(),
        action: z.string().nullable(),
        params: z.record(z.string(), z.any()).nullable(),
      }),
      description: "Clickable button that triggers an action, optional params payload",
    },
    Text: {
      props: z.object({
        content: z.string(),
      }),
      description: "Text paragraph for analysis and insights",
    },
    Heading: {
      props: z.object({
        text: z.string(),
        size: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      description: "Section heading with configurable size",
    },
    Stack: {
      props: z.object({
        gap: z.enum(["sm", "md", "lg"]).nullable(),
        direction: z.enum(["vertical", "horizontal"]).nullable(),
      }),
      slots: ["default"],
      description: "Flexible layout container with configurable gap and direction",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        format: z.enum(["currency", "percent", "number"]).nullable(),
        change: z.string().nullable(),
      }),
      description:
        "Display a single metric value with optional change indicator. Prefix change with + or - for color.",
    },
    Badge: {
      props: z.object({
        label: z.string(),
        variant: z
          .enum(["default", "success", "warning", "danger", "info"])
          .nullable(),
      }),
      description:
        "Colored pill/tag for status indicators (active, whale, degen, bullish, bearish, etc.)",
    },
    Divider: {
      props: z.object({
        label: z.string().nullable(),
      }),
      description: "Horizontal separator, optionally with a centered label",
    },
    Table: {
      props: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
      description:
        "Data table with column headers and rows. Great for token holdings, transaction lists, market comparisons.",
    },
    ProgressBar: {
      props: z.object({
        label: z.string(),
        value: z.number(),
        max: z.number().nullable(),
        color: z.enum(["emerald", "cyan", "amber", "red", "violet"]).nullable(),
      }),
      description:
        "Visual progress/percentage bar. Value 0-100 by default. Use for portfolio allocation, dominance, sentiment.",
    },
    SparkLine: {
      props: z.object({
        data: z.array(z.number()),
        color: z.enum(["emerald", "cyan", "amber", "red", "violet"]).nullable(),
        height: z.number().nullable(),
      }),
      description:
        "SVG sparkline chart from an array of numeric data points. Auto-colors green if trending up, red if down. Use for price history, volume trends.",
    },
    BarChart: {
      props: z.object({
        bars: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
            color: z
              .enum(["emerald", "cyan", "amber", "red", "violet"])
              .nullable(),
          })
        ),
      }),
      description:
        "Horizontal bar chart. Great for comparing values like portfolio allocation, volume comparison, TVL rankings.",
    },
    DonutChart: {
      props: z.object({
        segments: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
            color: z
              .enum(["emerald", "cyan", "amber", "red", "violet", "zinc"])
              .nullable(),
          })
        ),
        size: z.number().nullable(),
      }),
      description:
        "SVG donut/ring chart for proportional data. Use for market dominance, portfolio breakdown, allocation splits.",
    },
    Image: {
      props: z.object({
        src: z.string(),
        alt: z.string(),
        width: z.number().nullable(),
        height: z.number().nullable(),
        rounded: z.enum(["none", "md", "full"]).nullable(),
      }),
      description:
        "Image element for coin logos, NFT thumbnails, avatars. Lazy loaded with object-cover.",
    },
    TokenRow: {
      props: z.object({
        name: z.string(),
        symbol: z.string(),
        imageUrl: z.string().nullable(),
        price: z.string(),
        change: z.string().nullable(),
        sparklineData: z.array(z.number()).nullable(),
        rank: z.number().nullable(),
      }),
      description:
        "Compact token strip: logo + name + symbol + inline sparkline + price + change badge. Robinhood-style.",
    },
    HeatMap: {
      props: z.object({
        cells: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
            weight: z.number().nullable(),
          })
        ),
        columns: z.number().nullable(),
      }),
      description:
        "TradingView-style colored grid. Red→green diverging scale. Weighted cells span columns.",
    },
    ScoreRing: {
      props: z.object({
        score: z.number(),
        label: z.string(),
        color: z.enum(["emerald", "cyan", "amber", "red", "violet"]).nullable(),
        size: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      description:
        "Animated circular gauge (0-100). SVG stroke-dashoffset fills on mount with glow effect.",
    },
    GlowCard: {
      props: z.object({
        intensity: z.enum(["low", "medium", "high"]).nullable(),
      }),
      slots: ["default"],
      description:
        "Card with animated breathing border glow cycling emerald↔cyan. Premium wrapper.",
    },
    DivergenceBar: {
      props: z.object({
        leftLabel: z.string(),
        leftValue: z.number(),
        rightLabel: z.string(),
        rightValue: z.number(),
        maxValue: z.number().nullable(),
      }),
      description:
        "Two-sided bar showing disagreement between two signals. Left=cyan, right=emerald.",
    },
    AlertBanner: {
      props: z.object({
        title: z.string(),
        message: z.string(),
        severity: z.enum(["alpha", "warning", "critical", "info"]).nullable(),
      }),
      description:
        "Eye-catching notification with gradient bg, SVG icon, and pulse glow animation.",
    },
    RadarChart: {
      props: z.object({
        axes: z.array(
          z.object({
            label: z.string(),
            value: z.number(),
            max: z.number().nullable(),
          })
        ),
        color: z.enum(["emerald", "cyan", "amber", "red", "violet"]).nullable(),
        size: z.number().nullable(),
      }),
      description:
        "SVG spider/radar chart for multi-dimensional profiles. Polygon on web grid with axis labels.",
    },
    TextField: {
      props: z.object({
        label: z.string(),
        valuePath: z.string(),
        placeholder: z.string().nullable(),
        checks: z
          .array(
            z.object({
              fn: z.string(),
              message: z.string(),
              args: z.record(z.string(), z.unknown()).nullable(),
            })
          )
          .nullable(),
        validateOn: z.enum(["change", "blur", "submit"]).nullable(),
      }),
      description: "Text input with optional validation",
    },
    Widget: {
      props: z.object({
        type: z.enum(["price-chart", "heatmap", "ticker-list", "converter"]),
        coinId: z.string().nullable(),
        currency: z.string().nullable(),
        height: z.number().nullable(),
      }),
      description: "Embeddable CoinGecko widgets (charts, lists, converter)",
    },
    DegenGauge: {
      props: z.object({
        score: z.number(),
        label: z.string(),
        color: z.enum(["emerald", "cyan", "amber", "red", "violet"]).nullable(),
        size: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      description: "Animated speedometer-style gauge for risk or degeneracy levels",
    },
    WhaleRadar: {
      props: z.object({
        points: z.array(z.object({
          x: z.number(),
          y: z.number(),
          size: z.number(),
          label: z.string().nullable(),
        })),
        color: z.enum(["emerald", "cyan", "amber", "red", "violet"]).nullable(),
        size: z.number().nullable(),
      }),
      description: "Circular radar-sweep visualization for whale activity tracking",
    },
    SocialLinks: {
      props: z.object({
        links: z.array(z.object({
          type: z.enum(["x", "telegram", "discord", "github", "website"]),
          url: z.string(),
          label: z.string().nullable(),
        })),
      }),
      description: "Grid of social and project links with brand icons",
    },
  },
  actions: {
    submit: {
      params: z.object({
        formId: z.string(),
      }),
      description: "Submit a form",
    },
    navigate: {
      params: z.object({
        url: z.string(),
      }),
      description: "Navigate to a URL",
    },
    generate: {
      params: z.object({
        prompt: z.string(),
      }),
      description: "Trigger a new generation with the given prompt",
    },
  },
});
