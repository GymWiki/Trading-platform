// The user never sees or types a Python class name — they pick one of
// these personas, and the technical `strategy` (class name) + `strategyCode`
// (actual Freqtrade strategy source) are looked up and sent to the backend
// automatically. lib/strategy-validation.ts still validates both server-side
// regardless of this curated UI, so a hand-crafted API request can't skip it.
export interface StrategyPreset {
  id: string;
  title: string;
  description: string;
  risk: "Laag" | "Gemiddeld" | "Hoog";
  timeframe: string;
  /** The Python class name — this becomes both `strategy` and part of the filename. Never shown in the UI. */
  className: string;
  code: string;
}

const CONSERVATIVE_SCALPER_CODE = `from freqtrade.strategy import IStrategy
import talib.abstract as ta


class ConservativeScalperStrategy(IStrategy):
    """Voorzichtige Scalper: kleine, snelle trades met een strakke stoploss."""

    timeframe = "5m"
    minimal_roi = {"0": 0.02, "10": 0.01, "30": 0}
    stoploss = -0.03
    trailing_stop = True
    trailing_stop_positive = 0.005

    def populate_indicators(self, dataframe, metadata):
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["rsi"] < 25) & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["rsi"] > 70) & (dataframe["volume"] > 0),
            "exit_long",
        ] = 1
        return dataframe
`;

const TREND_FOLLOWER_CODE = `from freqtrade.strategy import IStrategy
import talib.abstract as ta


class TrendFollowerStrategy(IStrategy):
    """Trend Volger: stapt in zodra een korte trend boven een lange trend uitbreekt."""

    timeframe = "1h"
    minimal_roi = {"0": 0.10, "120": 0.05, "480": 0}
    stoploss = -0.08

    def populate_indicators(self, dataframe, metadata):
        dataframe["ema_fast"] = ta.EMA(dataframe, timeperiod=20)
        dataframe["ema_slow"] = ta.EMA(dataframe, timeperiod=50)
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["ema_fast"] > dataframe["ema_slow"])
            & (dataframe["ema_fast"].shift(1) <= dataframe["ema_slow"].shift(1))
            & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["ema_fast"] < dataframe["ema_slow"]) & (dataframe["volume"] > 0),
            "exit_long",
        ] = 1
        return dataframe
`;

const AI_PREDICTOR_CODE = `from freqtrade.strategy import IStrategy
import talib.abstract as ta


class AIPredictorStrategy(IStrategy):
    """AI Voorspeller: gebruikt je getrainde FreqAI-model om richting te voorspellen."""

    timeframe = "5m"
    minimal_roi = {"0": 0.03}
    stoploss = -0.05
    process_only_new_candles = True

    def feature_engineering_expand_all(self, dataframe, period, metadata, **kwargs):
        dataframe["%-rsi"] = ta.RSI(dataframe, timeperiod=period)
        dataframe["%-ema"] = ta.EMA(dataframe, timeperiod=period)
        return dataframe

    def set_freqai_targets(self, dataframe, metadata, **kwargs):
        dataframe["&-target"] = dataframe["close"].shift(-5) / dataframe["close"] - 1
        return dataframe

    def populate_indicators(self, dataframe, metadata):
        dataframe = self.freqai.start(dataframe, metadata, self)
        return dataframe

    def populate_entry_trend(self, dataframe, metadata):
        dataframe.loc[
            (dataframe["do_predict"] == 1)
            & (dataframe["&-target"] > 0.01)
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
    id: "conservative-scalper",
    title: "Voorzichtige Scalper",
    description: "Maakt veel kleine trades met laag risico en sluit snel weer af.",
    risk: "Laag",
    timeframe: "5 min",
    className: "ConservativeScalperStrategy",
    code: CONSERVATIVE_SCALPER_CODE,
  },
  {
    id: "trend-follower",
    title: "Trend Volger",
    description: "Stapt in zodra een duidelijke trend ontstaat en houdt de trade langer vast.",
    risk: "Gemiddeld",
    timeframe: "1 uur",
    className: "TrendFollowerStrategy",
    code: TREND_FOLLOWER_CODE,
  },
  {
    id: "ai-predictor",
    title: "AI Voorspeller",
    description: "Gebruikt jouw getrainde FreqAI-model om koersbewegingen te voorspellen.",
    risk: "Hoog",
    timeframe: "5 min",
    className: "AIPredictorStrategy",
    code: AI_PREDICTOR_CODE,
  },
];
