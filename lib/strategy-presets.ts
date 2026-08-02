// Every bot on the platform runs on FreqAI — there is no "off" switch, only
// a choice of AI *behavior*. A picked card never just sets cosmetic labels:
// freqaiConfig is the structured object that travels with the bot (stored
// on BotConfiguration.freqaiConfig) and is read by lib/hetzner.ts when it
// builds the FreqAI block of the config.json shipped to the Hetzner VPS —
// so "AI Smart Scalper" retraining every 4h on a 15-day window is a real
// setting on the deployed instance, not just UI copy.

export interface FreqAIFeatureConfig {
  /**
   * The single concrete timeframe the strategy actually trades on (matches
   * the `timeframe` class attribute baked into `code`) — used for
   * `download-data --timeframe` and as the first entry FreqAI's
   * feature_parameters expects. Kept separate from StrategyPreset.timeframe,
   * which is a *display* string ("1h / 4h") and not always a single valid
   * freqtrade timeframe value.
   */
  baseTimeframe: string;
  /** Candle windows fed into feature_engineering_expand_all (RSI/EMA/etc. periods). */
  indicatorPeriods: number[];
  /** Extra timeframes FreqAI pulls in as additional features, alongside baseTimeframe. */
  includeTimeframes: string[];
  /** How many candles ahead set_freqai_targets looks when building the label. */
  labelPeriodCandles: number;
}

export interface FreqAITrainingConfig {
  trainPeriodDays: number;
  backtestPeriodDays: number;
  /** How often FreqAI retrains itself in the background while live/dry-run. */
  liveRetrainHours: number;
}

export interface FreqAIRiskConfig {
  stoploss: number;
  minimalRoi: Record<string, number>;
  trailingStop: boolean;
  trailingStopPositive?: number;
  trailingStopPositiveOffset?: number;
}

export interface FreqAIPositionAdjustmentConfig {
  enabled: boolean;
  maxEntryPositionAdjustment: number;
  /** Trade must be down at least this fraction before the bot averages down again. */
  rebuyTriggerPercent: number;
}

export interface FreqAIProfileConfig {
  /** The FreqAI model class freqtrade trains with — e.g. LightGBMRegressor. */
  freqaiModel: string;
  training: FreqAITrainingConfig;
  features: FreqAIFeatureConfig;
  risk: FreqAIRiskConfig;
  positionAdjustment?: FreqAIPositionAdjustmentConfig;
}

export interface StrategyPreset {
  id: string;
  title: string;
  description: string;
  risk: "Laag" | "Gemiddeld" | "Hoog";
  timeframe: string;
  /** Python class name — becomes both `strategy` and part of a filename. Never shown in the UI. */
  className: string;
  code: string;
  freqaiConfig: FreqAIProfileConfig;
}

const SMART_SCALPER_CODE = `from freqtrade.strategy import IStrategy
import talib.abstract as ta


class FreqaiScalperStrategy(IStrategy):
    """AI Smart Scalper: de AI voorspelt supersnelle prijsbewegingen en
    handelt met hoge frequentie voor veel kleine winsten."""

    timeframe = "5m"
    minimal_roi = {"0": 0.015, "10": 0.008, "20": 0}
    stoploss = -0.02
    trailing_stop = True
    trailing_stop_positive = 0.003
    trailing_stop_positive_offset = 0.006
    trailing_only_offset_is_reached = True
    process_only_new_candles = True

    def feature_engineering_expand_all(self, dataframe, period, metadata, **kwargs):
        dataframe["%-rsi"] = ta.RSI(dataframe, timeperiod=period)
        dataframe["%-ema"] = ta.EMA(dataframe, timeperiod=period)
        dataframe["%-mfi"] = ta.MFI(dataframe, timeperiod=period)
        return dataframe

    def feature_engineering_expand_basic(self, dataframe, metadata, **kwargs):
        dataframe["%-pct-change"] = dataframe["close"].pct_change()
        dataframe["%-raw-volume"] = dataframe["volume"]
        return dataframe

    def set_freqai_targets(self, dataframe, metadata, **kwargs):
        # ~30 min vooruit op een 5m-timeframe (6 candles).
        dataframe["&-target"] = dataframe["close"].shift(-6) / dataframe["close"] - 1
        return dataframe

    def populate_indicators(self, dataframe, metadata):
        dataframe = self.freqai.start(dataframe, metadata, self)
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["do_predict"] == 1)
            & (dataframe["&-target"] > 0.004)
            & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["do_predict"] == 1) & (dataframe["&-target"] < 0),
            "exit_long",
        ] = 1
        return dataframe
`;

const DYNAMIC_DCA_CODE = `from freqtrade.strategy import IStrategy
import talib.abstract as ta


class FreqaiDcaStrategy(IStrategy):
    """AI Dynamic DCA / Grid: de AI zoekt strategische bodems om slim bij te
    kopen als de prijs zakt, en verkoopt zodra ze een top herkent."""

    timeframe = "15m"
    minimal_roi = {"0": 0.04, "60": 0.02, "180": 0}
    stoploss = -0.15
    trailing_stop = False
    process_only_new_candles = True

    # Freqtrade's eigen DCA-mechanisme: bijkopen via adjust_trade_position
    # hieronder, tot maximaal dit aantal extra instapmomenten.
    position_adjustment_enable = True
    max_entry_position_adjustment = 3

    def feature_engineering_expand_all(self, dataframe, period, metadata, **kwargs):
        dataframe["%-rsi"] = ta.RSI(dataframe, timeperiod=period)
        dataframe["%-ema"] = ta.EMA(dataframe, timeperiod=period)
        dataframe["%-volatility"] = ta.STDDEV(dataframe, timeperiod=period) / dataframe["close"]
        return dataframe

    def set_freqai_targets(self, dataframe, metadata, **kwargs):
        # 3 uur vooruit op een 15m-timeframe (12 candles).
        dataframe["&-target"] = dataframe["close"].shift(-12) / dataframe["close"] - 1
        return dataframe

    def populate_indicators(self, dataframe, metadata):
        dataframe = self.freqai.start(dataframe, metadata, self)
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        # AI ziet een bodem vormen: een eerste, kleine positie openen.
        dataframe.loc[
            (dataframe["do_predict"] == 1)
            & (dataframe["&-target"] > 0.01)
            & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe, metadata):
        # AI ziet een top vormen: volledige positie sluiten.
        dataframe.loc[
            (dataframe["do_predict"] == 1) & (dataframe["&-target"] < -0.005),
            "exit_long",
        ] = 1
        return dataframe

    def adjust_trade_position(self, trade, current_time, current_rate, current_profit,
                               min_stake, max_stake, current_entry_rate, current_exit_rate,
                               current_entry_profit, current_exit_profit, **kwargs):
        # Bijkopen zolang de AI nog opwaarts potentieel ziet én de koers
        # voldoende is gezakt sinds de laatste instap. NOTE: freqtrade's
        # exacte parameterlijst voor deze hook verschilt licht per versie —
        # controleer dit tegen de freqtrade-versie in het gedeployde image.
        if current_profit > -0.03 or trade.nr_of_successful_entries > self.max_entry_position_adjustment:
            return None

        dataframe, _ = self.dp.get_analyzed_dataframe(pair=trade.pair, timeframe=self.timeframe)
        if dataframe.empty:
            return None

        last_candle = dataframe.iloc[-1]
        if last_candle["do_predict"] != 1 or last_candle["&-target"] <= 0:
            return None

        return trade.stake_amount
`;

const TREND_CATCHER_CODE = `from freqtrade.strategy import IStrategy
import talib.abstract as ta


class FreqaiTrendCatcherStrategy(IStrategy):
    """AI Trend Catcher: de AI analyseert grote marktverschuivingen, negeert
    kleine ruis, en houdt posities langer vast voor een hogere beloning."""

    timeframe = "1h"
    minimal_roi = {"0": 0.15, "720": 0.08, "1440": 0}
    stoploss = -0.12
    trailing_stop = True
    trailing_stop_positive = 0.02
    trailing_stop_positive_offset = 0.04
    trailing_only_offset_is_reached = True
    process_only_new_candles = True

    def feature_engineering_expand_all(self, dataframe, period, metadata, **kwargs):
        dataframe["%-ema"] = ta.EMA(dataframe, timeperiod=period)
        dataframe["%-adx"] = ta.ADX(dataframe, timeperiod=period)
        dataframe["%-rsi"] = ta.RSI(dataframe, timeperiod=period)
        return dataframe

    def set_freqai_targets(self, dataframe, metadata, **kwargs):
        # 1 dag vooruit op een 1h-timeframe (24 candles).
        dataframe["&-target"] = dataframe["close"].shift(-24) / dataframe["close"] - 1
        return dataframe

    def populate_indicators(self, dataframe, metadata):
        dataframe = self.freqai.start(dataframe, metadata, self)
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["do_predict"] == 1)
            & (dataframe["&-target"] > 0.03)
            & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["do_predict"] == 1) & (dataframe["&-target"] < 0),
            "exit_long",
        ] = 1
        return dataframe
`;

export const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: "ai-smart-scalper",
    title: "AI Smart Scalper",
    description:
      "De AI voorspelt supersnelle prijsbewegingen. Koopt en verkoopt razendsnel voor veel kleine winsten. Ideaal voor actieve markten.",
    risk: "Laag",
    timeframe: "5m",
    className: "FreqaiScalperStrategy",
    code: SMART_SCALPER_CODE,
    freqaiConfig: {
      freqaiModel: "LightGBMRegressor",
      training: { trainPeriodDays: 15, backtestPeriodDays: 3, liveRetrainHours: 4 },
      features: {
        baseTimeframe: "5m",
        indicatorPeriods: [5, 10, 20],
        includeTimeframes: ["5m", "15m"],
        labelPeriodCandles: 6,
      },
      risk: {
        stoploss: -0.02,
        minimalRoi: { "0": 0.015, "10": 0.008, "20": 0 },
        trailingStop: true,
        trailingStopPositive: 0.003,
        trailingStopPositiveOffset: 0.006,
      },
    },
  },
  {
    id: "ai-dynamic-dca",
    title: "AI Dynamic DCA / Grid",
    description:
      "De AI zoekt strategische bodems om slim bij te kopen als de prijs zakt (DCA). Verkoopt automatisch zodra de AI een top herkent.",
    risk: "Gemiddeld",
    timeframe: "15m",
    className: "FreqaiDcaStrategy",
    code: DYNAMIC_DCA_CODE,
    freqaiConfig: {
      freqaiModel: "LightGBMRegressor",
      training: { trainPeriodDays: 30, backtestPeriodDays: 7, liveRetrainHours: 12 },
      features: {
        baseTimeframe: "15m",
        indicatorPeriods: [10, 20, 50],
        includeTimeframes: ["15m", "1h"],
        labelPeriodCandles: 12,
      },
      risk: { stoploss: -0.15, minimalRoi: { "0": 0.04, "60": 0.02, "180": 0 }, trailingStop: false },
      positionAdjustment: { enabled: true, maxEntryPositionAdjustment: 3, rebuyTriggerPercent: 0.03 },
    },
  },
  {
    id: "ai-trend-catcher",
    title: "AI Trend Catcher",
    description:
      "De AI analyseert de grote marktverschuivingen en negeert kleine ruis. Stapt in bij grote trends en houdt posities langer vast.",
    risk: "Hoog",
    timeframe: "1h / 4h",
    className: "FreqaiTrendCatcherStrategy",
    code: TREND_CATCHER_CODE,
    freqaiConfig: {
      freqaiModel: "LightGBMRegressor",
      training: { trainPeriodDays: 60, backtestPeriodDays: 14, liveRetrainHours: 24 },
      features: {
        baseTimeframe: "1h",
        indicatorPeriods: [20, 50, 100],
        includeTimeframes: ["1h", "4h"],
        labelPeriodCandles: 24,
      },
      risk: {
        stoploss: -0.12,
        minimalRoi: { "0": 0.15, "720": 0.08, "1440": 0 },
        trailingStop: true,
        trailingStopPositive: 0.02,
        trailingStopPositiveOffset: 0.04,
      },
    },
  },
];
